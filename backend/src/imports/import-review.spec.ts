import { describe, expect, it, vi } from 'vitest';
import { ImportReviewService } from './import-review.js';
import type { Identity } from '../auth/auth.types.js';
import type { Database } from '../database/database.types.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { HouseholdAccessService } from '../households/household-access.service.js';
import type { ExtractionService } from './extraction.js';
import type { TransactionsService } from '../transactions/transactions.service.js';
const identity = { subject: 'u', email: 'u@example.invalid' } as Identity;
const baseDraft = {
  type: 'expense',
  status: 'posted',
  date: '2026-01-01',
  amountMinor: '100',
  currency: 'RSD',
  merchant: 'Shop',
  recipient: null,
  cardLastFour: null,
  feeMinor: null,
  purchaseAmountMinor: null,
  purchaseCurrency: null,
  debitAmountMinor: null,
  debitCurrency: null,
  sourceAccount: null,
  destinationAccount: null,
  items: [],
};
const transaction = {
  type: 'expense',
  transactionDate: '2026-01-01',
  accountId: 'a',
  categoryId: 'c',
  amountMinor: '100',
  currency: 'RSD',
};
function setup(type: string, status: string, sourceLabel = 'sms') {
  const row = {
    id: 'draft',
    status: 'pending',
    sourceType: sourceLabel,
    createdAt: 'time',
    transactionId: null,
    confirmationHash: null,
    suggestedAccountId: null,
    extractedFieldsJson: JSON.stringify({
      sourceLabel,
      draft: { ...baseDraft, type, status },
      reviewFlags: [],
      categoryDecision: { categoryId: null, provider: null, probability: null },
    }),
  };
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([row]) },
    access = { get: vi.fn().mockResolvedValue({}) },
    transactions = { postImport: vi.fn() };
  const service = new ImportReviewService(
    {} as Database,
    prisma as unknown as PrismaService,
    access as unknown as HouseholdAccessService,
    {} as ExtractionService,
    transactions as unknown as TransactionsService,
  );
  return { service, transactions };
}
describe('import confirmation safety', () => {
  it('blocks declined and requires settlement acknowledgement for pending', async () => {
    for (const status of ['declined', 'pending', 'unknown']) {
      const { service, transactions } = setup('expense', status);
      await expect(
        service.confirm(identity, 'h', 'draft', {
          mode: 'post',
          transaction,
          items: [],
          settlementConfirmed: false,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(transactions.postImport).not.toHaveBeenCalled();
    }
  });
  it('does not coerce recognized transfer or refund to expense or attach it as receipt', async () => {
    for (const type of ['transfer', 'refund', 'income']) {
      const { service, transactions } = setup(type, 'posted', 'receipt');
      await expect(
        service.confirm(identity, 'h', 'draft', {
          mode: 'attach',
          transactionId: 't',
          items: [],
        }),
      ).rejects.toMatchObject({ status: 409 });
      if (type !== 'income')
        await expect(
          service.confirm(identity, 'h', 'draft', {
            mode: 'post',
            transaction,
            items: [],
            settlementConfirmed: true,
          }),
        ).rejects.toMatchObject({ status: 409 });
      expect(transactions.postImport).not.toHaveBeenCalled();
    }
  });
  it('rejects malformed receipt lines before posting', async () => {
    const { service, transactions } = setup('expense', 'posted');
    await expect(
      service.confirm(identity, 'h', 'draft', {
        mode: 'post',
        transaction,
        items: [
          { name: 'x', quantity: '1', unitPriceMinor: '01', amountMinor: '1' },
        ],
        settlementConfirmed: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(transactions.postImport).not.toHaveBeenCalled();
  });
});
