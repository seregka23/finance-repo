import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { MonetaryRepository } from './monetary-repository.js';

const identity = { subject: 'subject', email: 'member@example.com' };
describe('recorded movement repository', () => {
  it('scopes the read to live membership and preserves exact recorded values', async () => {
    const record = {
      id: 'x',
      movementDate: '2024-02-29',
      amountMinor: '9007199254740991',
      currency: 'EUR',
      rsdEquivalentMinor: null,
      exchangeRate: '117.000',
      exchangeRateSource: 'old',
    };
    const query = vi.fn().mockResolvedValue([record]);
    const repository = new MonetaryRepository({
      $queryRaw: query,
    } as unknown as PrismaService);
    const result = await repository.readRecordedMonth(
      identity,
      'household-1',
      '2024-02',
    );
    expect(result.records).toEqual([record]);
    expect(result.summary).toMatchObject({
      incompleteConversion: true,
      missingConversionCount: 1,
    });
    const sql = query.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain("member.status='active'");
    expect(sql.sql).toContain('CAST(m.amount_minor AS TEXT)');
    expect(sql.values).toEqual([
      'subject',
      '2024-02-01',
      '2024-02-29',
      'household-1',
    ]);
  });
  it('distinguishes authorized empty results from missing membership', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: null }])
      .mockResolvedValueOnce([]);
    const repository = new MonetaryRepository({
      $queryRaw: query,
    } as unknown as PrismaService);
    expect(
      (await repository.readRecordedMonth(identity, 'h', '2024-02')).records,
    ).toEqual([]);
    await expect(
      repository.readRecordedMonth(identity, 'h', '2024-02'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.readRecordedMonth(identity, 'h', '2024-13'),
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
