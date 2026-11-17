import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../households/households.js';
import type { HouseholdAccessService } from '../households/households.js';
import { MonetaryRepository } from './monetary-repository.js';

const identity = { subject: 'subject', email: 'member@example.com' };
describe('recorded movement repository', () => {
  it('authorizes and scopes the month read by movement date and preserves recorded values', async () => {
    const record = {
      id: 'x',
      movementDate: '2024-02-29',
      amountMinor: '9007199254740991',
      currency: 'EUR',
      rsdEquivalentMinor: null,
      exchangeRate: '117.000',
      exchangeRateSource: 'old',
    };
    const statement = { bind: vi.fn().mockReturnThis() };
    const prepare = vi.fn().mockReturnValue(statement);
    const batch = vi.fn().mockResolvedValue([{}, { results: [record] }]);
    const repository = new MonetaryRepository(
      { prepare } as unknown as Database,
      { batch } as unknown as HouseholdAccessService,
    );
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
    expect(prepare.mock.calls[0][0]).toMatch(/CAST\(amount_minor AS TEXT\)/);
    expect(prepare.mock.calls[0][0]).toMatch(
      /CAST\(rsd_equivalent_minor AS TEXT\)/,
    );
    expect(prepare.mock.calls[0][0]).toMatch(
      /WHERE household_id=\? AND movement_date>=\? AND movement_date<=\?/,
    );
    expect(statement.bind).toHaveBeenCalledWith(
      'household-1',
      '2024-02-01',
      '2024-02-29',
    );
    expect(batch).toHaveBeenCalledWith(identity, 'household-1', 'member', [
      statement,
    ]);
  });
  it('propagates denied access and rejects invalid months before a read', async () => {
    const error = new Error('denied');
    const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis() });
    const batch = vi.fn().mockRejectedValue(error);
    const repository = new MonetaryRepository(
      { prepare } as unknown as Database,
      { batch } as unknown as HouseholdAccessService,
    );
    await expect(
      repository.readRecordedMonth(identity, 'h', '2024-02'),
    ).rejects.toBe(error);
    await expect(
      repository.readRecordedMonth(identity, 'h', '2024-13'),
    ).rejects.toThrow();
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
