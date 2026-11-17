import { describe, expect, it } from 'vitest';
import {
  RecordedMoneyError,
  summarizeRecordedMoney,
  type RecordedMoneyMovement,
} from './recorded-money.js';

const movement = (
  overrides: Partial<RecordedMoneyMovement> = {},
): RecordedMoneyMovement => ({
  id: '1',
  movementDate: '2026-02-01',
  amountMinor: '0',
  currency: 'RSD',
  rsdEquivalentMinor: null,
  exchangeRate: null,
  exchangeRateSource: null,
  ...overrides,
});

describe('recorded movement valuation', () => {
  it('uses authoritative recorded equivalents, includes zero and counts missing foreign conversions', () => {
    const rows = [
      movement({ amountMinor: '100', currency: 'RSD' }),
      movement({
        id: '2',
        amountMinor: '1000',
        currency: 'EUR',
        rsdEquivalentMinor: '11700',
        exchangeRate: '117.0000',
        exchangeRateSource: 'historic',
      }),
      movement({
        id: '3',
        amountMinor: '-200',
        currency: 'EUR',
        rsdEquivalentMinor: '-20000',
        exchangeRate: null,
      }),
      movement({
        id: '4',
        amountMinor: '0',
        currency: 'USD',
        rsdEquivalentMinor: null,
        exchangeRate: '100',
        exchangeRateSource: 'historic',
      }),
      movement({
        id: '5',
        amountMinor: '0',
        currency: 'RUB',
        rsdEquivalentMinor: '0',
        exchangeRate: '1',
      }),
    ];
    expect(summarizeRecordedMoney(rows)).toEqual({
      totalsByCurrency: { RSD: '1.00', EUR: '8.00', RUB: '0.00', USD: '0.00' },
      rsdKnownSubtotal: '-82.00',
      incompleteConversion: true,
      missingConversionCount: 1,
      missingRateCount: 1,
      affectedRecordCount: 2,
    });
    expect(rows[1].exchangeRate).toBe('117.0000');
    expect(rows[1].exchangeRateSource).toBe('historic');
  });

  it('counts foreign rows missing either metadata only once, including zero amounts', () => {
    const rows = [
      movement({ currency: 'EUR', amountMinor: '0', rsdEquivalentMinor: '0' }),
      movement({ currency: 'USD', amountMinor: '0', exchangeRate: '1' }),
      movement({ currency: 'RUB', amountMinor: '0' }),
      movement({
        currency: 'EUR',
        amountMinor: '0',
        rsdEquivalentMinor: '0',
        exchangeRate: '1',
      }),
      movement({ currency: 'RSD', amountMinor: '0' }),
    ];
    expect(summarizeRecordedMoney(rows)).toMatchObject({
      rsdKnownSubtotal: '0.00',
      missingRateCount: 2,
      missingConversionCount: 2,
      affectedRecordCount: 3,
      incompleteConversion: true,
    });
  });

  it('keeps sums exact beyond JavaScript and SQLite integer aggregate limits', () => {
    const rows = Array.from({ length: 1025 }, () =>
      movement({ amountMinor: '9007199254740991' }),
    );
    expect(summarizeRecordedMoney(rows).rsdKnownSubtotal).toBe(
      '92323792361095157.75',
    );
  });

  it('rejects individual values outside D1 safe bounds', () => {
    expect(() =>
      summarizeRecordedMoney([movement({ amountMinor: '9007199254740992' })]),
    ).toThrow(RecordedMoneyError);
    expect(() =>
      summarizeRecordedMoney([
        movement({ currency: 'EUR', rsdEquivalentMinor: '-9007199254740992' }),
      ]),
    ).toThrow(RecordedMoneyError);
  });

  it('fails closed on inconsistent RSD equivalents and malformed amounts', () => {
    expect(() =>
      summarizeRecordedMoney([
        movement({ amountMinor: '1', rsdEquivalentMinor: '2' }),
      ]),
    ).toThrow(RecordedMoneyError);
    expect(() =>
      summarizeRecordedMoney([movement({ amountMinor: '1.5' })]),
    ).toThrow(RecordedMoneyError);
    expect(summarizeRecordedMoney([])).toMatchObject({
      rsdKnownSubtotal: '0.00',
      incompleteConversion: false,
      missingConversionCount: 0,
    });
  });
});
