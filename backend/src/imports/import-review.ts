import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { apiError, unavailable } from '../auth/auth.errors.js';
import type { AuthRequest, Identity } from '../auth/auth.types.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { parseMinor } from '../finance/money.js';
import { HouseholdAccessService } from '../households/household-access.service.js';
import {
  normalizePostingBody,
  TransactionsService,
} from '../transactions/transactions.service.js';
import type { PostingHook } from '../transactions/contracts.js';
import { ExtractionService, parseInput } from './extraction.js';
const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const conflict = () =>
  apiError(
    409,
    'IMPORT_CONFLICT',
    'Import cannot be confirmed or was already confirmed differently',
  );
const notFound = () => apiError(404, 'IMPORT_NOT_FOUND', 'Import not found');
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
function amount(v: unknown): string | null {
  if (v === null) return null;
  try {
    const n = parseMinor(v);
    if (n < 0n) throw invalid();
    return n.toString();
  } catch {
    throw invalid();
  }
}
function items(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  return value.map((v: unknown) => {
    const x = fields(v, ['name', 'quantity', 'unitPriceMinor', 'amountMinor']);
    if (
      !('name' in x) ||
      !('quantity' in x) ||
      !('unitPriceMinor' in x) ||
      !('amountMinor' in x)
    )
      throw invalid();
    let quantity: string | null = null;
    if (x.quantity !== null) {
      if (
        typeof x.quantity !== 'string' ||
        x.quantity.length > 24 ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(x.quantity)
      )
        throw invalid();
      quantity = x.quantity;
    }
    return {
      name: text(x.name),
      quantity,
      unitPriceMinor: amount(x.unitPriceMinor),
      amountMinor: amount(x.amountMinor),
    };
  });
}
async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
const encoder = new TextEncoder();
type Stored = {
  sourceLabel: 'sms' | 'screenshot' | 'receipt';
  draft: ReturnType<typeof import('./extraction.js').validateDraft>['draft'];
  categoryDecision: {
    categoryId: string | null;
    provider: string | null;
    probability: number | null;
  };
  reviewFlags: string[];
};
type Row = {
  id: string;
  status: string;
  sourceType: string;
  createdAt: string;
  extractedFieldsJson: string;
  transactionId: string | null;
  confirmationHash: string | null;
  eligibleCategoryId: string | null;
};
@Injectable()
export class ImportReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prisma: PrismaService,
    private readonly access: HouseholdAccessService,
    private readonly extraction: ExtractionService,
    private readonly transactions: TransactionsService,
  ) {}
  private stmt(sql: string, ...v: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...v);
  }
  private async rows(
    identity: Identity,
    h: string,
    id?: string,
    sourceType?: string,
    hash?: string,
  ): Promise<Row[]> {
    const list = await this.prisma.$queryRaw<Row[]>(
      Prisma.sql`SELECT d.id,d.status,d.source_type AS sourceType,d.created_at AS createdAt,d.extracted_fields_json AS extractedFieldsJson,d.transaction_id AS transactionId,d.confirmation_hash AS confirmationHash,c.id AS eligibleCategoryId FROM import_drafts d LEFT JOIN categories c ON c.household_id=d.household_id AND c.id=d.suggested_category_id AND c.status='active' AND c.type=json_extract(d.extracted_fields_json,'$.draft.type') WHERE d.household_id=${h} AND (${id ?? null} IS NULL OR d.id=${id ?? null}) AND (${sourceType ?? null} IS NULL OR (d.source_type=${sourceType ?? null} AND d.source_hash=${hash ?? null})) AND EXISTS(SELECT 1 FROM households h JOIN household_members m ON m.household_id=h.id WHERE h.id=d.household_id AND h.status='active' AND m.identity_subject=${identity.subject} AND m.status='active') ORDER BY d.created_at DESC,d.id DESC LIMIT 50`,
    );
    await this.access.get(identity, h);
    return list;
  }
  private parsed(row: Row): Stored {
    try {
      const value = JSON.parse(row.extractedFieldsJson) as Stored;
      if (
        !value ||
        !value.draft ||
        !['sms', 'screenshot', 'receipt'].includes(value.sourceLabel) ||
        !value.categoryDecision
      )
        throw new Error();
      return value;
    } catch {
      throw apiError(
        409,
        'IMPORT_LEGACY_UNAVAILABLE',
        'This import cannot be reviewed',
      );
    }
  }
  private async suggestion(identity: Identity, h: string, s: Stored) {
    const d = s.draft;
    const currency = d.debitCurrency ?? d.currency;
    if (
      !d.sourceAccount ||
      d.sourceAccount.includes('[redacted]') ||
      !d.cardLastFour ||
      !currency
    )
      return null;
    const rows = await this.prisma.$queryRaw<
      { id: string; bankName: string }[]
    >(
      Prisma.sql`SELECT a.id,a.bank_name AS bankName FROM accounts a WHERE a.household_id=${h} AND a.status='active' AND a.currency=${currency} AND a.card_last_four=${d.cardLastFour} AND a.bank_name IS NOT NULL AND EXISTS(SELECT 1 FROM households hh JOIN household_members m ON m.household_id=hh.id WHERE hh.id=a.household_id AND hh.status='active' AND m.identity_subject=${identity.subject} AND m.status='active')`,
    );
    const normalize = (x: string) => x.normalize('NFKC').trim().toLowerCase();
    const matches = rows.filter(
      (r) => normalize(r.bankName) === normalize(d.sourceAccount!),
    );
    return matches.length === 1 ? matches[0].id : null;
  }
  private async present(identity: Identity, h: string, row: Row) {
    const s = this.parsed(row);
    const suggestion = await this.suggestion(identity, h, s);
    const d = s.draft;
    let possibleDuplicates: {
      id: string;
      transactionDate: string;
      amountMinor: string;
      currency: string;
      merchant: string | null;
    }[] = [];
    const amountValue = d.debitAmountMinor ?? d.amountMinor,
      currency = d.debitCurrency ?? d.currency;
    if (
      d.date &&
      amountValue &&
      currency &&
      (d.type === 'expense' || d.type === 'income')
    )
      possibleDuplicates = await this.prisma.$queryRaw(
        Prisma.sql`SELECT t.id,t.transaction_date AS transactionDate,CAST(p.amount_minor AS TEXT) AS amountMinor,p.currency,t.merchant FROM transactions t JOIN posting_details p ON p.household_id=t.household_id AND p.transaction_id=t.id WHERE t.household_id=${h} AND t.status='posted' AND t.type=${d.type} AND p.amount_minor=CAST(${amountValue} AS INTEGER) AND p.currency=${currency} AND abs(julianday(t.transaction_date)-julianday(${d.date}))<=3 AND (${suggestion} IS NULL OR p.account_id=${suggestion}) AND EXISTS(SELECT 1 FROM households hh JOIN household_members m ON m.household_id=hh.id WHERE hh.id=t.household_id AND hh.status='active' AND m.identity_subject=${identity.subject} AND m.status='active') ORDER BY t.transaction_date DESC,t.id DESC LIMIT 20`,
      );
    await this.access.get(identity, h);
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      sourceType: s.sourceLabel,
      draft: d,
      categoryDecision: {
        ...s.categoryDecision,
        categoryId: row.eligibleCategoryId,
      },
      reviewFlags: s.reviewFlags,
      suggestedAccountId: suggestion,
      possibleDuplicates,
      transactionId: row.transactionId,
    };
  }
  async list(i: Identity, h: string) {
    const rows = await this.rows(i, h);
    return {
      drafts: rows.map((row) => {
        let sourceType = row.sourceType;
        try {
          const parsed = JSON.parse(row.extractedFieldsJson) as {
            sourceLabel?: unknown;
          };
          if (
            typeof parsed.sourceLabel === 'string' &&
            ['sms', 'screenshot', 'receipt'].includes(parsed.sourceLabel)
          )
            sourceType = parsed.sourceLabel;
        } catch {
          /* Legacy rows remain visible without exposing their contents. */
        }
        return {
          id: row.id,
          status: row.status,
          sourceType,
          transactionId: row.transactionId,
          createdAt: row.createdAt,
        };
      }),
    };
  }
  async get(i: Identity, h: string, id: string) {
    const row = (await this.rows(i, h, text(id)))[0];
    if (!row) throw notFound();
    return this.present(i, h, row);
  }
  async preview(i: Identity, h: string, raw: unknown) {
    const source = fields(raw, ['sourceType', 'text', 'mimeType', 'base64']);
    const label = source.sourceType;
    if (label !== 'sms' && label !== 'screenshot' && label !== 'receipt')
      throw invalid();
    const normalized =
      label === 'sms'
        ? parseInput(raw)
        : parseInput({ ...source, sourceType: 'image' });
    const sourceBytes =
      normalized.sourceType === 'sms'
        ? encoder.encode(normalized.text)
        : Uint8Array.from(atob(normalized.base64), (c) => c.charCodeAt(0));
    const prefix = encoder.encode(normalized.sourceType + '\0');
    const bytes = new Uint8Array(prefix.length + sourceBytes.length);
    bytes.set(prefix);
    bytes.set(sourceBytes, prefix.length);
    const hash = await digest(bytes);
    const type = normalized.sourceType;
    const found = (await this.rows(i, h, undefined, type, hash))[0];
    if (found) return this.present(i, h, found);
    const extracted = await this.extraction.extract(i, h, normalized);
    const stored: Stored = {
      sourceLabel: label,
      draft: extracted.draft,
      categoryDecision: extracted.categoryDecision,
      reviewFlags: extracted.reviewFlags,
    };
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.access.batch(i, h, 'member', [
      this.stmt(
        `INSERT OR IGNORE INTO import_drafts(id,household_id,author_member_id,source_type,source_hash,extracted_fields_json,status,suggested_category_id,decision_provider,created_at,updated_at) VALUES(?,?,(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active'),?,?,?,'pending',(SELECT id FROM categories WHERE household_id=? AND id=? AND type=? AND status='active'),?,?,?)`,
        id,
        h,
        h,
        i.subject,
        type,
        hash,
        JSON.stringify(stored),
        h,
        stored.categoryDecision.categoryId,
        stored.draft.type,
        stored.categoryDecision.provider,
        now,
        now,
      ),
    ]);
    const row = (await this.rows(i, h, undefined, type, hash))[0];
    if (!row) throw unavailable();
    return this.present(i, h, row);
  }
  private hook(
    h: string,
    id: string,
    hash: string,
    lines: ReturnType<typeof items>,
    targetType: 'post' | 'attach',
  ): PostingHook {
    return (transactionId, gate) => {
      const now = new Date().toISOString();
      const statements: D1PreparedStatement[] = [];
      if (targetType === 'attach')
        statements.push(
          this.stmt(
            `INSERT INTO posting_write_checks(changed) SELECT count(*) FROM transactions WHERE household_id=? AND id=? AND status='posted' AND type='expense'`,
            h,
            transactionId,
          ),
        );
      statements.push(
        this.stmt(
          `UPDATE import_drafts SET status='confirmed',transaction_id=?,confirmation_hash=?,updated_at=? WHERE household_id=? AND id=? AND status='pending' AND ${gate}`,
          transactionId,
          hash,
          now,
          h,
          id,
        ),
        this.stmt(
          `INSERT INTO posting_write_checks(changed) SELECT changes() WHERE ${gate}`,
        ),
      );
      if (lines.length) {
        const json = JSON.stringify(
          lines.map((x) => ({ ...x, id: crypto.randomUUID() })),
        );
        statements.push(
          this.stmt(
            `INSERT INTO receipt_items(id,household_id,import_draft_id,transaction_id,name,quantity,unit_price_minor,line_total_minor,created_at) SELECT json_extract(value,'$.id'),?,?,?,json_extract(value,'$.name'),json_extract(value,'$.quantity'),CAST(json_extract(value,'$.unitPriceMinor') AS INTEGER),CAST(json_extract(value,'$.amountMinor') AS INTEGER),? FROM json_each(?) WHERE ${gate}`,
            h,
            id,
            transactionId,
            now,
            json,
          ),
          this.stmt(
            `INSERT INTO refund_count_checks(changed,expected) SELECT changes(),? WHERE ${gate}`,
            lines.length,
          ),
        );
      }
      return statements;
    };
  }
  async confirm(i: Identity, h: string, id: string, body: unknown) {
    id = text(id);
    const b = fields(body, [
      'mode',
      'transaction',
      'transactionId',
      'items',
      'settlementConfirmed',
    ]);
    if (b.mode !== 'post' && b.mode !== 'attach') throw invalid();
    const lines = items(b.items);
    let normalized: ReturnType<typeof normalizePostingBody> | null = null,
      target: string | null = null,
      settlement = false;
    if (b.mode === 'post') {
      if (
        'transactionId' in b ||
        typeof b.settlementConfirmed !== 'boolean' ||
        !('transaction' in b)
      )
        throw invalid();
      settlement = b.settlementConfirmed;
      normalized = normalizePostingBody(b.transaction);
    } else {
      if ('transaction' in b || 'settlementConfirmed' in b) throw invalid();
      target = text(b.transactionId);
    }
    const hash = await digest(
      encoder.encode(
        JSON.stringify(
          b.mode === 'post'
            ? {
                mode: 'post',
                transaction: normalized,
                items: lines,
                settlementConfirmed: settlement,
              }
            : { mode: 'attach', transactionId: target, items: lines },
        ),
      ),
    );
    const current = (await this.rows(i, h, id))[0];
    if (!current) throw notFound();
    if (current.status === 'confirmed') {
      if (current.confirmationHash === hash && current.transactionId)
        return { transactionId: current.transactionId };
      throw conflict();
    }
    if (current.status !== 'pending') throw conflict();
    const stored = this.parsed(current);
    if (
      stored.draft.status === 'declined' ||
      (b.mode === 'post' && stored.draft.status !== 'posted' && !settlement) ||
      (normalized &&
        ['transfer', 'refund'].includes(stored.draft.type ?? '') &&
        normalized.type !== stored.draft.type) ||
      (b.mode === 'attach' &&
        (stored.sourceLabel !== 'receipt' ||
          (stored.draft.type !== null && stored.draft.type !== 'expense')))
    )
      throw conflict();
    try {
      if (b.mode === 'post' && normalized) {
        const result = await this.transactions.postImport(
          i,
          h,
          normalized,
          this.hook(h, id, hash, lines, 'post'),
        );
        return { transactionId: result.id };
      }
      await this.access.batch(
        i,
        h,
        'member',
        this.hook(h, id, hash, lines, 'attach')(target!, '1'),
      );
      return { transactionId: target };
    } catch (e) {
      const updated = (await this.rows(i, h, id))[0];
      if (
        updated?.status === 'confirmed' &&
        updated.confirmationHash === hash &&
        updated.transactionId
      )
        return { transactionId: updated.transactionId };
      if (updated?.status === 'confirmed') throw conflict();
      if (b.mode === 'attach') {
        const targetRows = await this.prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT t.id FROM transactions t WHERE t.household_id=${h} AND t.id=${target} AND t.status='posted' AND t.type='expense' AND EXISTS(SELECT 1 FROM households hh JOIN household_members m ON m.household_id=hh.id WHERE hh.id=t.household_id AND hh.status='active' AND m.identity_subject=${i.subject} AND m.status='active')`,
        );
        await this.access.get(i, h);
        if (!targetRows.length) throw conflict();
      }
      throw e;
    }
  }
}
@Controller('api/v1/households/:householdId/imports')
export class ImportReviewController {
  constructor(private readonly service: ImportReviewService) {}
  @Post('preview') @HttpCode(200) preview(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Body() b: unknown,
  ) {
    return this.service.preview(r.identity, h, b);
  }
  @Get() list(@Req() r: AuthRequest, @Param('householdId') h: string) {
    return this.service.list(r.identity, h);
  }
  @Get(':id') get(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(r.identity, h, id);
  }
  @Post(':id/confirm') @HttpCode(200) confirm(
    @Req() r: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.confirm(r.identity, h, id, b);
  }
}
