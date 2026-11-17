export type Currency = 'RSD' | 'EUR' | 'RUB' | 'USD';

export class FinanceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FinanceError';
  }
}

const MAX = 9007199254740991n;
export function validateCurrency(value: unknown): Currency {
  if (value !== 'RSD' && value !== 'EUR' && value !== 'RUB' && value !== 'USD')
    throw new FinanceError('INVALID_CURRENCY', 'Unsupported currency');
  return value;
}
export function assertSafeMinor(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < -MAX || value > MAX)
    throw new FinanceError(
      'AMOUNT_OUT_OF_RANGE',
      'Minor amount must be a safe integer',
    );
  return value;
}
/** Parse trusted SQL aggregate text; use parseMinor for external amounts. */
export function parseIntegerText(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(value))
    throw new FinanceError(
      'INVALID_INTEGER',
      'Expected canonical integer text',
    );
  return BigInt(value);
}
export function parseMinor(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 17)
    throw new FinanceError(
      'INVALID_INTEGER',
      'Expected safe canonical integer text',
    );
  return assertSafeMinor(parseIntegerText(value));
}
export function parseAmount(value: unknown, currency: unknown): bigint {
  validateCurrency(currency);
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^[+-]?\d+(?:\.\d{1,2})?$/.test(value)
  )
    throw new FinanceError(
      'INVALID_AMOUNT',
      'Expected a decimal amount with at most two fractional digits',
    );
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return assertSafeMinor(negative ? -minor : minor);
}
export function formatAmount(minor: bigint, currency: unknown): string {
  validateCurrency(currency);
  if (typeof minor !== 'bigint')
    throw new FinanceError('INVALID_AMOUNT', 'Expected bigint minor amount');
  const abs = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
export function toD1Minor(value: bigint): number {
  return Number(assertSafeMinor(value));
}
export function fromD1Minor(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new FinanceError('INVALID_D1_AMOUNT', 'Expected a safe D1 integer');
  return BigInt(value);
}
export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) {
    if (typeof value !== 'bigint')
      throw new FinanceError('INVALID_AMOUNT', 'Expected bigint minor amount');
    total += value;
  }
  return total;
}
