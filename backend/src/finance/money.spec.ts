import { describe, expect, it } from 'vitest';
import {
  parseAmount,
  formatAmount,
  parseMinor,
  parseIntegerText,
  toD1Minor,
  fromD1Minor,
  sumMinor,
} from './money.js';
describe('money', () => {
  it('parses exact major units', () => {
    expect(parseAmount('-12.3', 'EUR')).toBe(-1230n);
    expect(formatAmount(900719925474099100n, 'RSD')).toBe(
      '9007199254740991.00',
    );
    for (const input of [1, '1e2', ' 1', '1,00', '1.001', ''])
      expect(() => parseAmount(input, 'EUR')).toThrow();
    expect(() => parseAmount('1', 'GBP')).toThrow();
    expect(parseAmount('0'.repeat(80), 'EUR')).toBe(0n);
    expect(() => parseAmount('0'.repeat(81), 'EUR')).toThrow();
    expect(() => parseAmount('9'.repeat(100000), 'EUR')).toThrow();
  });
  it('enforces D1 bounds and preserves aggregates', () => {
    expect(toD1Minor(parseMinor('9007199254740991'))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(() => parseMinor('9007199254740992')).toThrow();
    expect(() => parseMinor('-0')).toThrow();
    expect(parseMinor('-9007199254740991')).toBe(-9007199254740991n);
    expect(() => parseMinor('-' + '9'.repeat(100000))).toThrow();
    expect(() => fromD1Minor(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(sumMinor([parseIntegerText('9007199254740992'), 1n])).toBe(
      9007199254740993n,
    );
  });
});
