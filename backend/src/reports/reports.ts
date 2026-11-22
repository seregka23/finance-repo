import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { apiError } from '../auth/auth.errors.js';
import type { AuthRequest, Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import {
  householdMonthForInstant,
  monthDateRange,
  validateMonth,
} from '../finance/calendar.js';
import { recordedValue } from '../finance/report-valuation.js';
import { HouseholdAccessService } from '../households/household-access.service.js';

const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
interface ReportRow {
  id: string;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  merchant: string | null;
  movementId: string | null;
  currency: string | null;
  amountMinor: string | null;
  rsdEquivalentMinor: string | null;
  exchangeRate: string | null;
}
interface BalanceRow {
  currency: string;
  kind: 'balance' | 'reserve';
  amountMinor: string;
}
interface RecentRow {
  id: string;
  transactionDate: string;
  type: string;
  merchant: string | null;
  categoryName: string | null;
  amountMinor: string | null;
  currency: string | null;
  accountName: string | null;
  toAccountName: string | null;
  creditAmountMinor: string | null;
  creditCurrency: string | null;
}
interface Totals {
  incomeMinor: string;
  expenseMinor: string;
  netMinor: string;
  missingFxCount: number;
  originalCurrencies: {
    currency: string;
    incomeMinor: string;
    expenseMinor: string;
    netMinor: string;
  }[];
}
type Amounts = { income: bigint; expense: bigint };
function totalsObject(t: Amounts) {
  return {
    incomeMinor: t.income.toString(),
    expenseMinor: t.expense.toString(),
    netMinor: (t.income - t.expense).toString(),
  };
}
export function summarizeReport(
  rows: ReportRow[],
  category: string | null = null,
  merchant: string | null = null,
) {
  const all = new Set<string>(),
    matched = new Set<string>();
  const totals: Amounts = { income: 0n, expense: 0n };
  const currencies = new Map<string, Amounts>();
  const categories = new Map<
    string,
    {
      categoryId: string;
      name: string | null;
      expense: bigint;
      missing: number;
    }
  >();
  const merchants = new Map<
    string | null,
    { name: string | null; expense: bigint; missing: number }
  >();
  let missingFxCount = 0;
  for (const r of rows) {
    all.add(r.id);
    if (
      (category && r.categoryId !== category) ||
      (merchant &&
        !(r.merchant ?? '').toLowerCase().includes(merchant.toLowerCase()))
    )
      continue;
    matched.add(r.id);
    if (!r.movementId || !r.currency || r.amountMinor === null) continue;
    const v = recordedValue({
      currency: r.currency,
      amountMinor: r.amountMinor,
      rsdEquivalentMinor: r.rsdEquivalentMinor,
      exchangeRate: r.exchangeRate,
    });
    if (v.missing) missingFxCount++;
    const c = currencies.get(r.currency) ?? { income: 0n, expense: 0n };
    currencies.set(r.currency, c);
    if (r.type === 'income') {
      c.income += v.original;
      if (v.rsd !== null) totals.income += v.rsd;
    } else {
      c.expense -= v.original;
      if (v.rsd !== null) totals.expense -= v.rsd;
      if (r.categoryId) {
        const x = categories.get(r.categoryId) ?? {
          categoryId: r.categoryId,
          name: r.categoryName,
          expense: 0n,
          missing: 0,
        };
        if (v.rsd !== null) x.expense -= v.rsd;
        if (v.missing) x.missing++;
        categories.set(r.categoryId, x);
      }
      const x = merchants.get(r.merchant) ?? {
        name: r.merchant,
        expense: 0n,
        missing: 0,
      };
      if (v.rsd !== null) x.expense -= v.rsd;
      if (v.missing) x.missing++;
      merchants.set(r.merchant, x);
    }
  }
  const result: Totals = {
    ...totalsObject(totals),
    missingFxCount,
    originalCurrencies: Array.from(currencies, ([currency, value]) => ({
      currency,
      ...totalsObject(value),
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
  return {
    monthTransactionCount: all.size,
    matchedTransactionCount: matched.size,
    totals: result,
    byCategory: Array.from(categories.values(), (x) => ({
      categoryId: x.categoryId,
      name: x.name,
      expenseMinor: x.expense.toString(),
      missingFxCount: x.missing,
    })).sort(
      (a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.categoryId.localeCompare(b.categoryId),
    ),
    byMerchant: Array.from(merchants.values(), (x) => ({
      name: x.name,
      expenseMinor: x.expense.toString(),
      missingFxCount: x.missing,
    })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
  };
}
export function summarizeBalances(rows: BalanceRow[]) {
  const values = new Map<string, { balance: bigint; reserve: bigint }>();
  for (const r of rows) {
    const x = values.get(r.currency) ?? { balance: 0n, reserve: 0n };
    if (r.kind === 'balance') x.balance += BigInt(r.amountMinor);
    else x.reserve += BigInt(r.amountMinor);
    values.set(r.currency, x);
  }
  return Array.from(values, ([currency, v]) => ({
    currency,
    balanceMinor: v.balance.toString(),
    reservedMinor: v.reserve.toString(),
    availableMinor: (v.balance - v.reserve).toString(),
  })).sort((a, b) => a.currency.localeCompare(b.currency));
}
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
  ) {}
  private stmt(sql: string, ...v: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...v);
  }
  private report(h: string, m: string) {
    const { startDate, endDate } = monthDateRange(m);
    return this.stmt(
      `SELECT t.id,t.type,t.category_id AS categoryId,c.name AS categoryName,CASE WHEN t.type='refund' THEN COALESCE(NULLIF(t.merchant,''),purchase.merchant) ELSE t.merchant END AS merchant,v.movement_id AS movementId,v.currency,CAST(v.amount_minor AS TEXT) AS amountMinor,CAST(v.rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor,am.exchange_rate AS exchangeRate FROM transactions t LEFT JOIN categories c ON c.household_id=t.household_id AND c.id=t.category_id LEFT JOIN transactions purchase ON purchase.household_id=t.household_id AND purchase.id=t.parent_transaction_id LEFT JOIN transaction_reporting_movements v ON v.household_id=t.household_id AND v.transaction_id=t.id LEFT JOIN account_movements am ON am.household_id=v.household_id AND am.id=v.movement_id WHERE t.household_id=? AND t.status='posted' AND t.transaction_date>=? AND t.transaction_date<=? ORDER BY t.id,v.movement_id`,
      h,
      startDate,
      endDate,
    );
  }
  private balances(h: string, end: string | null) {
    return this.stmt(
      `SELECT a.currency,'balance' AS kind,CAST(m.amount_minor AS TEXT) AS amountMinor FROM accounts a JOIN account_movements m ON m.household_id=a.household_id AND m.account_id=a.id WHERE a.household_id=? AND (? IS NULL OR m.movement_date<=?) UNION ALL SELECT a.currency,'reserve' AS kind,CAST(r.amount_minor AS TEXT) AS amountMinor FROM accounts a JOIN reserve_movements r ON r.household_id=a.household_id AND r.account_id=a.id WHERE a.household_id=? AND (? IS NULL OR r.movement_date<=?) UNION ALL SELECT currency,'balance','0' FROM accounts WHERE household_id=?`,
      h,
      end,
      end,
      h,
      end,
      end,
      h,
    );
  }
  private recent(h: string) {
    return this.stmt(
      `SELECT t.id,t.transaction_date AS transactionDate,t.type,t.merchant,c.name AS categoryName,CAST(COALESCE(d.amount_minor,td.debit_amount_minor,abs(am.amount_minor)) AS TEXT) AS amountMinor,COALESCE(d.currency,td.debit_currency,am.currency) AS currency,COALESCE(a.name,src.name,ma.name) AS accountName,dst.name AS toAccountName,CAST(td.credit_amount_minor AS TEXT) AS creditAmountMinor,td.credit_currency AS creditCurrency FROM transactions t LEFT JOIN categories c ON c.household_id=t.household_id AND c.id=t.category_id LEFT JOIN posting_details d ON d.household_id=t.household_id AND d.transaction_id=t.id LEFT JOIN transfer_details td ON td.household_id=t.household_id AND td.transaction_id=t.id LEFT JOIN accounts a ON a.household_id=t.household_id AND a.id=d.account_id LEFT JOIN accounts src ON src.household_id=t.household_id AND src.id=td.from_account_id LEFT JOIN accounts dst ON dst.household_id=t.household_id AND dst.id=td.to_account_id LEFT JOIN account_movements am ON am.household_id=t.household_id AND am.id=(SELECT id FROM account_movements WHERE household_id=t.household_id AND transaction_id=t.id ORDER BY id LIMIT 1) LEFT JOIN accounts ma ON ma.household_id=t.household_id AND ma.id=am.account_id WHERE t.household_id=? AND t.status='posted' ORDER BY t.transaction_date DESC,t.id DESC LIMIT 15`,
      h,
    );
  }
  async monthly(i: Identity, h: string, query: unknown) {
    if (
      !query ||
      typeof query !== 'object' ||
      Array.isArray(query) ||
      Object.keys(query).some(
        (k) => !['month', 'categoryId', 'merchant'].includes(k),
      )
    )
      throw invalid();
    const q = query as Record<string, unknown>;
    const text = (v: unknown) => {
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 200)
        throw invalid();
      return v.trim();
    };
    let m: string | undefined;
    try {
      if (q.month !== undefined) m = validateMonth(q.month);
    } catch {
      throw invalid();
    }
    const category = q.categoryId === undefined ? null : text(q.categoryId),
      merchant = q.merchant === undefined ? null : text(q.merchant);
    const household = await this.access.get(i, h);
    m ??= householdMonthForInstant(
      new Date().toISOString(),
      household.timeZone,
    );
    const [, records, balances] = await this.access.batch(i, h, 'member', [
      this.report(h, m),
      this.balances(h, monthDateRange(m).endDate),
    ]);
    return {
      month: m,
      ...summarizeReport(
        records.results as unknown as ReportRow[],
        category,
        merchant,
      ),
      balances: summarizeBalances(balances.results as unknown as BalanceRow[]),
    };
  }
  async dashboard(i: Identity, h: string) {
    const household = await this.access.get(i, h),
      month = householdMonthForInstant(
        new Date().toISOString(),
        household.timeZone,
      );
    const [, records, balances, recent] = await this.access.batch(
      i,
      h,
      'member',
      [this.report(h, month), this.balances(h, null), this.recent(h)],
    );
    return {
      month,
      totals: summarizeReport(records.results as unknown as ReportRow[]).totals,
      balances: summarizeBalances(balances.results as unknown as BalanceRow[]),
      recentTransactions: (recent.results as unknown as RecentRow[]).map(
        (r) => ({
          id: r.id,
          transactionDate: r.transactionDate,
          type: r.type,
          merchant: r.merchant,
          categoryName: r.categoryName,
          amountMinor: r.amountMinor,
          currency: r.currency,
          accountName: r.accountName,
          ...(r.type === 'transfer'
            ? {
                toAccountName: r.toAccountName,
                creditAmountMinor: r.creditAmountMinor,
                creditCurrency: r.creditCurrency,
              }
            : {}),
        }),
      ),
    };
  }
}
@Controller('api/v1/households/:householdId')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @Get('reports/monthly') monthly(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Query() q: unknown,
  ) {
    return this.service.monthly(r.identity, h, q);
  }
  @Get('dashboard') dashboard(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
  ) {
    return this.service.dashboard(r.identity, h);
  }
}
