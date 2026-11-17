import { describe, expect, it } from 'vitest';
import { decimalToMinor, formatMinor } from './accounts.service';

describe('account money conversion', () => {
  it('converts decimal input exactly, including large amounts and signed changes', () => {
    expect(decimalToMinor('12345678901234567890.09')).toBe('1234567890123456789009');
    expect(decimalToMinor('-0.50', true)).toBe('-50');
    expect(decimalToMinor('+12.3', true)).toBe('1230');
    expect(decimalToMinor('-0.00', true)).toBe('0');
  });
  it('rejects excess precision and negative opening balances', () => {
    expect(decimalToMinor('1.001')).toBeNull();
    expect(decimalToMinor('-1')).toBeNull();
    expect(decimalToMinor('1e3', true)).toBeNull();
  });
  it('formats minor amounts without loss of precision', () => {
    expect(formatMinor('-1234567890123456789009', 'EUR')).toBe(
      '−12,345,678,901,234,567,890.09 EUR',
    );
    expect(formatMinor('5', 'RSD')).toBe('0.05 RSD');
  });
});
