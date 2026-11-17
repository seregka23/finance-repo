import {
  assertSafeMinor,
  FinanceError,
  validateCurrency,
  type Currency,
} from './money.js';

// Rates are bounded to 80 characters to limit decimal parsing work.
function rateParts(rate: unknown): { numerator: bigint; denominator: bigint } {
  if (
    typeof rate !== 'string' ||
    rate.length > 80 ||
    !/^\d+(?:\.\d+)?$/.test(rate)
  )
    throw new FinanceError(
      'INVALID_RATE',
      'Expected a positive decimal rate of at most 80 characters',
    );
  const [whole, fraction = ''] = rate.split('.');
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n)
    throw new FinanceError('INVALID_RATE', 'Rate must be positive');
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}
export function convertMinorToRsd(
  amountMinor: bigint,
  currency: unknown,
  rate: string | null,
): bigint | null {
  assertSafeMinor(amountMinor);
  const validated = validateCurrency(currency);
  if (validated === 'RSD' && rate === null) return amountMinor;
  if (rate === null) return null;
  const { numerator, denominator } = rateParts(rate);
  if (validated === 'RSD') {
    if (numerator !== denominator)
      throw new FinanceError('INVALID_RATE', 'RSD rate must equal one');
    return amountMinor;
  }
  const magnitude = amountMinor < 0n ? -amountMinor : amountMinor;
  const product = magnitude * numerator;
  const rounded = (product + denominator / 2n) / denominator;
  return assertSafeMinor(amountMinor < 0n ? -rounded : rounded);
}
export interface RecordedConversion {
  amountMinor: string;
  currency: Currency;
  rsdEquivalentMinor: string | null;
  rate: string | null;
  source: string | null;
}
export function recordConversion(
  amountMinor: bigint,
  currency: unknown,
  rate: string | null,
  source: string | null,
): RecordedConversion {
  if (
    source !== null &&
    (typeof source !== 'string' ||
      source.length > 200 ||
      source.trim().length === 0)
  )
    throw new FinanceError(
      'INVALID_SOURCE',
      'Source must be a nonblank string of at most 200 characters or null',
    );
  const validated = validateCurrency(currency);
  const converted = convertMinorToRsd(amountMinor, validated, rate);
  return {
    amountMinor: amountMinor.toString(),
    currency: validated,
    rsdEquivalentMinor: converted?.toString() ?? null,
    rate,
    source,
  };
}
/** Return the incremental RSD refund using cumulative rounding against the recorded purchase. */
export function cumulativeRefundRsd(
  originalMinor: bigint,
  originalRsdMinor: bigint,
  currency: unknown,
  rate: string | null,
  previousRefundMinor: bigint,
  refundMinor: bigint,
): bigint {
  assertSafeMinor(originalMinor);
  assertSafeMinor(originalRsdMinor);
  assertSafeMinor(previousRefundMinor);
  assertSafeMinor(refundMinor);
  if (
    originalMinor <= 0n ||
    originalRsdMinor < 0n ||
    previousRefundMinor < 0n ||
    refundMinor < 0n ||
    previousRefundMinor + refundMinor > originalMinor
  )
    throw new FinanceError(
      'INVALID_REFUND',
      'Refund exceeds the original purchase',
    );
  const recorded = convertMinorToRsd(originalMinor, currency, rate);
  if (recorded === null || recorded !== originalRsdMinor)
    throw new FinanceError(
      'INVALID_SNAPSHOT',
      'Purchase conversion snapshot is missing or inconsistent',
    );
  const before = convertMinorToRsd(previousRefundMinor, currency, rate)!;
  const after = convertMinorToRsd(
    previousRefundMinor + refundMinor,
    currency,
    rate,
  )!;
  return after - before;
}
