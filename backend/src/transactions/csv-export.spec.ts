import { describe, expect, it, vi } from 'vitest';
import { CSV_HEADER, csvCell, csvRow } from './csv-export.js';
import { TransactionsService } from './transactions.service.js';
import type { PostingRepository } from './posting.repository.js';
import type { Identity } from '../auth/auth.js';
import type { TransactionRecord, TransferRecord } from './contracts.js';
const id = { subject: 'user', email: 'u@example.com' } as Identity;
const expense: TransactionRecord = {
  id: 'expense',
  householdId: 'h',
  type: 'expense',
  transactionDate: '2026-01-01',
  accountId: 'a',
  categoryId: 'c',
  amountMinor: '100',
  currency: 'RSD',
  exchangeRate: null,
  exchangeRateSource: null,
  merchant: ' =SUM(1,2)',
  note: 'hello, "world"\nnext',
  authorMemberId: 'm',
  version: 1,
  status: 'posted',
  rsdEquivalentMinor: '100',
  createdAt: 'x',
  updatedAt: 'x',
};
const labels = {
  accounts: new Map([
    ['a', 'Bank'],
    ['b', 'Other'],
  ]),
  categories: new Map([['c', 'Food']]),
};
describe('CSV export', () => {
  it('neutralizes formulas and quotes commas, quotes and embedded newlines', () => {
    for (const s of [
      '=1',
      '  +1',
      '＝1',
      ' ＋1',
      '－1',
      '＠1',
      '\ttext',
      '\rtext',
      '\ntext',
      '\u0000-1',
    ])
      expect(csvCell(s)).toMatch(/^"?'/);
    expect(csvCell('-123', false)).toBe('-123');
    expect(csvRow(expense, labels)).toBe(
      'expense,2026-01-01,expense,posted,Bank,100,RSD,Food,"\' =SUM(1,2)","hello, ""world""\nnext",100,,,,\r\n',
    );
  });
  it('writes transfer legs and fee linkage into their fixed columns', () => {
    const transfer: TransferRecord = {
      id: 't',
      householdId: 'h',
      type: 'transfer',
      transactionDate: '2026-01-01',
      fromAccountId: 'a',
      toAccountId: 'b',
      debitAmountMinor: '123',
      creditAmountMinor: '200',
      debitCurrency: 'RSD',
      creditCurrency: 'EUR',
      fee: null,
      merchant: null,
      note: null,
      authorMemberId: 'm',
      version: 1,
      status: 'posted',
      createdAt: 'x',
      updatedAt: 'x',
    };
    expect(csvRow(transfer, labels)).toBe(
      't,2026-01-01,transfer,posted,Bank,123,RSD,,,,,Other,200,EUR,\r\n',
    );
    expect(
      csvRow(
        { ...expense, type: 'fee', parentTransactionId: 't' },
        labels,
      ).endsWith(',t\r\n'),
    ).toBe(true);
  });
  it('follows pages and rejects pagination supplied by the client', async () => {
    const repo = {
      list: vi
        .fn()
        .mockResolvedValueOnce({
          transactions: [expense],
          nextCursor: btoa(
            JSON.stringify({ transactionDate: '2026-01-01', id: 'expense' }),
          ).replace(/=+$/, ''),
        })
        .mockResolvedValueOnce({ transactions: [], nextCursor: null }),
      exportLabels: vi.fn().mockResolvedValue(labels),
      assertExportAccess: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TransactionsService(
      repo as unknown as PostingRepository,
    );
    const csv = await service.exportCsv(id, 'h', { type: 'expense' });
    expect(csv).toBe('\uFEFF' + CSV_HEADER + csvRow(expense, labels));
    expect(repo.list).toHaveBeenCalledTimes(2);
    await expect(service.exportCsv(id, 'h', { limit: '2' })).rejects.toThrow();
  });
  it('rejects a large response before returning CSV', async () => {
    const repo = {
      list: vi.fn().mockResolvedValue({
        transactions: [{ ...expense, note: 'é'.repeat(4 * 1024 * 1024) }],
        nextCursor: null,
      }),
      exportLabels: vi.fn().mockResolvedValue(labels),
      assertExportAccess: vi.fn(),
    };
    await expect(
      new TransactionsService(repo as unknown as PostingRepository).exportCsv(
        id,
        'h',
        {},
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
