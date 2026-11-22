import type { AnyTransactionRecord } from './contracts.js';
export const CSV_HEADER =
  'transaction_id,date,type,status,account,amount_minor,currency,category,merchant,note,rsd_equivalent_minor,to_account,received_amount_minor,received_currency,transfer_id\r\n';
/** Escape untrusted text for spreadsheets before applying RFC 4180 quoting. */
export function csvCell(value: string | null | undefined, text = true): string {
  let cell = value ?? '';
  let offset = 0;
  while (offset < cell.length) {
    const character = cell[offset],
      code = cell.charCodeAt(offset);
    if (code > 31 && code !== 127 && !/\s/u.test(character)) break;
    offset++;
  }
  if (
    text &&
    (['\t', '\r', '\n'].includes(cell[0]) ||
      '=+-@＝＋－＠'.includes(cell[offset] ?? '\0'))
  )
    cell = "'" + cell;
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
export function csvRow(
  t: AnyTransactionRecord,
  labels: { accounts: Map<string, string>; categories: Map<string, string> },
): string {
  const transfer = t.type === 'transfer';
  const accountId = transfer ? t.fromAccountId : t.accountId;
  const cells: [string | null | undefined, boolean][] = [
    [t.id, true],
    [t.transactionDate, true],
    [t.type, true],
    [t.status, true],
    [labels.accounts.get(accountId), true],
    [transfer ? t.debitAmountMinor : t.amountMinor, false],
    [transfer ? t.debitCurrency : t.currency, true],
    [transfer ? null : labels.categories.get(t.categoryId), true],
    [t.merchant, true],
    [t.note, true],
    [transfer ? null : t.rsdEquivalentMinor, false],
    [transfer ? labels.accounts.get(t.toAccountId) : null, true],
    [transfer ? t.creditAmountMinor : null, false],
    [transfer ? t.creditCurrency : null, true],
    [t.type === 'fee' ? t.parentTransactionId : null, true],
  ];
  return cells.map(([v, text]) => csvCell(v, text)).join(',') + '\r\n';
}
