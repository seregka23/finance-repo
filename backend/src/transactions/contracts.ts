import type { Currency } from '../finance/money.js';

export interface PostingInput {
  type: 'expense' | 'income';
  transactionDate: string;
  accountId: string;
  categoryId: string;
  amountMinor: string;
  currency: Currency;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
  merchant: string | null;
  note: string | null;
}

export interface TransactionRecord extends PostingInput {
  id: string;
  householdId: string;
  authorMemberId: string;
  version: number;
  status: 'posted' | 'void';
  rsdEquivalentMinor: string | null;
  createdAt: string;
  updatedAt: string;
}
