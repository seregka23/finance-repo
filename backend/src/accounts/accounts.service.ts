import { Injectable } from '@nestjs/common';
import { apiError } from '../auth/auth.errors.js';
import type { Identity } from '../auth/auth.types.js';
import { validateDate } from '../finance/calendar.js';
import { parseMinor, validateCurrency } from '../finance/money.js';
import { validateRequest } from '../validation/request-dto.js';
import {
  CreateAccountDto,
  UpdateAccountDto,
  AccountVersionDto,
  AccountAdjustmentDto,
  AccountListQueryDto,
  MovementQueryDto,
} from './accounts.dto.js';
import { AccountsRepository } from './accounts.repository.js';
import type { AccountInput } from './accounts.types.js';

const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const metadata = ['name', 'type', 'currency', 'ownerMemberId', 'designation'];
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw invalid();
  return value.trim();
}
function accountMetadata(
  body: CreateAccountDto | UpdateAccountDto,
): Pick<AccountInput, 'bankName' | 'cardLastFour'> {
  if (!('bankName' in body) && !('cardLastFour' in body)) return {};
  if (!('bankName' in body) || !('cardLastFour' in body)) throw invalid();
  if (body.bankName === null && body.cardLastFour === null)
    return { bankName: null, cardLastFour: null };
  if (
    typeof body.cardLastFour !== 'string' ||
    !/^\d{4}$/.test(body.cardLastFour)
  )
    throw invalid();
  return {
    bankName: text(body.bankName, 100),
    cardLastFour: body.cardLastFour,
  };
}
function input(body: CreateAccountDto | UpdateAccountDto): AccountInput {
  if (
    metadata.some((key) => !(key in body)) ||
    (body.type !== 'cash' && body.type !== 'bank' && body.type !== 'card') ||
    (body.designation !== 'personal' && body.designation !== 'business')
  )
    throw invalid();
  return {
    name: text(body.name, 100),
    type: body.type as AccountInput['type'],
    currency: validateCurrency(body.currency),
    ownerMemberId:
      body.ownerMemberId === null ? null : text(body.ownerMemberId),
    designation: body.designation as AccountInput['designation'],
    ...accountMetadata(body),
  };
}
function validate<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw invalid();
  }
}
@Injectable()
export class AccountsService {
  constructor(private readonly repository: AccountsRepository) {}
  create(identity: Identity, householdId: string, body: unknown) {
    const value = validate(() => {
      const b = validateRequest(CreateAccountDto, body);
      const account = input(b);
      const amount = parseMinor(b.openingBalanceMinor);
      if (amount < 0n) throw invalid();
      return {
        account,
        amount: amount.toString(),
        date: validateDate(b.openingDate),
      };
    });
    return this.repository.create(
      identity,
      householdId,
      value.account,
      value.amount,
      value.date,
    );
  }
  update(identity: Identity, householdId: string, id: string, body: unknown) {
    const value = validate(() => {
      const b = validateRequest(UpdateAccountDto, body);
      return { account: input(b), version: b.version };
    });
    return this.repository.update(
      identity,
      householdId,
      text(id),
      value.account,
      value.version,
    );
  }
  setStatus(
    identity: Identity,
    householdId: string,
    id: string,
    status: 'active' | 'archived',
    body: unknown,
  ) {
    const v = validateRequest(AccountVersionDto, body).version;
    return this.repository.setStatus(
      identity,
      householdId,
      text(id),
      status,
      v,
    );
  }
  adjust(identity: Identity, householdId: string, id: string, body: unknown) {
    const value = validate(() => {
      const b = validateRequest(AccountAdjustmentDto, body);
      const amount = parseMinor(b.amountMinor);
      if (amount === 0n) throw invalid();
      return {
        amount: amount.toString(),
        date: validateDate(b.movementDate),
        version: b.version,
      };
    });
    return this.repository.adjust(
      identity,
      householdId,
      text(id),
      value.amount,
      value.date,
      value.version,
    );
  }
  get(identity: Identity, householdId: string, id: string) {
    return this.repository.get(identity, householdId, text(id));
  }
  list(identity: Identity, householdId: string, query: unknown) {
    const q = validateRequest(AccountListQueryDto, query);
    const status = q.status ?? 'all';
    if (status !== 'all' && status !== 'active' && status !== 'archived')
      throw invalid();
    return this.repository.list(identity, householdId, status);
  }
  movements(
    identity: Identity,
    householdId: string,
    id: string,
    query: unknown,
  ) {
    const options = validate(() => {
      const q = validateRequest(MovementQueryDto, query);
      if (
        q.limit !== undefined &&
        (typeof q.limit !== 'string' ||
          !/^(?:[1-9]|[1-9]\d|100)$/.test(q.limit))
      )
        throw invalid();
      let cursor: { movementDate: string; id: string } | null = null;
      if (q.cursor !== undefined) {
        if (
          typeof q.cursor !== 'string' ||
          q.cursor.length > 1024 ||
          !/^[A-Za-z0-9_-]+$/.test(q.cursor)
        )
          throw invalid();
        const decoded: unknown = JSON.parse(
          atob(q.cursor.replaceAll('-', '+').replaceAll('_', '/')),
        );
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
          throw invalid();
        const c = decoded as Record<string, unknown>;
        if (Object.keys(c).some((k) => !['movementDate', 'id'].includes(k)))
          throw invalid();
        if (Object.keys(c).length !== 2 || text(c.id) !== c.id) throw invalid();
        cursor = { movementDate: validateDate(c.movementDate), id: text(c.id) };
      }
      return { limit: q.limit === undefined ? 50 : Number(q.limit), cursor };
    });
    return this.repository.movements(identity, householdId, text(id), options);
  }
}
