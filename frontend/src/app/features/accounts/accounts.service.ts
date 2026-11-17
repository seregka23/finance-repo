import { Injectable, inject } from '@angular/core';
import { Api, Members } from '../../core/api';

import type { Account, AccountInput, MovementPage } from './account.model';

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
