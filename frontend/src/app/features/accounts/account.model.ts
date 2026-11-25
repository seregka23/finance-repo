export type Currency = 'RSD' | 'EUR' | 'RUB' | 'USD';
export interface AccountInput {
  name: string;
  type: 'cash' | 'bank' | 'card';
  currency: Currency;
  ownerMemberId: string | null;
  designation: 'personal' | 'business';
  bankName?: string | null;
  cardLastFour?: string | null;
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
export interface Movement {
  id: string;
  type: 'transaction' | 'opening_balance' | 'adjustment';
  movementDate: string;
  amountMinor: string;
  currency: Currency;
  transactionId: string | null;
  createdAt: string;
}
export interface MovementPage {
  movements: Movement[];
  nextCursor: string | null;
}
