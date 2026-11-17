import { formatAmount, parseMinor, type Currency } from './money.js';

/** Raw account movement valuation, including transfers and non-transaction movements.
 * Consumers must select their own eligible records before reporting. */
export interface RecordedMoneyMovement {
  id: string;
  movementDate: string;
  amountMinor: string;
  currency: Currency;
  rsdEquivalentMinor: string | null;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
}

export interface RecordedMoneySummary {
  totalsByCurrency: Record<Currency, string>;
  rsdKnownSubtotal: string;
  incompleteConversion: boolean;
  missingConversionCount: number;
  missingRateCount: number;
  affectedRecordCount: number;
}

/** Signals inconsistent or malformed persisted values; never silently revalue them. */
export class RecordedMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordedMoneyError';
  }
}

export function summarizeRecordedMoney(
  records: readonly RecordedMoneyMovement[],
): RecordedMoneySummary {
  const totals: Record<Currency, bigint> = {
    RSD: 0n,
    EUR: 0n,
    RUB: 0n,
    USD: 0n,
  };
  let knownRsd = 0n;
  let missingConversionCount = 0;
  let missingRateCount = 0;
  let affectedRecordCount = 0;
  for (const record of records) {
    if (!Object.hasOwn(totals, record.currency))
      throw new RecordedMoneyError('Unsupported recorded currency');
    let amount: bigint;
    let equivalent: bigint | null;
    try {
      amount = parseMinor(record.amountMinor);
      equivalent =
        record.rsdEquivalentMinor === null
          ? null
          : parseMinor(record.rsdEquivalentMinor);
    } catch {
      throw new RecordedMoneyError('Invalid recorded amount');
    }
    totals[record.currency] += amount;
    if (record.currency === 'RSD') {
      if (equivalent !== null && equivalent !== amount)
        throw new RecordedMoneyError(
          'Recorded RSD equivalent does not match amount',
        );
      knownRsd += amount;
    } else {
      if (equivalent === null) missingConversionCount++;
      else knownRsd += equivalent;
      if (record.exchangeRate === null) missingRateCount++;
      if (equivalent === null || record.exchangeRate === null)
        affectedRecordCount++;
    }
  }
  return {
    totalsByCurrency: {
      RSD: formatAmount(totals.RSD, 'RSD'),
      EUR: formatAmount(totals.EUR, 'EUR'),
      RUB: formatAmount(totals.RUB, 'RUB'),
      USD: formatAmount(totals.USD, 'USD'),
    },
    rsdKnownSubtotal: formatAmount(knownRsd, 'RSD'),
    incompleteConversion: affectedRecordCount > 0,
    missingConversionCount,
    missingRateCount,
    affectedRecordCount,
  };
}
