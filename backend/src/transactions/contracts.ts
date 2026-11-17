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

export interface TransferFeeInput {
  amountMinor: string;
  categoryId: string;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
}

export interface TransferInput {
  type: 'transfer';
  transactionDate: string;
  fromAccountId: string;
  toAccountId: string;
  debitAmountMinor: string;
  creditAmountMinor: string;
  debitCurrency: Currency;
  creditCurrency: Currency;
  fee: TransferFeeInput | null;
  merchant: string | null;
  note: string | null;
}

export interface TransferFeeRecord extends TransferFeeInput {
  id: string;
  accountId: string;
  currency: Currency;
  rsdEquivalentMinor: string | null;
}

export interface TransferRecord extends Omit<TransferInput, 'fee'> {
  id: string;
  householdId: string;
  fee: TransferFeeRecord | null;
  authorMemberId: string;
  status: 'posted' | 'void';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeeRecord extends Omit<TransactionRecord, 'type'> {
  type: 'fee';
  parentTransactionId: string;
}

export interface RefundInput {
  type: 'refund';
  transactionDate: string;
  purchaseTransactionId: string;
  accountId: string;
  amountMinor: string;
  merchant: string | null;
  note: string | null;
}

export interface RefundRecord extends RefundInput {
  id: string;
  householdId: string;
  authorMemberId: string;
  categoryId: string;
  currency: Currency;
  exchangeRate: string | null;
  exchangeRateSource: string | null;
  rsdEquivalentMinor: string | null;
  version: number;
  status: 'posted' | 'void';
  createdAt: string;
  updatedAt: string;
}

export type AnyTransactionRecord = TransactionRecord | TransferRecord | FeeRecord | RefundRecord;
