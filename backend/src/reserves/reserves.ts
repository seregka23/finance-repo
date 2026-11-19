import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { apiError, unavailable } from '../auth/auth.errors.js';
import type { AuthRequest, Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { householdDateForInstant, validateDate } from '../finance/calendar.js';
import { parseMinor } from '../finance/money.js';

const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
function fields(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    throw invalid();
  return v.trim();
}
function error(e: unknown): never {
  const s = String(e);
  if (s.includes('household_access_denied'))
    throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
  if (s.includes('reserve_account_ineligible'))
    throw apiError(409, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible');
  if (s.includes('reserve_ineligible'))
    throw apiError(409, 'RESERVE_NOT_ELIGIBLE', 'Reserve is not eligible');
  if (s.includes('reserve_balance_invalid'))
    throw apiError(
      409,
      'INSUFFICIENT_FUNDS',
      'Available balance is insufficient',
    );
  throw unavailable();
}
@Injectable()
export class ReservesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prisma: PrismaService,
  ) {}
  private stmt(sql: string, ...v: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...v);
  }
  private access(i: Identity, h: string) {
    return this.stmt(
      'INSERT INTO household_access_checks(household_id,identity_subject,required_role) VALUES(?,?,?)',
      h,
      i.subject,
      'member',
    );
  }
  private written() {
    return this.stmt(
      'INSERT INTO posting_write_checks(changed) VALUES(changes())',
    );
  }
  private assert(sql: string, ...v: (string | number | null)[]) {
    return this.stmt(
      `INSERT INTO posting_write_checks(changed) SELECT count(*) FROM (${sql})`,
      ...v,
    );
  }
  private audit(
    i: Identity,
    h: string,
    id: string,
    action: string,
    details: string,
    now: string,
  ) {
    const auditId = crypto.randomUUID();
    return [
      this.stmt(
        "INSERT INTO audit_events(id,household_id,actor_member_id,action,reserve_id,details_json,created_at) VALUES(?,?,(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active'),?,?,?,?)",
        auditId,
        h,
        h,
        i.subject,
        action,
        id,
        details,
        now,
      ),
      this.written(),
      this.assert(
        "SELECT id FROM audit_events WHERE id=? AND household_id=? AND reserve_id=? AND action=? AND details_json=? AND actor_member_id=(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active')",
        auditId,
        h,
        id,
        action,
        details,
        h,
        i.subject,
      ),
    ];
  }
  private readResult(h: string, id: string) {
    return this.stmt(
      `SELECT r.id,r.account_id AS accountId,r.name,r.status,a.currency,CAST(COALESCE((SELECT SUM(m.amount_minor) FROM reserve_movements m WHERE m.household_id=r.household_id AND m.reserve_id=r.id),0) AS TEXT) AS balanceMinor FROM reserves r JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id WHERE r.household_id=? AND r.id=?`,
      h,
      id,
    );
  }
  private async batch(s: D1PreparedStatement[]) {
    try {
      return await this.db.batch(s);
    } catch (e) {
      return error(e);
    }
  }
  private async scope(i: Identity, h: string) {
    const household = await this.prisma.household.findFirst({
      where: {
        id: h,
        status: 'active',
        members: { some: { identitySubject: i.subject, status: 'active' } },
      },
      select: { timeZone: true },
    });
    if (!household)
      throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
    return household;
  }
  private async read(i: Identity, h: string, id?: string) {
    await this.scope(i, h);
    const result = await this.prisma.$queryRaw<
      {
        id: string;
        accountId: string;
        name: string;
        status: string;
        currency: string;
        balanceMinor: string;
      }[]
    >(
      Prisma.sql`SELECT r.id,r.account_id AS accountId,r.name,r.status,a.currency,CAST(COALESCE((SELECT SUM(m.amount_minor) FROM reserve_movements m WHERE m.household_id=r.household_id AND m.reserve_id=r.id),0) AS TEXT) AS balanceMinor FROM reserves r JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id JOIN households h ON h.id=r.household_id WHERE r.household_id=${h} AND (${id ?? null} IS NULL OR r.id=${id ?? null}) AND h.status='active' AND EXISTS(SELECT 1 FROM household_members member WHERE member.household_id=h.id AND member.identity_subject=${i.subject} AND member.status='active') ORDER BY r.name,r.id`,
    );
    return result;
  }
  async list(i: Identity, h: string) {
    return { reserves: await this.read(i, h) };
  }
  async get(i: Identity, h: string, id: string) {
    const r = (await this.read(i, h, text(id)))[0];
    if (!r) throw apiError(404, 'RESERVE_NOT_FOUND', 'Reserve not found');
    return r;
  }
  async create(i: Identity, h: string, value: unknown) {
    const b = fields(value, ['accountId', 'name']),
      account = text(b.accountId),
      name = text(b.name, 100),
      id = crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await this.batch([
      this.access(i, h),
      this.stmt(
        "INSERT INTO reserve_checks(household_id,reserve_id,account_id,operation) VALUES(?,?,?,'create')",
        h,
        id,
        account,
      ),
      this.stmt(
        "INSERT INTO reserves(id,household_id,account_id,name,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)",
        id,
        h,
        account,
        name,
        now,
        now,
      ),
      this.written(),
      this.assert(
        "SELECT id FROM reserves WHERE household_id=? AND id=? AND account_id=? AND name=? AND status='active'",
        h,
        id,
        account,
        name,
      ),
      ...this.audit(
        i,
        h,
        id,
        'reserve.created',
        JSON.stringify({ accountId: account, name }),
        now,
      ),
      this.readResult(h, id),
    ]);
    const created = result.at(-1)?.results?.[0];
    if (!created) throw unavailable();
    return created;
  }
  async movements(i: Identity, h: string, id: string, value: unknown) {
    const b = fields(value, ['limit', 'cursor']);
    if (
      b.limit !== undefined &&
      (typeof b.limit !== 'string' || !/^(?:[1-9]|[1-9]\d|100)$/.test(b.limit))
    )
      throw invalid();
    const limit = b.limit === undefined ? 50 : Number(b.limit);
    let cursor: { movementDate: string; id: string } | null = null;
    if (b.cursor !== undefined) {
      try {
        if (
          typeof b.cursor !== 'string' ||
          b.cursor.length > 1024 ||
          !/^[A-Za-z0-9_-]+$/.test(b.cursor)
        )
          throw invalid();
        const c = fields(
          JSON.parse(atob(b.cursor.replaceAll('-', '+').replaceAll('_', '/'))),
          ['movementDate', 'id'],
        );
        if (Object.keys(c).length !== 2 || text(c.id) !== c.id) throw invalid();
        cursor = { movementDate: validateDate(c.movementDate), id: text(c.id) };
      } catch {
        throw invalid();
      }
    }
    await this.get(i, h, id);
    const rows = await this.prisma.reserveMovement.findMany({
      where: {
        householdId: h,
        reserveId: id,
        ...(cursor
          ? {
              OR: [
                { movementDate: { lt: cursor.movementDate } },
                { movementDate: cursor.movementDate, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ movementDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const movements = rows.slice(0, limit).map((m) => ({
      id: m.id,
      reserveId: m.reserveId,
      accountId: m.accountId,
      transactionId: m.transactionId,
      type: m.type,
      movementDate: m.movementDate,
      amountMinor: m.amountMinor.toString(),
      createdAt: m.createdAt,
    }));
    const last = movements.at(-1),
      nextCursor =
        rows.length > limit && last
          ? btoa(
              JSON.stringify({ movementDate: last.movementDate, id: last.id }),
            )
              .replaceAll('+', '-')
              .replaceAll('/', '_')
              .replace(/=+$/, '')
          : null;
    await this.scope(i, h);
    return { movements, nextCursor };
  }
  async move(i: Identity, h: string, id: string, value: unknown) {
    const b = fields(value, ['type', 'amountMinor']);
    if (b.type !== 'allocation' && b.type !== 'release') throw invalid();
    let amount: bigint;
    try {
      amount = parseMinor(b.amountMinor);
      if (amount <= 0n) throw invalid();
    } catch {
      throw invalid();
    }
    const reserve = await this.get(i, h, id),
      household = await this.scope(i, h),
      now = new Date().toISOString(),
      date = householdDateForInstant(now, household.timeZone),
      movementId = crypto.randomUUID(),
      type = b.type,
      amountText = amount.toString();
    const result = await this.batch([
      this.access(i, h),
      this.stmt(
        'INSERT INTO reserve_checks(household_id,reserve_id,account_id,transaction_id,operation,amount_minor) VALUES(?,?,?,NULL,?,CAST(? AS INTEGER))',
        h,
        id,
        reserve.accountId,
        type,
        amountText,
      ),
      this.stmt(
        'INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,transaction_id,type,movement_date,amount_minor,created_at) VALUES(?,?,?,?,NULL,?,?,CAST(? AS INTEGER),?)',
        movementId,
        h,
        id,
        reserve.accountId,
        type,
        date,
        (type === 'release' ? -amount : amount).toString(),
        now,
      ),
      this.written(),
      this.stmt(
        'INSERT INTO reserve_movement_result_checks(id,household_id,reserve_id,account_id,transaction_id,operation,amount_minor) VALUES(?,?,?,?,NULL,?,CAST(? AS INTEGER))',
        movementId,
        h,
        id,
        reserve.accountId,
        type,
        amountText,
      ),
      ...this.audit(
        i,
        h,
        id,
        'reserve.' + type,
        JSON.stringify({ movementId, amountMinor: amountText }),
        now,
      ),
      this.readResult(h, id),
    ]);
    const updated = result.at(-1)?.results?.[0];
    if (!updated) throw unavailable();
    return {
      reserve: updated,
      movement: {
        id: movementId,
        reserveId: id,
        accountId: reserve.accountId,
        transactionId: null,
        type,
        movementDate: date,
        amountMinor: (type === 'release' ? -amount : amount).toString(),
        createdAt: now,
      },
    };
  }
}

@Controller('api/v1/households/:householdId/reserves')
export class ReservesController {
  constructor(private readonly service: ReservesService) {}
  @Get() list(@Req() r: AuthRequest, @Param('householdId') h: string) {
    return this.service.list(r.identity, h);
  }
  @Post() create(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Body() b: unknown,
  ) {
    return this.service.create(r.identity, h, b);
  }
  @Get(':id') get(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(r.identity, h, id);
  }
  @Get(':id/movements') movements(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.movements(r.identity, h, id, q);
  }
  @Post(':id/movements') move(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.move(r.identity, h, id, b);
  }
}
