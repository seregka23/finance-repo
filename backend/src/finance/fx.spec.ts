import { describe, expect, it } from 'vitest';
import {
  convertMinorToRsd,
  cumulativeRefundRsd,
  recordConversion,
} from './fx.js';
describe('conversion', () => {
  it('rounds exact rates half away from zero', () => {
    expect(convertMinorToRsd(5n, 'EUR', '0.1')).toBe(1n);
    expect(convertMinorToRsd(-5n, 'EUR', '0.1')).toBe(-1n);
    expect(convertMinorToRsd(3n, 'EUR', '0.8')).toBe(2n);
    expect(() => convertMinorToRsd(1n, 'EUR', '0')).toThrow();
    expect(() => convertMinorToRsd(1n, 'RSD', '2')).toThrow();
    expect(() => convertMinorToRsd(9007199254740991n, 'EUR', '2')).toThrow();
  });
  it('validates and preserves source metadata', () => {
    expect(recordConversion(3n, 'EUR', '0.8', ' x ').source).toBe(' x ');
    expect(
      recordConversion(3n, 'EUR', '0.8', 'x'.repeat(200)).source,
    ).toHaveLength(200);
    expect(() => recordConversion(3n, 'EUR', '0.8', '  ')).toThrow();
    expect(() => recordConversion(3n, 'EUR', '0.8', 'x'.repeat(201))).toThrow();
    expect(() =>
      recordConversion(3n, 'EUR', '0.8', 42 as unknown as string),
    ).toThrow();
  });
  it('preserves snapshots and offsets partial refunds', () => {
    expect(recordConversion(3n, 'EUR', '0.80', 'manual')).toEqual({
      amountMinor: '3',
      currency: 'EUR',
      rsdEquivalentMinor: '2',
      rate: '0.80',
      source: 'manual',
    });
    expect(
      recordConversion(3n, 'EUR', null, null).rsdEquivalentMinor,
    ).toBeNull();
    expect(cumulativeRefundRsd(3n, 2n, 'EUR', '0.8', 0n, 2n)).toBe(2n);
    expect(cumulativeRefundRsd(3n, 2n, 'EUR', '0.8', 2n, 1n)).toBe(0n);
    expect(() => cumulativeRefundRsd(3n, 3n, 'EUR', '0.8', 0n, 1n)).toThrow();
  });
});
