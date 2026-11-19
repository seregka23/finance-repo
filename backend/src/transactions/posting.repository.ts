import { HttpException, Inject, Injectable } from '@nestjs/common';
import { apiError, unavailable, type Identity } from '../auth/auth.js';
import { DATABASE } from '../health.controller.js';
import type { Database } from '../households/households.js';
import { recordConversion } from '../finance/fx.js';
import type {
  PostingInput,
  ReserveFunding,
  TransactionRecord,
  TransferInput,
  TransferRecord,
  AnyTransactionRecord,
  RefundInput,
  RefundRecord,
  TransactionListOptions,
} from './contracts.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Currency } from '../finance/money.js';
import { TransferWrite } from './transfer-write.js';
import { RefundWrite } from './refund-write.js';

const recordSelect = `SELECT t.id, t.household_id AS householdId, t.type,
 t.transaction_date AS transactionDate, d.account_id AS accountId, t.category_id AS categoryId,
 CAST(d.amount_minor AS TEXT) AS amountMinor, d.currency, d.exchange_rate AS exchangeRate,
 d.exchange_rate_source AS exchangeRateSource, t.merchant, t.note, t.author_member_id AS authorMemberId, t.version, t.status,
 CAST(d.rsd_equivalent_minor AS TEXT) AS rsdEquivalentMinor, t.created_at AS createdAt, t.updated_at AS updatedAt
 FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id`;
const recordJson = `json_object('id',t.id,'householdId',t.household_id,'type',t.type,'transactionDate',t.transaction_date,
 'accountId',d.account_id,'categoryId',t.category_id,'amountMinor',CAST(d.amount_minor AS TEXT),'currency',d.currency,
 'exchangeRate',d.exchange_rate,'exchangeRateSource',d.exchange_rate_source,'merchant',t.merchant,'note',t.note,
 'authorMemberId',t.author_member_id,'version',t.version,'status',t.status,'rsdEquivalentMinor',CAST(d.rsd_equivalent_minor AS TEXT),'createdAt',t.created_at,'updatedAt',t.updated_at)`;
function translate(e: unknown): never {
  const s = String(e);
  const errors: [string, number, string, string][] = [
    [
      'household_access_denied',
      404,
      'HOUSEHOLD_NOT_FOUND',
      'Household not found',
    ],
    [
      'posting_key_conflict',
      409,
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was used for a different request',
    ],
    [
      'posting_version_conflict',
      409,
      'VERSION_CONFLICT',
      'Transaction was changed, is unavailable, or cannot be edited',
    ],
    [
      'posting_linked',
      409,
      'TRANSACTION_LINKED',
      'Transaction has related records and cannot be changed',
    ],
    [
      'posting_account_ineligible',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
      'Account is not eligible',
    ],
    [
      'posting_category_ineligible',
      409,
      'CATEGORY_NOT_ELIGIBLE',
      'Category is not eligible',
    ],
    [
      'posting_balance_invalid',
      409,
      'INSUFFICIENT_FUNDS',
      'Account balance would be invalid',
    ],
  ];
  errors.push(
    [
      'reserve_account_ineligible',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
      'Account is not eligible',
    ],
    [
      'reserve_ineligible',
      409,
      'RESERVE_NOT_ELIGIBLE',
      'Reserve is not eligible',
    ],
    [
      'reserve_funding_legacy_or_invalid',
      409,
      'TRANSACTION_LINKED',
      'Transaction has related records and cannot be changed',
    ],
    [
      'reserve_funding_invalid',
      409,
      'RESERVE_NOT_ELIGIBLE',
      'Reserve funding is not eligible',
    ],
    [
      'reserve_balance_invalid',
      409,
      'INSUFFICIENT_FUNDS',
      'Account balance would be invalid',
    ],
  );
  const transferErrors: [string, number, string, string][] = [
    [
      'transfer_member_ineligible',
      404,
      'HOUSEHOLD_NOT_FOUND',
      'Household not found',
    ],
    [
      'transfer_version_conflict',
      409,
      'VERSION_CONFLICT',
      'Transaction was changed, is unavailable, or cannot be edited',
    ],
    [
      'transfer_linked',
      409,
      'TRANSACTION_LINKED',
      'Transaction has related records and cannot be changed',
    ],
    [
      'transfer_account_ineligible',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
      'Account is not eligible',
    ],
    [
      'transfer_fee_invalid',
      409,
      'CATEGORY_NOT_ELIGIBLE',
      'Category is not eligible',
    ],
    [
      'transfer_balance_invalid',
      409,
      'INSUFFICIENT_FUNDS',
      'Account balance would be invalid',
    ],
  ];
  errors.push(...transferErrors);
  errors.push(
    [
      'posting_refunds_conflict',
      409,
      'REFUND_CONFLICT',
      'Purchase has active refunds',
    ],
    [
      'refund_purchase_conflict',
      409,
      'REFUND_CONFLICT',
      'Purchase is unavailable or has changed',
    ],
    [
      'refund_snapshot_conflict',
      409,
      'REFUND_CONFLICT',
      'Refunds have changed',
    ],
    [
      'refund_version_conflict',
      409,
      'VERSION_CONFLICT',
      'Refund has changed or is unavailable',
    ],
    [
      'refund_linked',
      409,
      'TRANSACTION_LINKED',
      'Transaction has related records and cannot be changed',
    ],
    [
      'refund_account_or_amount_invalid',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
      'Account or amount is not eligible',
    ],
    [
      'refund_ceiling_invalid',
      409,
      'REFUND_CONFLICT',
      'Refund exceeds the purchase amount',
    ],
    [
      'refund_balance_invalid',
      409,
      'INSUFFICIENT_FUNDS',
      'Account balance would be invalid',
    ],
    ['refund_', 409, 'REFUND_CONFLICT', 'Refund could not be completed'],
  );
  for (const [needle, status, code, message] of errors)
    if (s.includes(needle)) throw apiError(status, code, message);
  throw unavailable();
}
const includes = {
  postingDetails: true,
  refundDetails: true,
  transferDetails: {
    include: { feeTransaction: { include: { postingDetails: true } } },
  },
} as const;
type ReadRow = Prisma.TransactionGetPayload<{ include: typeof includes }>;
function mapRow(t: ReadRow): AnyTransactionRecord {
  const version = Number(t.version);
  if (!Number.isSafeInteger(version) || version < 1) throw unavailable();
  const common = {
    id: t.id,
    householdId: t.householdId,
    transactionDate: t.transactionDate,
    merchant: t.merchant,
    note: t.note,
    authorMemberId: t.authorMemberId,
    status: t.status as 'posted' | 'void',
    version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  if (t.type === 'transfer' && t.transferDetails) {
    const d = t.transferDetails,
      f = d.feeTransaction,
      p = f?.postingDetails;
    if (f && (!p || !f.categoryId)) throw unavailable();
    return {
      ...common,
      type: 'transfer',
      fromAccountId: d.fromAccountId,
      toAccountId: d.toAccountId,
      debitAmountMinor: d.debitAmountMinor.toString(),
      creditAmountMinor: d.creditAmountMinor.toString(),
      debitCurrency: d.debitCurrency as Currency,
      creditCurrency: d.creditCurrency as Currency,
      fee:
        f && p
          ? {
              id: f.id,
              accountId: p.accountId,
              currency: p.currency as Currency,
              amountMinor: p.amountMinor.toString(),
              categoryId: f.categoryId!,
              exchangeRate: p.exchangeRate,
              exchangeRateSource: p.exchangeRateSource,
              rsdEquivalentMinor: p.rsdEquivalentMinor?.toString() ?? null,
            }
          : null,
    };
  }
  const p = t.postingDetails;
  if (
    !p ||
    !t.categoryId ||
    !['expense', 'income', 'fee', 'refund'].includes(t.type)
  )
    throw unavailable();
  const posting = {
    ...common,
    type: t.type as 'expense' | 'income',
    accountId: p.accountId,
    categoryId: t.categoryId,
    amountMinor: p.amountMinor.toString(),
    currency: p.currency as Currency,
    exchangeRate: p.exchangeRate,
    exchangeRateSource: p.exchangeRateSource,
    rsdEquivalentMinor: p.rsdEquivalentMinor?.toString() ?? null,
  };
  if (t.type === 'refund') {
    if (!t.refundDetails) throw unavailable();
    return {
      ...posting,
      type: 'refund',
      purchaseTransactionId: t.refundDetails.purchaseTransactionId,
    };
  }
  if (t.type === 'fee') {
    if (!t.parentTransactionId) throw unavailable();
    return {
      ...posting,
      type: 'fee',
      parentTransactionId: t.parentTransactionId,
    };
  }
  return posting;
}
@Injectable()
export class PostingRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prisma: PrismaService,
  ) {}
  private stmt(
    sql: string,
    ...values: (string | number | null)[]
  ): D1PreparedStatement {
    return this.db.prepare(sql).bind(...values);
  }
  private access(identity: Identity, householdId: string): D1PreparedStatement {
    return this.stmt(
      'INSERT INTO household_access_checks (household_id,identity_subject,required_role) VALUES (?,?,?)',
      householdId,
      identity.subject,
      'member',
    );
  }
  private member() {
    return `(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active')`;
  }
  private async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    try {
      return await this.db.batch(statements);
    } catch (e) {
      return translate(e);
    }
  }
  private reserveMovement(
    h: string,
    id: string,
    account: string,
    transaction: string,
    type: 'spend' | 'reversal',
    amount: string,
    date: string,
    now: string,
    gate = '1',
  ): D1PreparedStatement[] {
    const movement = crypto.randomUUID();
    return [
      this.stmt(
        `INSERT INTO reserve_checks(household_id,reserve_id,account_id,transaction_id,operation,amount_minor) SELECT ?,?,?,?,?,CAST(? AS INTEGER) WHERE ${gate}`,
        h,
        id,
        account,
        transaction,
        type,
        amount,
      ),
      this.stmt(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,transaction_id,type,movement_date,amount_minor,created_at) SELECT ?,?,?,?,?,?,?,CAST(? AS INTEGER),? WHERE ${gate}`,
        movement,
        h,
        id,
        account,
        transaction,
        type,
        date,
        (type === 'spend' ? -BigInt(amount) : BigInt(amount)).toString(),
        now,
      ),
      this.stmt(
        `INSERT INTO posting_write_checks(changed) SELECT changes() WHERE ${gate}`,
      ),
      this.stmt(
        `INSERT INTO reserve_movement_result_checks(id,household_id,reserve_id,account_id,transaction_id,operation,amount_minor) SELECT ?,?,?,?,?,?,CAST(? AS INTEGER) WHERE ${gate}`,
        movement,
        h,
        id,
        account,
        transaction,
        type,
        amount,
      ),
    ];
  }
  private fundingResult(
    h: string,
    id: string,
    funding: ReserveFunding | null | undefined,
    account: string | null,
    gate = '1',
  ) {
    return this.stmt(
      `INSERT INTO reserve_funding_result_checks(household_id,transaction_id,reserve_id,account_id,amount_minor) SELECT ?,?,?,?,CAST(? AS INTEGER) WHERE ${gate}`,
      h,
      id,
      funding?.reserveId ?? null,
      funding ? account : null,
      funding?.amountMinor ?? '0',
    );
  }
  private async runFunding(
    stmts: D1PreparedStatement[],
    identity: Identity,
    householdId: string,
    funding: ReserveFunding | null | undefined,
    old: (ReserveFunding & { accountId: string }) | null = null,
    id?: string,
    version?: number,
  ): Promise<D1Result[]> {
    try {
      return await this.db.batch(stmts);
    } catch (e) {
      if (
        id &&
        version !== undefined &&
        String(e).includes('posting_result_invalid')
      ) {
        const scoped = await this.prisma.transaction.findFirst({
          where: {
            id,
            householdId,
            version: BigInt(version),
            status: 'posted',
            household: {
              status: 'active',
              members: {
                some: { identitySubject: identity.subject, status: 'active' },
              },
            },
          },
          select: { id: true },
        });
        if (!scoped)
          throw apiError(
            409,
            'VERSION_CONFLICT',
            'Transaction was changed, is unavailable, or cannot be edited',
          );
      }
      if (String(e).includes('reserve_balance_invalid') && funding) {
        // Reauthorize and read after rollback; do not disclose balances after access is revoked.
        const household = await this.prisma.household.findFirst({
          where: {
            id: householdId,
            status: 'active',
            members: {
              some: { identitySubject: identity.subject, status: 'active' },
            },
          },
          select: { id: true },
        });
        if (!household)
          throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
        if (id && version !== undefined) {
          const current = await this.prisma.transaction.findFirst({
            where: {
              id,
              householdId,
              version: BigInt(version),
              status: 'posted',
              household: {
                status: 'active',
                members: {
                  some: { identitySubject: identity.subject, status: 'active' },
                },
              },
            },
            select: { id: true },
          });
          if (!current)
            throw apiError(
              409,
              'VERSION_CONFLICT',
              'Transaction was changed, is unavailable, or cannot be edited',
            );
        }
        const reserve = await this.prisma.reserve.findFirst({
          where: { id: funding.reserveId, householdId },
        });
        if (!reserve)
          throw apiError(
            409,
            'RESERVE_NOT_ELIGIBLE',
            'Reserve is not eligible',
          );
        const sum = await this.prisma.reserveMovement.aggregate({
          where: { householdId, reserveId: funding.reserveId },
          _sum: { amountMinor: true },
        });
        const available =
          (sum._sum.amountMinor ?? 0n) +
          (old?.reserveId === funding.reserveId ? BigInt(old.amountMinor) : 0n);
        throw new HttpException(
          {
            error: {
              code: 'RESERVE_INSUFFICIENT_FUNDS',
              message: 'Reserve balance is insufficient',
              availableReserveMinor: available.toString(),
            },
          },
          409,
        );
      }
      return translate(e);
    }
  }
  async post(
    identity: Identity,
    householdId: string,
    input: PostingInput | TransferInput | RefundInput,
    requestKey: string,
  ): Promise<TransactionRecord | TransferRecord | RefundRecord> {
    if (input.type === 'refund')
      return new RefundWrite(this.db, this.prisma, this.batch.bind(this)).post(
        identity,
        householdId,
        input,
        requestKey,
      );
    if (input.type === 'transfer')
      return new TransferWrite(this.db, this.batch.bind(this)).post(
        identity,
        householdId,
        input,
        requestKey,
      );
    const id = crypto.randomUUID(),
      claim = crypto.randomUUID(),
      now = new Date().toISOString();
    const member = this.member(),
      payload = JSON.stringify(input);
    const payloadHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(payload),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const auditId = crypto.randomUUID();
    const signed =
      (input.type === 'expense' ? -1n : 1n) * BigInt(input.amountMinor);
    const conversion = recordConversion(
      signed,
      input.currency,
      input.exchangeRate,
      input.exchangeRateSource,
    );
    const positiveRsd =
      conversion.rsdEquivalentMinor === null
        ? null
        : (
            BigInt(conversion.rsdEquivalentMinor) * (signed < 0n ? -1n : 1n)
          ).toString();
    const gate = `EXISTS(SELECT 1 FROM posting_requests WHERE id='${claim}')`;
    const stmts = [
      this.access(identity, householdId),
      this.stmt(
        `INSERT OR IGNORE INTO posting_requests(id,household_id,member_id,request_key,payload) VALUES(?,?,${member},?,?)`,
        claim,
        householdId,
        householdId,
        identity.subject,
        requestKey,
        payload,
      ),
      this.stmt(
        `INSERT INTO posting_request_checks(household_id,member_id,request_key,payload) VALUES(?,${member},?,?)`,
        householdId,
        householdId,
        identity.subject,
        requestKey,
        payload,
      ),
      this.stmt(
        `INSERT INTO posting_checks(household_id,transaction_id,account_id,currency,category_id,type,amount_minor,operation) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
        householdId,
        id,
        input.accountId,
        input.currency,
        input.categoryId,
        input.type,
        input.reserveFunding ? '0' : signed.toString(),
        'post',
      ),
      this.stmt(
        `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,merchant,note,author_member_id,status,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,${member},'posted',1,?,? WHERE ${gate}`,
        id,
        householdId,
        input.type,
        input.transactionDate,
        input.categoryId,
        input.merchant,
        input.note,
        householdId,
        identity.subject,
        now,
        now,
      ),
      ...(input.reserveFunding
        ? [
            this.stmt(
              `INSERT INTO reserve_funding_managed(transaction_id,household_id) SELECT ?,? WHERE ${gate}`,
              id,
              householdId,
            ),
            this.stmt(
              `INSERT INTO posting_write_checks(changed) SELECT changes() WHERE ${gate}`,
            ),
            ...this.reserveMovement(
              householdId,
              input.reserveFunding.reserveId,
              input.accountId,
              id,
              'spend',
              input.reserveFunding.amountMinor,
              input.transactionDate,
              now,
              gate,
            ),
          ]
        : []),
      ...(input.reserveFunding
        ? [
            this.stmt(
              `INSERT INTO posting_checks(household_id,transaction_id,account_id,currency,category_id,type,amount_minor,operation) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
              householdId,
              id,
              input.accountId,
              input.currency,
              input.categoryId,
              input.type,
              signed.toString(),
              'post',
            ),
          ]
        : []),
      this.stmt(
        `INSERT INTO posting_details(transaction_id,household_id,account_id,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source) SELECT ?,?,?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,? WHERE ${gate}`,
        id,
        householdId,
        input.accountId,
        input.amountMinor,
        input.currency,
        positiveRsd,
        input.exchangeRate,
        input.exchangeRateSource,
      ),
      this.stmt(
        `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) SELECT ?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,?,? WHERE ${gate}`,
        crypto.randomUUID(),
        householdId,
        input.accountId,
        id,
        input.transactionDate,
        signed.toString(),
        input.currency,
        conversion.rsdEquivalentMinor,
        input.exchangeRate,
        input.exchangeRateSource,
        now,
      ),
      this.stmt(
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) SELECT ?,?,${member},'transaction.posted',?,?,? WHERE ${gate}`,
        auditId,
        householdId,
        householdId,
        identity.subject,
        id,
        payload,
        now,
      ),
      this.stmt(
        `INSERT INTO idempotency_keys(id,household_id,member_id,request_key,payload_hash,transaction_id,created_at) SELECT ?,?,${member},?,?,?,? WHERE ${gate}`,
        crypto.randomUUID(),
        householdId,
        householdId,
        identity.subject,
        requestKey,
        payloadHash,
        id,
        now,
      ),
      this.stmt(
        `UPDATE posting_requests SET response_json=(SELECT ${input.reserveFunding ? `json_set(${recordJson},'$.reserveFunding',json(?))` : recordJson} FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id WHERE t.id=?) WHERE id=?`,
        ...(input.reserveFunding ? [JSON.stringify(input.reserveFunding)] : []),
        id,
        claim,
      ),
      this.stmt(
        `INSERT INTO posting_write_checks(changed) SELECT changes() WHERE ${gate}`,
      ),
      this.stmt(
        `INSERT INTO posting_result_checks(household_id,transaction_id,version,operation,expected_json,signed_amount,signed_rsd,positive_rsd,audit_id,claim_id) SELECT ?,?,1,'post',?,?,?,?,?,? WHERE ${gate}`,
        householdId,
        id,
        payload,
        signed.toString(),
        conversion.rsdEquivalentMinor,
        positiveRsd,
        auditId,
        claim,
      ),
      ...(input.reserveFunding
        ? [
            this.fundingResult(
              householdId,
              id,
              input.reserveFunding,
              input.accountId,
              gate,
            ),
          ]
        : []),
      this.stmt(
        `INSERT INTO posting_replay_checks(household_id,member_id,request_key) VALUES(?,${member},?)`,
        householdId,
        householdId,
        identity.subject,
        requestKey,
      ),
      this.stmt(
        `SELECT response_json AS responseJson FROM posting_requests WHERE household_id=? AND member_id=${member} AND request_key=?`,
        householdId,
        householdId,
        identity.subject,
        requestKey,
      ),
    ];
    const rows = await this.runFunding(
      stmts,
      identity,
      householdId,
      input.reserveFunding,
    );
    const row = rows.at(-1)?.results?.[0] as
      { responseJson: string } | undefined;
    if (!row?.responseJson) throw unavailable();
    return JSON.parse(row.responseJson) as TransactionRecord;
  }
  async edit(
    identity: Identity,
    householdId: string,
    id: string,
    input: PostingInput | TransferInput | RefundInput,
    version: number,
  ): Promise<TransactionRecord | TransferRecord | RefundRecord> {
    if (input.type === 'refund')
      return new RefundWrite(
        this.db,
        this.prisma,
        this.batch.bind(this),
      ).change(identity, householdId, id, version, input);
    if (input.type === 'transfer')
      return new TransferWrite(this.db, this.batch.bind(this)).change(
        identity,
        householdId,
        id,
        version,
        input,
      );
    return this.change(identity, householdId, id, version, input);
  }
  async void(
    identity: Identity,
    householdId: string,
    id: string,
    version: number,
  ): Promise<AnyTransactionRecord> {
    const current = await this.get(identity, householdId, id);
    if (current.type === 'refund')
      return new RefundWrite(
        this.db,
        this.prisma,
        this.batch.bind(this),
      ).change(identity, householdId, id, version, null);
    if (current.type === 'transfer')
      return new TransferWrite(this.db, this.batch.bind(this)).change(
        identity,
        householdId,
        id,
        version,
        null,
      );
    if (current.type === 'fee')
      throw apiError(
        409,
        'TRANSACTION_LINKED',
        'Transaction has related records and cannot be changed',
      );
    return this.change(identity, householdId, id, version, null);
  }
  private async change(
    identity: Identity,
    householdId: string,
    id: string,
    version: number,
    input: PostingInput | null,
  ): Promise<TransactionRecord> {
    const current = await this.get(identity, householdId, id);
    if (current.type !== 'expense' && current.type !== 'income')
      throw apiError(
        409,
        'VERSION_CONFLICT',
        'Transaction was changed, is unavailable, or cannot be edited',
      );
    if (current.type === 'income' && input?.reserveFunding)
      throw apiError(
        409,
        'RESERVE_FUNDING_NOT_ELIGIBLE',
        'Convert the income to an expense before adding reserve funding',
      );
    const markerRows = await this.prisma.$queryRaw<{ transactionId: string }[]>(
      Prisma.sql`SELECT transaction_id AS transactionId FROM reserve_funding_managed WHERE household_id=${householdId} AND transaction_id=${id}`,
    );
    const marker = markerRows[0];
    const grouped = marker
      ? await this.prisma.reserveMovement.groupBy({
          by: ['reserveId', 'accountId'],
          where: { householdId, transactionId: id },
          _sum: { amountMinor: true },
        })
      : [];
    const active = grouped.filter((g) => (g._sum.amountMinor ?? 0n) < 0n);
    if (active.length > 1) throw unavailable();
    const old = active[0]
      ? {
          reserveId: active[0].reserveId,
          accountId: active[0].accountId,
          amountMinor: (-active[0]._sum.amountMinor!).toString(),
        }
      : null;
    const funding = input?.reserveFunding ?? null;
    const managed = Boolean(marker || funding);
    const now = new Date().toISOString(),
      member = this.member();
    const signed = input
      ? (input.type === 'expense' ? -1n : 1n) * BigInt(input.amountMinor)
      : 0n;
    const conversion = input
      ? recordConversion(
          signed,
          input.currency,
          input.exchangeRate,
          input.exchangeRateSource,
        )
      : null;
    const positiveRsd =
      conversion?.rsdEquivalentMinor == null
        ? null
        : (
            BigInt(conversion.rsdEquivalentMinor) * (signed < 0n ? -1n : 1n)
          ).toString();
    const auditId = crypto.randomUUID();
    const stmts = [
      this.access(identity, householdId),
      // Assert the scoped snapshot before any compensation or enrollment.
      this.stmt(
        `INSERT INTO posting_write_checks(changed) SELECT count(*) FROM transactions t JOIN posting_details d ON d.household_id=t.household_id AND d.transaction_id=t.id WHERE t.household_id=? AND t.id=? AND t.status='posted' AND t.version=? AND t.type IN ('expense','income') AND d.account_id=? AND (EXISTS(SELECT 1 FROM reserve_funding_managed f WHERE f.household_id=t.household_id AND f.transaction_id=t.id))=? AND (?=0 OR ((SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements m WHERE m.household_id=t.household_id AND m.transaction_id=t.id)=CAST(? AS INTEGER) AND (SELECT COALESCE(SUM(amount_minor),0) FROM reserve_movements m WHERE m.household_id=t.household_id AND m.transaction_id=t.id AND m.reserve_id IS ? AND m.account_id IS ?)=CAST(? AS INTEGER)))`,
        householdId,
        id,
        version,
        current.accountId,
        marker ? 1 : 0,
        marker ? 1 : 0,
        old ? (-BigInt(old.amountMinor)).toString() : '0',
        old?.reserveId ?? null,
        old?.accountId ?? null,
        old ? (-BigInt(old.amountMinor)).toString() : '0',
      ),
      this.stmt(
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) SELECT ?,?,${member},?,?,json_object('before',json(${old ? `json_set(${recordJson},'$.reserveFunding',json(?))` : recordJson})),? FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id WHERE t.household_id=? AND t.id=?`,
        auditId,
        householdId,
        householdId,
        identity.subject,
        input ? 'transaction.edited' : 'transaction.voided',
        id,
        ...(old
          ? [
              JSON.stringify({
                reserveId: old.reserveId,
                amountMinor: old.amountMinor,
              }),
            ]
          : []),
        now,
        householdId,
        id,
      ),
      ...(!marker && funding
        ? [
            this.stmt(
              'INSERT INTO reserve_funding_managed(transaction_id,household_id) VALUES(?,?)',
              id,
              householdId,
            ),
            this.stmt(
              'INSERT INTO posting_write_checks(changed) VALUES(changes())',
            ),
          ]
        : []),
      ...(old
        ? this.reserveMovement(
            householdId,
            old.reserveId,
            old.accountId,
            id,
            'reversal',
            old.amountMinor,
            current.transactionDate,
            now,
          )
        : []),
      ...(funding && input
        ? this.reserveMovement(
            householdId,
            funding.reserveId,
            input.accountId,
            id,
            'spend',
            funding.amountMinor,
            input.transactionDate,
            now,
          )
        : []),
      this.stmt(
        'INSERT INTO posting_checks(household_id,transaction_id,version,account_id,currency,category_id,type,amount_minor,operation,reserve_adjusted) VALUES(?,?,?,?,?,?,?,?,?,?)',
        householdId,
        id,
        version,
        input?.accountId ?? null,
        input?.currency ?? null,
        input?.categoryId ?? null,
        input?.type ?? null,
        signed.toString(),
        input ? 'edit' : 'void',
        managed ? 1 : null,
      ),
      this.stmt(
        'DELETE FROM account_movements WHERE household_id=? AND transaction_id=?',
        householdId,
        id,
      ),
      this.stmt('INSERT INTO posting_write_checks(changed) VALUES(changes())'),
    ];
    if (input && conversion) {
      stmts.push(
        this.stmt(
          'UPDATE transactions SET type=?,transaction_date=?,category_id=?,merchant=?,note=?,version=version+1,updated_at=? WHERE household_id=? AND id=?',
          input.type,
          input.transactionDate,
          input.categoryId,
          input.merchant,
          input.note,
          now,
          householdId,
          id,
        ),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) VALUES(changes())',
        ),
        this.stmt(
          'UPDATE posting_details SET account_id=?,amount_minor=CAST(? AS INTEGER),currency=?,rsd_equivalent_minor=CAST(? AS INTEGER),exchange_rate=?,exchange_rate_source=? WHERE household_id=? AND transaction_id=?',
          input.accountId,
          input.amountMinor,
          input.currency,
          positiveRsd,
          input.exchangeRate,
          input.exchangeRateSource,
          householdId,
          id,
        ),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) VALUES(changes())',
        ),
        this.stmt(
          `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) VALUES(?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,?,?)`,
          crypto.randomUUID(),
          householdId,
          input.accountId,
          id,
          input.transactionDate,
          signed.toString(),
          input.currency,
          conversion.rsdEquivalentMinor,
          input.exchangeRate,
          input.exchangeRateSource,
          now,
        ),
      );
    } else
      stmts.push(
        this.stmt(
          "UPDATE transactions SET status='void',version=version+1,updated_at=? WHERE household_id=? AND id=?",
          now,
          householdId,
          id,
        ),
        this.stmt(
          'INSERT INTO posting_write_checks(changed) VALUES(changes())',
        ),
      );
    stmts.push(
      this.stmt(
        `UPDATE audit_events SET details_json=json_set(details_json,'$.after',json((SELECT ${funding ? `json_set(${recordJson},'$.reserveFunding',json(?))` : recordJson} FROM transactions t JOIN posting_details d ON d.transaction_id=t.id AND d.household_id=t.household_id WHERE t.household_id=? AND t.id=?))) WHERE id=?`,
        ...(funding ? [JSON.stringify(funding)] : []),
        householdId,
        id,
        auditId,
      ),
      this.stmt('INSERT INTO posting_write_checks(changed) VALUES(changes())'),
      this.stmt(
        `INSERT INTO posting_result_checks(household_id,transaction_id,version,operation,expected_json,signed_amount,signed_rsd,positive_rsd,audit_id) VALUES(?,?,?,?,?,?,?,?,?)`,
        householdId,
        id,
        version + 1,
        input ? 'edit' : 'void',
        input ? JSON.stringify(input) : null,
        signed.toString(),
        conversion?.rsdEquivalentMinor ?? null,
        positiveRsd,
        auditId,
      ),
      ...(managed
        ? [
            this.fundingResult(
              householdId,
              id,
              funding,
              input?.accountId ?? null,
            ),
          ]
        : []),
      this.stmt(
        `${recordSelect} WHERE t.household_id=? AND t.id=?`,
        householdId,
        id,
      ),
    );
    const result = await this.runFunding(
      stmts,
      identity,
      householdId,
      funding,
      old,
      id,
      version,
    );
    const row = result.at(-1)?.results?.[0] as unknown as TransactionRecord;
    return funding ? { ...row, reserveFunding: funding } : row;
  }
  private async withFunding(
    identity: Identity,
    householdId: string,
    records: AnyTransactionRecord[],
  ): Promise<AnyTransactionRecord[]> {
    const expenses = records.filter(
      (r) => r.type === 'expense' && r.status === 'posted',
    );
    if (!expenses.length) return records;
    const groups: {
      transactionId: string;
      reserveId: string;
      amountMinor: string;
    }[] = [];
    for (let offset = 0; offset < expenses.length; offset += 32) {
      const ids = expenses.slice(offset, offset + 32).map((r) => r.id);
      groups.push(
        ...(await this.prisma.$queryRaw<
          { transactionId: string; reserveId: string; amountMinor: string }[]
        >(
          Prisma.sql`SELECT m.transaction_id AS transactionId,m.reserve_id AS reserveId,CAST(-SUM(m.amount_minor) AS TEXT) AS amountMinor FROM reserve_movements m JOIN reserve_funding_managed f ON f.household_id=m.household_id AND f.transaction_id=m.transaction_id WHERE m.household_id=${householdId} AND EXISTS(SELECT 1 FROM households h JOIN household_members hm ON hm.household_id=h.id WHERE h.id=m.household_id AND h.status='active' AND hm.identity_subject=${identity.subject} AND hm.status='active') AND m.transaction_id IN (${Prisma.join(ids)}) GROUP BY m.transaction_id,m.reserve_id,m.account_id HAVING SUM(m.amount_minor)<0`,
        )),
      );
    }
    return records.map((r) => {
      const g = groups.find((x) => x.transactionId === r.id);
      return g && r.type === 'expense' && r.status === 'posted'
        ? {
            ...r,
            reserveFunding: {
              reserveId: g.reserveId,
              amountMinor: g.amountMinor,
            },
          }
        : r;
    });
  }
  private scope(identity: Identity, householdId: string) {
    return {
      householdId,
      household: {
        status: 'active',
        members: {
          some: { identitySubject: identity.subject, status: 'active' },
        },
      },
    };
  }
  async get(
    identity: Identity,
    householdId: string,
    id: string,
  ): Promise<AnyTransactionRecord> {
    try {
      const row = await this.prisma.transaction.findFirst({
        where: { ...this.scope(identity, householdId), id },
        include: includes,
      });
      if (!row)
        throw apiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
      return (await this.withFunding(identity, householdId, [mapRow(row)]))[0];
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      throw unavailable();
    }
  }
  async list(
    identity: Identity,
    householdId: string,
    options: TransactionListOptions,
  ): Promise<{
    transactions: AnyTransactionRecord[];
    nextCursor: string | null;
  }> {
    try {
      const access = await this.prisma.household.findFirst({
        where: {
          id: householdId,
          status: 'active',
          members: {
            some: { identitySubject: identity.subject, status: 'active' },
          },
        },
        select: { id: true },
      });
      if (!access)
        throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
      const c = options.cursor;
      const account: Prisma.AccountWhereInput = {
        ...(options.accountId ? { id: options.accountId } : {}),
        ...(options.ownerMemberId
          ? {
              ownerMemberId:
                options.ownerMemberId === 'household'
                  ? null
                  : options.ownerMemberId,
            }
          : {}),
        ...(options.currency ? { currency: options.currency } : {}),
      };
      const accountFilter =
        options.accountId || options.ownerMemberId || options.currency;
      const conditions: Prisma.TransactionWhereInput[] = [
        this.scope(identity, householdId),
      ];
      if (c)
        conditions.push({
          OR: [
            { transactionDate: { lt: c.transactionDate } },
            { transactionDate: c.transactionDate, id: { lt: c.id } },
          ],
        });
      if (options.dateFrom || options.dateTo)
        conditions.push({
          transactionDate: {
            ...(options.dateFrom ? { gte: options.dateFrom } : {}),
            ...(options.dateTo ? { lte: options.dateTo } : {}),
          },
        });
      if (options.type) conditions.push({ type: options.type });
      if (options.status) conditions.push({ status: options.status });
      if (options.categoryId)
        conditions.push({ categoryId: options.categoryId });
      if (accountFilter)
        conditions.push({
          OR: [
            { postingDetails: { account } },
            { transferDetails: { fromAccount: account } },
            { transferDetails: { toAccount: account } },
          ],
        });
      // Prisma's SQLite contains maps to LIKE without a literal escape. Use a
      // parameterized, bounded ID query for literal substring search, then
      // hydrate through the normal ORM path. All filters precede pagination.
      const readPage = (where: Prisma.TransactionWhereInput) =>
        this.prisma.transaction.findMany({
          where,
          include: includes,
          orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
          take: options.limit + 1,
        });
      let rows: ReadRow[];
      if (options.search) {
        const parts: Prisma.Sql[] = [
          Prisma.sql`t.household_id = ${householdId}`,
          Prisma.sql`EXISTS (SELECT 1 FROM households h JOIN household_members m ON m.household_id=h.id WHERE h.id=t.household_id AND h.status='active' AND m.identity_subject=${identity.subject} AND m.status='active')`,
          Prisma.sql`(instr(lower(t.merchant), lower(${options.search})) > 0 OR instr(lower(t.note), lower(${options.search})) > 0)`,
        ];
        if (c)
          parts.push(
            Prisma.sql`(t.transaction_date < ${c.transactionDate} OR (t.transaction_date = ${c.transactionDate} AND t.id < ${c.id}))`,
          );
        if (options.dateFrom)
          parts.push(Prisma.sql`t.transaction_date >= ${options.dateFrom}`);
        if (options.dateTo)
          parts.push(Prisma.sql`t.transaction_date <= ${options.dateTo}`);
        if (options.type) parts.push(Prisma.sql`t.type = ${options.type}`);
        if (options.status)
          parts.push(Prisma.sql`t.status = ${options.status}`);
        if (options.categoryId)
          parts.push(Prisma.sql`t.category_id = ${options.categoryId}`);
        if (accountFilter) {
          const accountParts: Prisma.Sql[] = [];
          if (options.accountId)
            accountParts.push(Prisma.sql`a.id = ${options.accountId}`);
          if (options.ownerMemberId === 'household')
            accountParts.push(Prisma.sql`a.owner_member_id IS NULL`);
          else if (options.ownerMemberId)
            accountParts.push(
              Prisma.sql`a.owner_member_id = ${options.ownerMemberId}`,
            );
          if (options.currency)
            accountParts.push(Prisma.sql`a.currency = ${options.currency}`);
          parts.push(
            Prisma.sql`EXISTS (SELECT 1 FROM accounts a WHERE a.household_id=t.household_id AND ${Prisma.join(accountParts, ' AND ')} AND (EXISTS (SELECT 1 FROM posting_details p WHERE p.household_id=t.household_id AND p.transaction_id=t.id AND p.account_id=a.id) OR EXISTS (SELECT 1 FROM transfer_details d WHERE d.household_id=t.household_id AND d.transaction_id=t.id AND (d.from_account_id=a.id OR d.to_account_id=a.id))))`,
          );
        }
        const ids = await this.prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT t.id FROM transactions t WHERE ${Prisma.join(parts, ' AND ')} ORDER BY t.transaction_date DESC, t.id DESC LIMIT ${options.limit + 1}`,
        );
        const hydrated = new Map<string, ReadRow>();
        // Leave room for scope/filter bindings and compound relation keys in D1.
        for (let offset = 0; offset < ids.length; offset += 32) {
          const batch = ids.slice(offset, offset + 32).map((row) => row.id);
          for (const row of await readPage({
            AND: [...conditions, { id: { in: batch } }],
          })) {
            hydrated.set(row.id, row);
          }
        }
        rows = ids.flatMap(({ id }) => {
          const row = hydrated.get(id);
          return row ? [row] : [];
        });
      } else {
        rows = await readPage({ AND: conditions });
      }
      const transactions = await this.withFunding(
          identity,
          householdId,
          rows.slice(0, options.limit).map(mapRow),
        ),
        last = transactions.at(-1);
      const nextCursor =
        rows.length > options.limit && last
          ? btoa(
              JSON.stringify({
                transactionDate: last.transactionDate,
                id: last.id,
              }),
            )
              .replaceAll('+', '-')
              .replaceAll('/', '_')
              .replace(/=+$/, '')
          : null;
      return { transactions, nextCursor };
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      throw unavailable();
    }
  }
}
