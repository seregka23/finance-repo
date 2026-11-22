import { describe, expect, it } from 'vitest';
import { summarizeBalances, summarizeReport } from './reports.js';
const base = {
  id: 'a',
  type: 'expense',
  categoryId: 'c',
  categoryName: 'Food',
  merchant: 'Shop',
  movementId: 'm',
  currency: 'RSD',
  amountMinor: '-1000',
  rsdEquivalentMinor: null,
  exchangeRate: null,
};
describe('report calculations', () => {
  it('counts posted transfers but excludes them from cash flow and nets refunds', () => {
    const report = summarizeReport([
      base,
      { ...base, id: 'b', type: 'refund', amountMinor: '200' },
      {
        ...base,
        id: 'c',
        type: 'income',
        categoryId: 'income',
        amountMinor: '500',
      },
      {
        ...base,
        id: 'd',
        type: 'transfer',
        movementId: null,
        currency: null,
        amountMinor: null,
      },
    ]);
    expect(report).toMatchObject({
      monthTransactionCount: 4,
      matchedTransactionCount: 4,
      totals: {
        incomeMinor: '500',
        expenseMinor: '800',
        netMinor: '-300',
        missingFxCount: 0,
      },
      byCategory: [{ categoryId: 'c', expenseMinor: '800' }],
      byMerchant: [{ name: 'Shop', expenseMinor: '800' }],
    });
  });
  it('distinguishes no matches and retains known FX while marking incomplete', () => {
    const rows = [
      base,
      {
        ...base,
        id: 'b',
        currency: 'EUR',
        amountMinor: '-10',
        rsdEquivalentMinor: '-1200',
        exchangeRate: null,
      },
      {
        ...base,
        id: 'c',
        currency: 'EUR',
        amountMinor: '-5',
        rsdEquivalentMinor: null,
        exchangeRate: null,
      },
    ];
    expect(summarizeReport(rows, 'c', 'shop')).toMatchObject({
      monthTransactionCount: 3,
      matchedTransactionCount: 3,
      totals: {
        expenseMinor: '2200',
        missingFxCount: 2,
        originalCurrencies: [
          { currency: 'EUR', expenseMinor: '15' },
          { currency: 'RSD', expenseMinor: '1000' },
        ],
      },
    });
    expect(summarizeReport(rows, null, '%')).toMatchObject({
      monthTransactionCount: 3,
      matchedTransactionCount: 0,
      totals: { incomeMinor: '0', expenseMinor: '0' },
    });
  });
  it('adds currency balances and reserves with integer precision', () => {
    expect(
      summarizeBalances([
        { currency: 'RSD', kind: 'balance', amountMinor: '9007199254740991' },
        { currency: 'RSD', kind: 'balance', amountMinor: '9' },
        { currency: 'RSD', kind: 'reserve', amountMinor: '100' },
      ]),
    ).toEqual([
      {
        currency: 'RSD',
        balanceMinor: '9007199254741000',
        reservedMinor: '100',
        availableMinor: '9007199254740900',
      },
    ]);
  });
});
