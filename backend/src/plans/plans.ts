import { PlanQueryDto, CreatePlanDto, UpdatePlanDto } from './plans.dto.js';
import { validateRequest } from '../validation/request-dto.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { apiError, unavailable } from '../auth/auth.errors.js';
import type { Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Database } from '../database/database.types.js';
import {
  householdMonthForInstant,
  monthDateRange,
  validateMonth,
} from '../finance/calendar.js';
import { parseMinor } from '../finance/money.js';
import { recordedValue } from '../finance/report-valuation.js';
import { HouseholdAccessService } from '../households/household-access.service.js';

const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const notFound = () => apiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
function text(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 200)
    throw invalid();
  return v.trim();
}
function month(v: unknown): string {
  try {
    return validateMonth(v);
  } catch {
    throw invalid();
  }
}
function amount(v: unknown): string {
  try {
    const n = parseMinor(v);
    if (n < 0n) throw invalid();
    return n.toString();
  } catch {
    throw invalid();
  }
}
interface PlanRow {
  id: string;
  month: string;
  categoryId: string;
  categoryName: string;
  categoryStatus: string;
  limitMinor: string;
  movementId: string | null;
  currency: string | null;
  amountMinor: string | null;
  rsdEquivalentMinor: string | null;
  exchangeRate: string | null;
}
export interface Plan {
  id: string;
  month: string;
  categoryId: string;
  categoryName: string;
  categoryStatus: string;
  limitMinor: string;
  actualMinor: string;
  remainingMinor: string | null;
  overspentMinor: string | null;
  utilizationBasisPoints: string | null;
  missingFxCount: number;
}
/** Fold signed ledger values with exact integer arithmetic, retaining known FX subtotals. */
export function summarizePlans(rows: PlanRow[]): Plan[] {
  const plans = new Map<
    string,
    { row: PlanRow; actual: bigint; missing: number }
  >();
  for (const row of rows) {
    let p = plans.get(row.id);
    if (!p) {
      p = { row, actual: 0n, missing: 0 };
      plans.set(row.id, p);
    }
    if (!row.movementId) continue;
    if (row.currency === null || row.amountMinor === null)
      throw new Error('Invalid movement');
    const value = recordedValue({
      currency: row.currency,
      amountMinor: row.amountMinor,
      rsdEquivalentMinor: row.rsdEquivalentMinor,
      exchangeRate: row.exchangeRate,
    });
    if (value.missing) p.missing++;
    if (value.rsd !== null) p.actual -= value.rsd;
  }
  return Array.from(plans.values(), ({ row, actual, missing }) => {
    const limit = BigInt(row.limitMinor),
      remaining = limit - actual;
    const magnitude = actual < 0n ? -actual : actual;
    const ratio =
      limit === 0n
        ? null
        : ((magnitude * 10000n + limit / 2n) / limit) *
          (actual < 0n ? -1n : 1n);
    return {
      id: row.id,
      month: row.month,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryStatus: row.categoryStatus,
      limitMinor: row.limitMinor,
      actualMinor: actual.toString(),
      remainingMinor: missing ? null : remaining.toString(),
      overspentMinor: missing
        ? null
        : (remaining < 0n ? -remaining : 0n).toString(),
      utilizationBasisPoints:
        missing || ratio === null ? null : ratio.toString(),
      missingFxCount: missing,
    };
  });
}
@Injectable()
export class PlansService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
    private readonly prisma: PrismaService,
  ) {}
  private stmt(sql: string, ...args: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...args);
  }
  private written() {
    return this.stmt(
      'INSERT INTO posting_write_checks(changed) VALUES(changes())',
    );
  }
  private query(h: string, m: string, id: string | null = null) {
    const { startDate, endDate } = monthDateRange(m);
    return this.stmt(
      `SELECT p.id,p.month,p.category_id AS categoryId,c.name AS categoryName,c.status AS categoryStatus,CAST(p.limit_minor AS TEXT) AS limitMinor,v.movement_id AS movementId,v.currency,CAST(v.amount_minor AS TEXT) AS amountMinor,CAST(v.rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor,m.exchange_rate AS exchangeRate FROM monthly_plans p JOIN categories c ON c.household_id=p.household_id AND c.id=p.category_id LEFT JOIN transaction_reporting_movements v ON v.household_id=p.household_id AND v.category_id=p.category_id AND v.type IN ('expense','fee','refund') AND v.transaction_date>=? AND v.transaction_date<=? LEFT JOIN account_movements m ON m.household_id=v.household_id AND m.id=v.movement_id WHERE p.household_id=? AND p.month=? AND (? IS NULL OR p.id=?) ORDER BY c.name,p.id,v.transaction_id,v.movement_id`,
      startDate,
      endDate,
      h,
      m,
      id,
      id,
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
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,details_json,created_at) VALUES(?,?,(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active'),?,?,?)`,
        auditId,
        h,
        h,
        i.subject,
        action,
        details,
        now,
      ),
      this.written(),
      this.stmt(
        `INSERT INTO posting_write_checks(changed) SELECT count(*) FROM audit_events WHERE id=? AND household_id=? AND actor_member_id=(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active') AND action=? AND details_json=?`,
        auditId,
        h,
        h,
        i.subject,
        action,
        details,
      ),
    ];
  }
  private async batch(
    i: Identity,
    h: string,
    statements: D1PreparedStatement[],
    operation: 'create' | 'update' | 'delete' | 'read',
    id?: string,
  ) {
    try {
      return await this.db.batch([
        this.stmt(
          'INSERT INTO household_access_checks(household_id,identity_subject,required_role) VALUES(?,?,?)',
          h,
          i.subject,
          'member',
        ),
        ...statements,
      ]);
    } catch (e) {
      const s = String(e);
      if (s.includes('household_access_denied'))
        throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
      if (s.includes('category_not_eligible'))
        throw apiError(
          409,
          'CATEGORY_NOT_ELIGIBLE',
          'Category is not eligible for a plan',
        );
      if (
        s.includes(
          'UNIQUE constraint failed: monthly_plans.household_id, monthly_plans.month, monthly_plans.category_id',
        )
      )
        throw apiError(
          409,
          'PLAN_EXISTS',
          'A plan already exists for this category and month',
        );
      if (operation === 'delete' && s.includes('FOREIGN KEY constraint failed'))
        throw apiError(409, 'PLAN_LINKED', 'Plan has linked records');
      if (id && s.includes('posting_result_invalid')) {
        let rows: { planId: string | null }[];
        try {
          rows = await this.prisma.$queryRaw<
            { planId: string | null }[]
          >(Prisma.sql`
          SELECT p.id AS planId FROM households h JOIN household_members m ON m.household_id=h.id
          AND m.identity_subject=${i.subject} AND m.status='active'
          LEFT JOIN monthly_plans p ON p.household_id=h.id AND p.id=${id}
          WHERE h.id=${h} AND h.status='active'`);
        } catch {
          throw unavailable();
        }
        if (!rows.length)
          throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
        if (!rows[0].planId) throw notFound();
      }
      throw unavailable();
    }
  }
  async list(i: Identity, h: string, value: unknown) {
    const q = validateRequest(PlanQueryDto, value);
    const household = await this.access.get(i, h);
    const m =
      q.month === undefined
        ? householdMonthForInstant(new Date().toISOString(), household.timeZone)
        : month(q.month);
    const { startDate, endDate } = monthDateRange(m);
    let rows: (PlanRow | { id: null })[];
    try {
      rows = await this.prisma.$queryRaw(Prisma.sql`
        SELECT p.id,p.month,p.category_id AS categoryId,c.name AS categoryName,c.status AS categoryStatus,CAST(p.limit_minor AS TEXT) AS limitMinor,v.movement_id AS movementId,v.currency,CAST(v.amount_minor AS TEXT) AS amountMinor,CAST(v.rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor,mov.exchange_rate AS exchangeRate
        FROM households h JOIN household_members member ON member.household_id=h.id AND member.identity_subject=${i.subject} AND member.status='active'
        LEFT JOIN (monthly_plans p JOIN categories c ON c.household_id=p.household_id AND c.id=p.category_id) ON p.household_id=h.id AND p.month=${m}
        LEFT JOIN transaction_reporting_movements v ON v.household_id=p.household_id AND v.category_id=p.category_id AND v.type IN ('expense','fee','refund') AND v.transaction_date>=${startDate} AND v.transaction_date<=${endDate}
        LEFT JOIN account_movements mov ON mov.household_id=v.household_id AND mov.id=v.movement_id
        WHERE h.id=${h} AND h.status='active' ORDER BY c.name,p.id,v.transaction_id,v.movement_id`);
    } catch {
      throw unavailable();
    }
    if (!rows.length)
      throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
    return {
      month: m,
      plans: summarizePlans(
        rows.filter((row): row is PlanRow => row.id !== null),
      ),
    };
  }
  async create(i: Identity, h: string, value: unknown) {
    const b = validateRequest(CreatePlanDto, value);
    const m = month(b.month),
      category = text(b.categoryId),
      limit = amount(b.limitMinor),
      id = crypto.randomUUID(),
      now = new Date().toISOString();
    const r = await this.batch(
      i,
      h,
      [
        this.stmt(
          "INSERT INTO category_selection_checks(household_id,category_id,usage) VALUES(?,?,'budget')",
          h,
          category,
        ),
        this.stmt(
          'INSERT INTO monthly_plans(id,household_id,month,category_id,limit_minor,created_at,updated_at) VALUES(?,?,?,?,CAST(? AS INTEGER),?,?)',
          id,
          h,
          m,
          category,
          limit,
          now,
          now,
        ),
        this.written(),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) SELECT count(*) FROM monthly_plans WHERE household_id=? AND id=? AND month=? AND category_id=? AND limit_minor=CAST(? AS INTEGER)',
          h,
          id,
          m,
          category,
          limit,
        ),
        ...this.audit(
          i,
          h,
          id,
          'plan.created',
          JSON.stringify({
            planId: id,
            month: m,
            categoryId: category,
            limitMinor: limit,
          }),
          now,
        ),
        this.query(h, m, id),
      ],
      'create',
    );
    const plan = summarizePlans(r.at(-1)!.results as unknown as PlanRow[])[0];
    if (!plan) throw unavailable();
    return plan;
  }
  private async existing(i: Identity, h: string, id: string) {
    const [, r] = await this.access.batch(i, h, 'member', [
      this.stmt(
        'SELECT month FROM monthly_plans WHERE household_id=? AND id=?',
        h,
        id,
      ),
    ]);
    const row = r.results[0] as { month: string } | undefined;
    if (!row) throw notFound();
    return row;
  }
  async update(i: Identity, h: string, id: string, value: unknown) {
    id = text(id);
    const limit = amount(validateRequest(UpdatePlanDto, value).limitMinor),
      current = await this.existing(i, h, id),
      now = new Date().toISOString();
    const r = await this.batch(
      i,
      h,
      [
        this.stmt(
          'UPDATE monthly_plans SET limit_minor=CAST(? AS INTEGER),updated_at=? WHERE household_id=? AND id=?',
          limit,
          now,
          h,
          id,
        ),
        this.written(),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) SELECT count(*) FROM monthly_plans WHERE household_id=? AND id=? AND limit_minor=CAST(? AS INTEGER)',
          h,
          id,
          limit,
        ),
        ...this.audit(
          i,
          h,
          id,
          'plan.updated',
          JSON.stringify({ planId: id, limitMinor: limit }),
          now,
        ),
        this.query(h, current.month, id),
      ],
      'update',
      id,
    );
    const plan = summarizePlans(r.at(-1)!.results as unknown as PlanRow[])[0];
    if (!plan) throw unavailable();
    return plan;
  }
  async remove(i: Identity, h: string, id: string) {
    id = text(id);
    await this.existing(i, h, id);
    const now = new Date().toISOString();
    await this.batch(
      i,
      h,
      [
        this.stmt(
          'DELETE FROM monthly_plans WHERE household_id=? AND id=?',
          h,
          id,
        ),
        this.written(),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM monthly_plans WHERE household_id=? AND id=?) THEN 1 ELSE 0 END',
          h,
          id,
        ),
        ...this.audit(
          i,
          h,
          id,
          'plan.deleted',
          JSON.stringify({ planId: id }),
          now,
        ),
      ],
      'delete',
      id,
    );
  }
}
@Controller('api/v1/households/:householdId/plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}
  @Get() list(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Query() q: PlanQueryDto,
  ) {
    return this.service.list(identity, h, q);
  }
  @Post() create(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Body() b: CreatePlanDto,
  ) {
    return this.service.create(identity, h, b);
  }
  @Patch(':id') update(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() b: UpdatePlanDto,
  ) {
    return this.service.update(identity, h, id, b);
  }
  @Delete(':id') @HttpCode(204) remove(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(identity, h, id);
  }
}
