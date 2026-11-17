import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../households/households.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { Identity } from '../auth/auth.js';
import { RefundWrite } from './refund-write.js';

it('replays a stored response without looking up the current purchase', async () => {
  const response = {
    id: 'original',
    type: 'refund',
    status: 'posted',
    version: 1,
  };
  const statements: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        const stmt = { sql, values };
        statements.push(stmt);
        return stmt;
      },
    }),
  };
  const prisma = {
    householdMember: { findFirst: vi.fn().mockResolvedValue({ id: 'member' }) },
    postingRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'claim' }) },
    transaction: { findFirst: vi.fn() },
  };
  const run = vi
    .fn()
    .mockResolvedValue([
      {},
      {},
      {},
      { results: [{ responseJson: JSON.stringify(response) }] },
    ]);
  const writer = new RefundWrite(
    db as unknown as Database,
    prisma as unknown as PrismaService,
    run,
  );
  const input = {
    type: 'refund' as const,
    transactionDate: '2026-01-01',
    purchaseTransactionId: 'purchase',
    accountId: 'account',
    amountMinor: '1',
    merchant: null,
    note: null,
  };
  expect(
    await writer.post(
      { subject: 'user' } as Identity,
      'household',
      input,
      'key',
    ),
  ).toEqual(response);
  expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  expect(
    statements.some((s) => s.sql.includes('household_access_checks')),
  ).toBe(true);
  expect(
    statements.some(
      (s) =>
        s.sql.includes('posting_request_checks') &&
        s.values.includes(JSON.stringify(input)),
    ),
  ).toBe(true);
});

describe('refund replay', () => {
  it('rechecks the key after a concurrent request wins during preflight', async () => {
    const response = {
      id: 'winner',
      type: 'refund',
      status: 'posted',
      version: 1,
    };
    const db = { prepare: () => ({ bind: () => ({}) }) };
    const prisma = {
      householdMember: {
        findFirst: vi.fn().mockResolvedValue({ id: 'member' }),
      },
      postingRequest: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 'winner' }),
      },
      transaction: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const run = vi
      .fn()
      .mockResolvedValue([
        {},
        {},
        {},
        { results: [{ responseJson: JSON.stringify(response) }] },
      ]);
    const writer = new RefundWrite(
      db as unknown as Database,
      prisma as unknown as PrismaService,
      run,
    );
    const input = {
      type: 'refund' as const,
      transactionDate: '2026-01-01',
      purchaseTransactionId: 'purchase',
      accountId: 'account',
      amountMinor: '1',
      merchant: null,
      note: null,
    };
    expect(
      await writer.post(
        { subject: 'user' } as Identity,
        'h',
        input,
        'same-key',
      ),
    ).toEqual(response);
    expect(prisma.transaction.findFirst).toHaveBeenCalledOnce();
  });
});
