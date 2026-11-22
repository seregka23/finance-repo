import { Injectable, inject } from '@angular/core';
import { Api } from '../../core/api';

export interface Reserve {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  status: 'active' | 'archived';
  balanceMinor: string;
}
export interface ReserveMovement {
  id: string;
  reserveId: string;
  accountId: string;
  transactionId: string | null;
  type: string;
  movementDate: string;
  amountMinor: string;
  createdAt: string;
}
export interface ReserveMovementPage {
  movements: ReserveMovement[];
  nextCursor: string | null;
}
@Injectable({ providedIn: 'root' })
export class ReservesService {
  private api = inject(Api);
  private base(h: string) {
    return `/households/${encodeURIComponent(h)}/reserves`;
  }
  list(h: string) {
    return this.api.request<{ reserves: Reserve[] }>(this.base(h));
  }
  get(h: string, id: string) {
    return this.api.request<Reserve>(`${this.base(h)}/${encodeURIComponent(id)}`);
  }
  create(h: string, accountId: string, name: string) {
    return this.api.request<Reserve>(this.base(h), 'POST', { accountId, name });
  }
  movements(h: string, id: string, cursor?: string) {
    return this.api.request<ReserveMovementPage>(
      `${this.base(h)}/${encodeURIComponent(id)}/movements?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
    );
  }
  move(h: string, id: string, type: 'allocation' | 'release', amountMinor: string) {
    return this.api.request<{ reserve: Reserve; movement: ReserveMovement }>(
      `${this.base(h)}/${encodeURIComponent(id)}/movements`,
      'POST',
      { type, amountMinor },
    );
  }
}
