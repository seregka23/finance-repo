import { Injectable, inject } from '@angular/core';
import { Api, Members } from './api';

export type Currency = 'RSD' | 'EUR' | 'RUB' | 'USD';
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

/** Formats a calendar date without shifting its day or remapping early years. */
export function formatCalendarDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

/** Converts a decimal amount to minor units without floating point arithmetic. */
export function decimalToMinor(value: string, signed = false, locale = 'en-US'): string | null {
  if (/^(ru|sr)(-|$)/i.test(locale)) value = value.replace(',', '.');
  const match = value
    .trim()
    .match(signed ? /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/ : /^(\+?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const digits = (match[2] + (match[3] ?? '').padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  return match[1] === '-' && digits !== '0' ? '-' + digits : digits;
}
export function formatMinor(value: string, currency: string, locale = 'en-US'): string {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(3, '0');
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    BigInt(digits.slice(0, -2)),
  );
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.';
  return `${negative ? '−' : ''}${whole}${decimal}${digits.slice(-2)} ${currency}`;
}
@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly api = inject(Api);
  private base(h: string): string {
    return `/households/${encodeURIComponent(h)}/accounts`;
  }
  private item(h: string, id: string): string {
    return `${this.base(h)}/${encodeURIComponent(id)}`;
  }
  list(h: string): Promise<{ accounts: Account[] }> {
    return this.api.request(`${this.base(h)}?status=all`);
  }
  members(h: string): Promise<Members> {
    return this.api.request(`/households/${encodeURIComponent(h)}/members`);
  }
  get(h: string, id: string): Promise<Account> {
    return this.api.request(this.item(h, id));
  }
  create(
    h: string,
    body: AccountInput & { openingBalanceMinor: string; openingDate: string },
  ): Promise<Account> {
    return this.api.request(this.base(h), 'POST', body);
  }
  update(h: string, id: string, body: AccountInput & { version: number }): Promise<Account> {
    return this.api.request(this.item(h, id), 'PATCH', body);
  }
  toggle(h: string, a: Account): Promise<Account> {
    return this.api.request(
      `${this.item(h, a.id)}/${a.status === 'active' ? 'archive' : 'restore'}`,
      'POST',
      { version: a.version },
    );
  }
  adjust(h: string, a: Account, amountMinor: string, movementDate: string): Promise<Account> {
    return this.api.request(`${this.item(h, a.id)}/adjustments`, 'POST', {
      amountMinor,
      movementDate,
      version: a.version,
    });
  }
  movements(h: string, id: string, cursor?: string): Promise<MovementPage> {
    return this.api.request(
      `${this.item(h, id)}/movements?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
    );
  }
}
