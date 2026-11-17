import type { Currency } from '../finance/money.js';

export interface AccountInput {
  name: string;
  type: 'cash' | 'bank' | 'card';
  currency: Currency;
  ownerMemberId: string | null;
  designation: 'personal' | 'business';
}
export interface Account extends AccountInput {
  id: string;
  status: 'active' | 'archived';
  version: number;
  currencyLocked: boolean;
  balanceMinor: string;
  reservedMinor: string;
  availableMinor: string;
  createdAt: string;
  updatedAt: string;
}
export interface AccountMovement {
  id: string;
  type: 'transaction' | 'opening_balance' | 'adjustment';
  movementDate: string;
  amountMinor: string;
  currency: Currency;
  transactionId: string | null;
  createdAt: string;
}
export interface AccountPage {
  accounts: Account[];
}
export interface MovementPage {
  movements: AccountMovement[];
  nextCursor: string | null;
}
