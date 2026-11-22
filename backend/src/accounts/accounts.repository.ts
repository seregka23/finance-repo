import { Inject, Injectable } from '@nestjs/common';
import { apiError, unavailable } from '../auth/auth.errors.js';
import type { Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import type {
  Account,
  AccountInput,
  AccountMovement,
  MovementPage,
} from './accounts.types.js';

const select = `SELECT a.id,a.name,a.type,a.currency,a.owner_member_id AS ownerMemberId,a.designation,a.status,a.version,a.currency_locked AS currencyLocked,a.created_at AS createdAt,a.updated_at AS updatedAt,
 CAST((SELECT COALESCE(SUM(amount_minor),0) FROM account_movements WHERE household_id=a.household_id AND account_id=a.id) AS TEXT) AS balanceMinor,
 CAST((SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements WHERE household_id=a.household_id AND account_id=a.id) AS TEXT) AS reservedMinor FROM accounts a`;
function translate(e: unknown): never {
  const errors: [string, number, string, string][] = [
    [
      'household_access_denied',
      404,
      'HOUSEHOLD_NOT_FOUND',
      'Household not found',
    ],
    [
      'account_reserve_nonzero',
      409,
      'ACCOUNT_RESERVE_NONZERO',
      'Release all reserved funds before archiving this account',
    ],
    ['account_not_found', 404, 'ACCOUNT_NOT_FOUND', 'Account not found'],
    [
      'account_version_conflict',
      409,
      'VERSION_CONFLICT',
      'Account was changed',
    ],
    [
      'account_owner_ineligible',
      409,
      'OWNER_NOT_ELIGIBLE',
      'Owner is not an active household member',
    ],
    ['account_ineligible', 409, 'ACCOUNT_NOT_ELIGIBLE', 'Account is archived'],
    [
      'account_currency_locked',
      409,
      'CURRENCY_LOCKED',
      'Account currency cannot be changed',
    ],
    [
      'account_balance_invalid',
      409,
      'INSUFFICIENT_FUNDS',
      'Account balance would be invalid',
    ],
  ];
  for (const [needle, status, code, message] of errors)
    if (String(e).includes(needle)) throw apiError(status, code, message);
  throw unavailable();
}
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  private stmt(
    sql: string,
    ...values: (string | number | null)[]
  ): D1PreparedStatement {
    return this.db.prepare(sql).bind(...values);
  }
  private access(identity: Identity, householdId: string) {
    return this.stmt(
      'INSERT INTO household_access_checks(household_id,identity_subject,required_role) VALUES(?,?,?)',
      householdId,
      identity.subject,
      'member',
    );
  }
  private check(
    householdId: string,
    id: string,
    version: number | null,
    owner: string | null,
    operation: string,
    amount: string | null = null,
  ) {
    return this.stmt(
      'INSERT INTO account_checks(household_id,account_id,version,owner_id,operation,amount) VALUES(?,?,?,?,?,?)',
      householdId,
      id,
      version,
      owner,
      operation,
      amount,
    );
  }
  private written() {
    return this.stmt(
      'INSERT INTO posting_write_checks(changed) VALUES(changes())',
    );
  }
  private member() {
    return `(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active')`;
  }
  private audit(
    identity: Identity,
    householdId: string,
    id: string,
    action: string,
    details: string,
    now: string,
  ) {
    return this.stmt(
      `INSERT INTO audit_events(id,household_id,actor_member_id,action,account_id,details_json,created_at) VALUES(?,?,${this.member()},?,?,?,?)`,
      crypto.randomUUID(),
      householdId,
      householdId,
      identity.subject,
      action,
      id,
      details,
      now,
    );
  }
  private read(householdId: string, id: string) {
    return this.stmt(
      `${select} WHERE a.household_id=? AND a.id=?`,
      householdId,
      id,
    );
  }
  private async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    try {
      return await this.db.batch(statements);
    } catch (e) {
      return translate(e);
    }
  }
  private account(row: unknown): Account {
    const a = row as Omit<Account, 'currencyLocked' | 'availableMinor'> & {
      currencyLocked: number;
    };
    return {
      ...a,
      currencyLocked: Boolean(a.currencyLocked),
      availableMinor: (
        BigInt(a.balanceMinor) - BigInt(a.reservedMinor)
      ).toString(),
    };
  }
  private result(rows: D1Result[]): Account {
    const row = rows.at(-1)?.results?.[0];
    if (!row) throw unavailable();
    return this.account(row);
  }
  async list(
    identity: Identity,
    householdId: string,
    status: 'all' | 'active' | 'archived',
  ): Promise<{ accounts: Account[] }> {
    const r = await this.batch([
      this.access(identity, householdId),
      this.stmt(
        `${select} WHERE a.household_id=? AND (?='all' OR a.status=?) ORDER BY a.name COLLATE NOCASE,a.id`,
        householdId,
        status,
        status,
      ),
    ]);
    return { accounts: (r[1].results ?? []).map((x) => this.account(x)) };
  }
  async get(
    identity: Identity,
    householdId: string,
    id: string,
  ): Promise<Account> {
    const r = await this.batch([
      this.access(identity, householdId),
      this.read(householdId, id),
    ]);
    const row = r[1].results?.[0];
    if (!row) throw apiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    return this.account(row);
  }
  async create(
    identity: Identity,
    householdId: string,
    input: AccountInput,
    openingBalanceMinor: string,
    openingDate: string,
  ): Promise<Account> {
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const rows = await this.batch([
      this.access(identity, householdId),
      this.check(householdId, id, null, input.ownerMemberId, 'create'),
      this.stmt(
        "INSERT INTO accounts(id,household_id,name,type,currency,owner_member_id,designation,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)",
        id,
        householdId,
        input.name,
        input.type,
        input.currency,
        input.ownerMemberId,
        input.designation,
        now,
        now,
      ),
      this.written(),
      this.stmt(
        "INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) VALUES(?,?,?,'opening_balance',?,CAST(? AS INTEGER),?,?)",
        crypto.randomUUID(),
        householdId,
        id,
        openingDate,
        openingBalanceMinor,
        input.currency,
        now,
      ),
      this.written(),
      this.audit(
        identity,
        householdId,
        id,
        'account.created',
        JSON.stringify({ ...input, openingBalanceMinor, openingDate }),
        now,
      ),
      this.written(),
      this.read(householdId, id),
    ]);
    return this.result(rows);
  }
  async update(
    identity: Identity,
    householdId: string,
    id: string,
    input: AccountInput,
    version: number,
  ): Promise<Account> {
    const now = new Date().toISOString();
    const r = await this.batch([
      this.access(identity, householdId),
      this.check(householdId, id, version, input.ownerMemberId, 'update'),
      this.stmt(
        'UPDATE accounts SET name=?,type=?,currency=?,owner_member_id=?,designation=?,version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=?',
        input.name,
        input.type,
        input.currency,
        input.ownerMemberId,
        input.designation,
        now,
        householdId,
        id,
        version,
      ),
      this.written(),
      this.audit(
        identity,
        householdId,
        id,
        'account.updated',
        JSON.stringify({ input, version }),
        now,
      ),
      this.written(),
      this.read(householdId, id),
    ]);
    return this.result(r);
  }
  async setStatus(
    identity: Identity,
    householdId: string,
    id: string,
    status: 'active' | 'archived',
    version: number,
  ): Promise<Account> {
    const now = new Date().toISOString();
    const r = await this.batch([
      this.access(identity, householdId),
      this.check(householdId, id, version, null, 'status'),
      this.stmt(
        'UPDATE accounts SET status=?,version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=?',
        status,
        now,
        householdId,
        id,
        version,
      ),
      this.written(),
      this.audit(
        identity,
        householdId,
        id,
        'account.status_changed',
        JSON.stringify({ status, version }),
        now,
      ),
      this.written(),
      this.read(householdId, id),
    ]);
    return this.result(r);
  }
  async adjust(
    identity: Identity,
    householdId: string,
    id: string,
    amountMinor: string,
    movementDate: string,
    version: number,
  ): Promise<Account> {
    const now = new Date().toISOString();
    const r = await this.batch([
      this.access(identity, householdId),
      this.check(householdId, id, version, null, 'adjust', amountMinor),
      this.stmt(
        'UPDATE accounts SET version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=?',
        now,
        householdId,
        id,
        version,
      ),
      this.written(),
      this.stmt(
        "INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) SELECT ?,household_id,id,'adjustment',?,CAST(? AS INTEGER),currency,? FROM accounts WHERE household_id=? AND id=?",
        crypto.randomUUID(),
        movementDate,
        amountMinor,
        now,
        householdId,
        id,
      ),
      this.written(),
      this.audit(
        identity,
        householdId,
        id,
        'account.adjusted',
        JSON.stringify({ amountMinor, movementDate, version }),
        now,
      ),
      this.written(),
      this.read(householdId, id),
    ]);
    return this.result(r);
  }
  async movements(
    identity: Identity,
    householdId: string,
    id: string,
    options: {
      limit: number;
      cursor: { movementDate: string; id: string } | null;
    },
  ): Promise<MovementPage> {
    const c = options.cursor;
    const r = await this.batch([
      this.access(identity, householdId),
      this.read(householdId, id),
      this.stmt(
        `SELECT id,type,movement_date AS movementDate,CAST(amount_minor AS TEXT) AS amountMinor,currency,transaction_id AS transactionId,created_at AS createdAt FROM account_movements WHERE household_id=? AND account_id=? AND (? IS NULL OR movement_date<? OR (movement_date=? AND id<?)) ORDER BY movement_date DESC,id DESC LIMIT ?`,
        householdId,
        id,
        c?.movementDate ?? null,
        c?.movementDate ?? null,
        c?.movementDate ?? null,
        c?.id ?? null,
        options.limit + 1,
      ),
    ]);
    if (!r[1].results?.length)
      throw apiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    const rows = r[2].results as unknown as AccountMovement[];
    const movements = rows.slice(0, options.limit),
      last = movements.at(-1);
    const nextCursor =
      rows.length > options.limit && last
        ? btoa(JSON.stringify({ movementDate: last.movementDate, id: last.id }))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replace(/=+$/, '')
        : null;
    return { movements, nextCursor };
  }
}
