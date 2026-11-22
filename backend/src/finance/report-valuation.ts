/** Interpret recorded signed cash flow without revaluing historical FX. */
export function recordedValue(row: {
  currency: string;
  amountMinor: string;
  rsdEquivalentMinor: string | null;
  exchangeRate: string | null;
}) {
  return {
    original: BigInt(row.amountMinor),
    rsd:
      row.currency === 'RSD'
        ? BigInt(row.amountMinor)
        : row.rsdEquivalentMinor === null
          ? null
          : BigInt(row.rsdEquivalentMinor),
    missing:
      row.currency !== 'RSD' &&
      (row.rsdEquivalentMinor === null || row.exchangeRate === null),
  };
}
