import { apiError, unavailable, type Identity } from '../auth/auth.js';
import { cumulativeRefundRsd } from '../finance/fx.js';
import type { Currency } from '../finance/money.js';
import type { Database } from '../households/households.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { RefundInput, RefundRecord } from './contracts.js';

const memberSql = `(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active')`;
const conflict = (
  message = 'Refund or purchase is unavailable or has changed',
) => apiError(409, 'REFUND_CONFLICT', message);
type Bind = string | number | null;
const safeVersion = (n: bigint) => {
  const v = Number(n);
  if (!Number.isSafeInteger(v) || v < 1 || v >= Number.MAX_SAFE_INTEGER)
    throw conflict();
  return v;
};

/** Financial writes use D1 batch because the Prisma D1 adapter has no transaction support. */
export class RefundWrite {
  constructor(
    private readonly db: Database,
    private readonly prisma: PrismaService,
    private readonly run: (s: D1PreparedStatement[]) => Promise<D1Result[]>,
  ) {}
  private stmt(sql: string, ...args: Bind[]) {
    return this.db.prepare(sql).bind(...args);
  }
  private check(gate = '1') {
    return this.stmt(
      `INSERT INTO posting_write_checks(changed) SELECT changes() WHERE ${gate}`,
    );
  }
  private access(identity: Identity, h: string) {
    return this.stmt(
      'INSERT INTO household_access_checks(household_id,identity_subject,required_role) VALUES(?,?,?)',
      h,
      identity.subject,
      'member',
    );
  }
  private scope(identity: Identity, h: string) {
    return {
      householdId: h,
      household: {
        status: 'active',
        members: {
          some: { identitySubject: identity.subject, status: 'active' },
        },
      },
    };
  }
  async post(
    identity: Identity,
    h: string,
    input: RefundInput,
    key: string,
  ): Promise<RefundRecord> {
    // Check the immutable claim before consulting mutable purchase/account state.
    const m = await this.prisma.householdMember.findFirst({
      where: {
        householdId: h,
        identitySubject: identity.subject,
        status: 'active',
        household: { status: 'active' },
      },
      select: { id: true },
    });
    if (!m) throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
    const payload = JSON.stringify(input);
    const previous = await this.prisma.postingRequest.findFirst({
      where: { householdId: h, memberId: m.id, requestKey: key },
    });
    if (previous) {
      const results = await this.run([
        this.access(identity, h),
        this.stmt(
          `INSERT INTO posting_request_checks(household_id,member_id,request_key,payload) VALUES(?,${memberSql},?,?)`,
          h,
          h,
          identity.subject,
          key,
          payload,
        ),
        this.stmt(
          `INSERT INTO posting_replay_checks(household_id,member_id,request_key) VALUES(?,${memberSql},?)`,
          h,
          h,
          identity.subject,
          key,
        ),
        this.stmt(
          `SELECT response_json AS responseJson FROM posting_requests WHERE household_id=? AND member_id=${memberSql} AND request_key=?`,
          h,
          h,
          identity.subject,
          key,
        ),
      ]);
      const row = results.at(-1)?.results?.[0] as
        { responseJson?: string } | undefined;
      if (!row?.responseJson) throw unavailable();
      return JSON.parse(row.responseJson) as RefundRecord;
    }
    try {
      return await this.write(
        identity,
        h,
        crypto.randomUUID(),
        null,
        input,
        key,
        m.id,
      );
    } catch (error) {
      const claimed = await this.prisma.postingRequest.findFirst({
        where: { householdId: h, memberId: m.id, requestKey: key },
      });
      if (claimed) return this.post(identity, h, input, key);
      throw error;
    }
  }
  async change(
    identity: Identity,
    h: string,
    id: string,
    version: number,
    input: RefundInput | null,
  ): Promise<RefundRecord> {
    const m = await this.prisma.householdMember.findFirst({
      where: {
        householdId: h,
        identitySubject: identity.subject,
        status: 'active',
        household: { status: 'active' },
      },
      select: { id: true },
    });
    if (!m) throw apiError(404, 'HOUSEHOLD_NOT_FOUND', 'Household not found');
    return this.write(identity, h, id, version, input, null, m.id);
  }
  private async write(
    identity: Identity,
    h: string,
    id: string,
    version: number | null,
    input: RefundInput | null,
    key: string | null,
    actor: string,
  ): Promise<RefundRecord> {
    const operation = key !== null ? 'post' : input ? 'edit' : 'void';
    let purchaseId = input?.purchaseTransactionId;
    if (operation !== 'post') {
      const target = await this.prisma.transaction.findFirst({
        where: { ...this.scope(identity, h), id, type: 'refund' },
        include: { refundDetails: true },
      });
      if (
        !target?.refundDetails ||
        !target.parentTransactionId ||
        (purchaseId &&
          purchaseId !== target.refundDetails.purchaseTransactionId)
      )
        throw conflict();
      purchaseId = target.refundDetails.purchaseTransactionId;
    }
    if (!purchaseId) throw conflict();
    const purchase = await this.prisma.transaction.findFirst({
      where: {
        ...this.scope(identity, h),
        id: purchaseId,
        type: 'expense',
        status: 'posted',
      },
      include: { postingDetails: true },
    });
    if (!purchase?.postingDetails || !purchase.categoryId) throw conflict();
    const pd = purchase.postingDetails,
      pv = safeVersion(purchase.version);
    const rows = await this.prisma.transaction.findMany({
      where: {
        ...this.scope(identity, h),
        parentTransactionId: purchaseId,
        type: 'refund',
      },
      include: { postingDetails: true, refundDetails: true },
    });
    const records = rows
      .map((r) => {
        if (
          !r.postingDetails ||
          !r.refundDetails ||
          r.refundDetails.purchaseTransactionId !== purchaseId
        )
          throw conflict();
        const d = r.postingDetails;
        return {
          id: r.id,
          status: r.status,
          version: safeVersion(r.version),
          sequence: r.refundDetails.allocationSequence.toString(),
          amountMinor: d.amountMinor.toString(),
          rsdEquivalentMinor: d.rsdEquivalentMinor?.toString() ?? null,
          transactionDate: r.transactionDate,
          accountId: d.accountId,
          merchant: r.merchant,
          note: r.note,
        };
      })
      .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
    const old = records.find((r) => r.id === id);
    if (
      operation !== 'post' &&
      (!old || old.status !== 'posted' || old.version !== version)
    )
      throw conflict();
    const beforePurchase = {
      version: pv,
      categoryId: purchase.categoryId,
      amountMinor: pd.amountMinor.toString(),
      currency: pd.currency,
      exchangeRate: pd.exchangeRate,
      exchangeRateSource: pd.exchangeRateSource,
      rsdEquivalentMinor: pd.rsdEquivalentMinor?.toString() ?? null,
    };
    const before = {
      purchase: beforePurchase,
      refunds: records.map((r) => ({
        id: r.id,
        status: r.status,
        version: r.version,
        sequence: r.sequence,
        amountMinor: r.amountMinor,
        rsdEquivalentMinor: r.rsdEquivalentMinor,
      })),
    };
    const after = records.map((r) => ({ ...r }));
    if (operation === 'post' && input) {
      const seq =
        records.reduce(
          (max, r) => (BigInt(r.sequence) > max ? BigInt(r.sequence) : max),
          0n,
        ) + 1n;
      if (seq > BigInt(Number.MAX_SAFE_INTEGER))
        throw conflict('Refund sequence exhausted');
      after.push({
        id,
        status: 'posted',
        version: 1,
        sequence: seq.toString(),
        amountMinor: input.amountMinor,
        rsdEquivalentMinor: '0',
        transactionDate: input.transactionDate,
        accountId: input.accountId,
        merchant: input.merchant,
        note: input.note,
      });
    } else if (old) {
      const target = after.find((r) => r.id === id)!;
      target.version++;
      if (input)
        Object.assign(target, {
          amountMinor: input.amountMinor,
          transactionDate: input.transactionDate,
          accountId: input.accountId,
          merchant: input.merchant,
          note: input.note,
        });
      else target.status = 'void';
    }
    let total = 0n;
    try {
      if (
        pd.rsdEquivalentMinor === null ||
        (pd.currency !== 'RSD' && (!pd.exchangeRate || !pd.exchangeRateSource))
      )
        throw conflict(
          'Purchase conversion snapshot is missing or inconsistent',
        );
      // Validate even if no posted refund remains.
      cumulativeRefundRsd(
        pd.amountMinor,
        pd.rsdEquivalentMinor,
        pd.currency,
        pd.exchangeRate,
        0n,
        0n,
      );
      for (const r of after)
        if (r.status === 'posted') {
          const amount = BigInt(r.amountMinor);
          const allocation = cumulativeRefundRsd(
            pd.amountMinor,
            pd.rsdEquivalentMinor,
            pd.currency,
            pd.exchangeRate,
            total,
            amount,
          ).toString();
          total += amount;
          if (r.id !== id && r.rsdEquivalentMinor !== allocation) {
            if (operation === 'post')
              throw conflict('Existing refund allocation is inconsistent');
            r.version++;
          }
          r.rsdEquivalentMinor = allocation;
        }
    } catch (e) {
      if (e instanceof Error && 'getStatus' in e) throw e;
      throw conflict(
        'Refund exceeds purchase or conversion snapshot is inconsistent',
      );
    }
    const target = after.find((r) => r.id === id)!;
    const now = new Date().toISOString();
    const targetRecord: RefundRecord = {
      id,
      householdId: h,
      type: 'refund',
      purchaseTransactionId: purchaseId,
      transactionDate: target.transactionDate,
      accountId: target.accountId,
      amountMinor: target.amountMinor,
      categoryId: purchase.categoryId,
      currency: pd.currency as Currency,
      exchangeRate: pd.exchangeRate,
      exchangeRateSource: pd.exchangeRateSource,
      merchant: target.merchant,
      note: target.note,
      authorMemberId: old
        ? rows.find((r) => r.id === id)!.authorMemberId
        : actor,
      version: target.version,
      status: target.status as 'posted' | 'void',
      rsdEquivalentMinor: target.rsdEquivalentMinor,
      createdAt: old ? rows.find((r) => r.id === id)!.createdAt : now,
      updatedAt: now,
    };
    const audits: {
      id: string;
      transactionId: string;
      version: number;
      beforeRequired: number;
      actorMemberId: string;
      action: string;
      detailsJson: string;
    }[] = [];
    const addAudit = (
      transactionId: string,
      v: number,
      oldValue: unknown,
      newValue: unknown,
      action: string,
    ) =>
      audits.push({
        id: crypto.randomUUID(),
        transactionId,
        version: v,
        beforeRequired: oldValue ? 1 : 0,
        actorMemberId: actor,
        action,
        detailsJson: JSON.stringify(
          oldValue
            ? { before: oldValue, after: newValue }
            : { after: newValue },
        ),
      });
    const purchaseRecord = {
      id: purchaseId,
      householdId: h,
      type: 'expense',
      transactionDate: purchase.transactionDate,
      accountId: pd.accountId,
      categoryId: purchase.categoryId,
      amountMinor: pd.amountMinor.toString(),
      currency: pd.currency,
      exchangeRate: pd.exchangeRate,
      exchangeRateSource: pd.exchangeRateSource,
      rsdEquivalentMinor: pd.rsdEquivalentMinor?.toString() ?? null,
      merchant: purchase.merchant,
      note: purchase.note,
      authorMemberId: purchase.authorMemberId,
      status: purchase.status,
      version: pv,
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
    };
    addAudit(
      purchaseId,
      pv + 1,
      purchaseRecord,
      { ...purchaseRecord, version: pv + 1, updatedAt: now },
      'transaction.edited',
    );
    const fullRefund = (r: (typeof after)[number], changed: boolean) => {
      const row = rows.find((item) => item.id === r.id);
      return {
        ...r,
        householdId: h,
        type: 'refund',
        purchaseTransactionId: purchaseId,
        categoryId: row?.categoryId ?? purchase.categoryId,
        currency: row?.postingDetails?.currency ?? pd.currency,
        exchangeRate: row?.postingDetails?.exchangeRate ?? pd.exchangeRate,
        exchangeRateSource:
          row?.postingDetails?.exchangeRateSource ?? pd.exchangeRateSource,
        authorMemberId: row?.authorMemberId ?? actor,
        createdAt: row?.createdAt ?? now,
        updatedAt: changed ? now : (row?.updatedAt ?? now),
      };
    };
    for (const r of after) {
      const prior = records.find((x) => x.id === r.id);
      if (r.id === id || (prior && prior.version !== r.version))
        addAudit(
          r.id,
          r.version,
          prior ? fullRefund(prior, false) : null,
          fullRefund(r, true),
          `transaction.${r.id === id ? (operation === 'post' ? 'posted' : operation === 'void' ? 'voided' : 'edited') : 'edited'}`,
        );
    }
    const beforeJson = JSON.stringify(before),
      afterJson = JSON.stringify({
        purchase: { ...beforePurchase, version: pv + 1 },
        refunds: after,
        audits,
      });
    const claim = crypto.randomUUID(),
      payload = JSON.stringify(input),
      gate =
        operation === 'post'
          ? `EXISTS(SELECT 1 FROM posting_requests WHERE id='${claim}')`
          : '1';
    const s = [this.access(identity, h)];
    if (operation === 'post') {
      s.push(
        this.stmt(
          `INSERT OR IGNORE INTO posting_requests(id,household_id,member_id,request_key,payload) VALUES(?,?,${memberSql},?,?)`,
          claim,
          h,
          h,
          identity.subject,
          key,
          payload,
        ),
        this.check(gate),
        this.stmt(
          `INSERT INTO posting_request_checks(household_id,member_id,request_key,payload) VALUES(?,${memberSql},?,?)`,
          h,
          h,
          identity.subject,
          key,
          payload,
        ),
      );
    }
    s.push(
      this.stmt(
        `INSERT INTO refund_checks(household_id,transaction_id,purchase_id,version,operation,before_json,expected_json) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,
        h,
        id,
        purchaseId,
        version,
        operation,
        beforeJson,
        JSON.stringify({
          accountId: input?.accountId ?? null,
          amountMinor: input?.amountMinor ?? null,
        }),
      ),
      this.stmt(
        `UPDATE transactions SET version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=? AND status='posted' AND type='expense' AND ${gate}`,
        now,
        h,
        purchaseId,
        pv,
      ),
      this.check(gate),
    );
    if (operation === 'post') {
      s.push(
        this.stmt(
          `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,merchant,note,author_member_id,status,version,parent_transaction_id,created_at,updated_at) SELECT ?,?,'refund',?,?,?,?,?,'posted',1,?,?,? WHERE ${gate}`,
          id,
          h,
          target.transactionDate,
          purchase.categoryId,
          target.merchant,
          target.note,
          actor,
          purchaseId,
          now,
          now,
        ),
        this.check(gate),
        this.stmt(
          `INSERT INTO refund_details(transaction_id,household_id,purchase_transaction_id,allocation_sequence) SELECT ?,?,?,CAST(? AS INTEGER) WHERE ${gate}`,
          id,
          h,
          purchaseId,
          target.sequence,
        ),
        this.check(gate),
        this.stmt(
          `INSERT INTO posting_details(transaction_id,household_id,account_id,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source) SELECT ?,?,?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,? WHERE ${gate}`,
          id,
          h,
          target.accountId,
          target.amountMinor,
          pd.currency,
          target.rsdEquivalentMinor,
          pd.exchangeRate,
          pd.exchangeRateSource,
        ),
        this.check(gate),
      );
    } else {
      s.push(
        this.stmt(
          'DELETE FROM account_movements WHERE household_id=? AND transaction_id=?',
          h,
          id,
        ),
        this.check(),
        this.stmt(
          `UPDATE transactions SET transaction_date=?,merchant=?,note=?,status=?,version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=? AND status='posted'`,
          target.transactionDate,
          target.merchant,
          target.note,
          target.status,
          now,
          h,
          id,
          version,
        ),
        this.check(),
      );
      if (operation === 'edit')
        s.push(
          this.stmt(
            'UPDATE posting_details SET account_id=?,amount_minor=CAST(? AS INTEGER),rsd_equivalent_minor=CAST(? AS INTEGER) WHERE household_id=? AND transaction_id=?',
            target.accountId,
            target.amountMinor,
            target.rsdEquivalentMinor,
            h,
            id,
          ),
          this.check(),
        );
    }
    if (operation !== 'void')
      s.push(
        this.stmt(
          `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) SELECT ?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,?,? WHERE ${gate}`,
          crypto.randomUUID(),
          h,
          target.accountId,
          id,
          target.transactionDate,
          target.amountMinor,
          pd.currency,
          target.rsdEquivalentMinor,
          pd.exchangeRate,
          pd.exchangeRateSource,
          now,
        ),
        this.check(gate),
      );
    const changed = after.filter(
      (r) =>
        r.id !== id &&
        records.find((x) => x.id === r.id)?.version !== r.version,
    );
    if (changed.length) {
      const json = JSON.stringify(changed);
      s.push(
        this.stmt(
          `UPDATE transactions SET version=version+1,updated_at=? WHERE household_id=? AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,
          now,
          h,
          json,
        ),
        this.stmt(
          'INSERT INTO refund_count_checks(changed,expected) VALUES(changes(),?)',
          changed.length,
        ),
        this.stmt(
          `UPDATE posting_details SET rsd_equivalent_minor=CAST((SELECT json_extract(value,'$.rsdEquivalentMinor') FROM json_each(?) WHERE json_extract(value,'$.id')=transaction_id) AS INTEGER) WHERE household_id=? AND transaction_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,
          json,
          h,
          json,
        ),
        this.stmt(
          'INSERT INTO refund_count_checks(changed,expected) VALUES(changes(),?)',
          changed.length,
        ),
        this.stmt(
          `UPDATE account_movements SET rsd_equivalent_minor=CAST((SELECT json_extract(value,'$.rsdEquivalentMinor') FROM json_each(?) WHERE json_extract(value,'$.id')=transaction_id) AS INTEGER) WHERE household_id=? AND transaction_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,
          json,
          h,
          json,
        ),
        this.stmt(
          'INSERT INTO refund_count_checks(changed,expected) VALUES(changes(),?)',
          changed.length,
        ),
      );
    }
    for (const a of audits)
      s.push(
        this.stmt(
          `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,
          a.id,
          h,
          actor,
          a.action,
          a.transactionId,
          a.detailsJson,
          now,
        ),
        this.check(gate),
      );
    if (operation === 'post') {
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(payload),
          ),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      s.push(
        this.stmt(
          `INSERT INTO idempotency_keys(id,household_id,member_id,request_key,payload_hash,transaction_id,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,
          crypto.randomUUID(),
          h,
          actor,
          key,
          hash,
          id,
          now,
        ),
        this.check(gate),
        this.stmt(
          'UPDATE posting_requests SET response_json=? WHERE id=?',
          JSON.stringify(targetRecord),
          claim,
        ),
        this.check(gate),
      );
    }
    s.push(
      this.stmt(
        `INSERT INTO refund_result_checks(household_id,transaction_id,purchase_id,operation,before_json,after_json,claim_id) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,
        h,
        id,
        purchaseId,
        operation,
        beforeJson,
        afterJson,
        operation === 'post' ? claim : null,
      ),
    );
    if (operation === 'post')
      s.push(
        this.stmt(
          `INSERT INTO posting_replay_checks(household_id,member_id,request_key) VALUES(?,${memberSql},?)`,
          h,
          h,
          identity.subject,
          key,
        ),
        this.stmt(
          `SELECT response_json AS responseJson FROM posting_requests WHERE household_id=? AND member_id=${memberSql} AND request_key=?`,
          h,
          h,
          identity.subject,
          key,
        ),
      );
    else
      s.push(
        this.stmt(
          `SELECT json_object('id',t.id,'householdId',t.household_id,'type',t.type,'purchaseTransactionId',rd.purchase_transaction_id,'transactionDate',t.transaction_date,'accountId',d.account_id,'amountMinor',CAST(d.amount_minor AS TEXT),'categoryId',t.category_id,'currency',d.currency,'exchangeRate',d.exchange_rate,'exchangeRateSource',d.exchange_rate_source,'merchant',t.merchant,'note',t.note,'authorMemberId',t.author_member_id,'version',t.version,'status',t.status,'rsdEquivalentMinor',CAST(d.rsd_equivalent_minor AS TEXT),'createdAt',t.created_at,'updatedAt',t.updated_at) AS responseJson FROM transactions t JOIN posting_details d ON d.household_id=t.household_id AND d.transaction_id=t.id JOIN refund_details rd ON rd.household_id=t.household_id AND rd.transaction_id=t.id WHERE t.household_id=? AND t.id=?`,
          h,
          id,
        ),
      );
    const result = await this.run(s);
    if (operation === 'post') {
      const row = result.at(-1)?.results?.[0] as
        { responseJson?: string } | undefined;
      if (!row?.responseJson) throw unavailable();
      return JSON.parse(row.responseJson) as RefundRecord;
    }
    const row = result.at(-1)?.results?.[0] as
      { responseJson?: string } | undefined;
    if (!row?.responseJson) throw unavailable();
    return JSON.parse(row.responseJson) as RefundRecord;
  }
}
