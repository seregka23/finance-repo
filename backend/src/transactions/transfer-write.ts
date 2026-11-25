import type { PostingHook } from './contracts.js';
import type { Identity } from '../auth/auth.js';
import { unavailable } from '../auth/auth.js';
import { recordConversion } from '../finance/fx.js';
import type { Database } from '../households/households.js';
import type { TransferInput, TransferRecord } from './contracts.js';

const member = `(SELECT id FROM household_members WHERE household_id=? AND identity_subject=? AND status='active')`;
const snapshot = `SELECT json_object('id',t.id,'householdId',t.household_id,'type',t.type,'transactionDate',t.transaction_date,'fromAccountId',d.from_account_id,'toAccountId',d.to_account_id,'debitAmountMinor',CAST(d.debit_amount_minor AS TEXT),'creditAmountMinor',CAST(d.credit_amount_minor AS TEXT),'debitCurrency',d.debit_currency,'creditCurrency',d.credit_currency,'fee',json(CASE WHEN f.id IS NULL THEN 'null' ELSE json_object('id',f.id,'accountId',p.account_id,'currency',p.currency,'amountMinor',CAST(p.amount_minor AS TEXT),'categoryId',f.category_id,'exchangeRate',p.exchange_rate,'exchangeRateSource',p.exchange_rate_source,'rsdEquivalentMinor',CAST(p.rsd_equivalent_minor AS TEXT)) END),'merchant',t.merchant,'note',t.note,'authorMemberId',t.author_member_id,'status',t.status,'version',t.version,'createdAt',t.created_at,'updatedAt',t.updated_at) FROM transactions t JOIN transfer_details d ON d.household_id=t.household_id AND d.transaction_id=t.id LEFT JOIN transactions f ON f.household_id=d.household_id AND f.id=d.fee_transaction_id LEFT JOIN posting_details p ON p.household_id=f.household_id AND p.transaction_id=f.id WHERE t.household_id=? AND t.id=?`;
type Bind = string | number | null;
export class TransferWrite {
  constructor(
    private readonly db: Database,
    private readonly run: (s: D1PreparedStatement[]) => Promise<D1Result[]>,
  ) {}
  private stmt(sql: string, ...values: Bind[]) {
    return this.db.prepare(sql).bind(...values);
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
  async post(
    identity: Identity,
    h: string,
    input: TransferInput,
    key: string,
    hook?: PostingHook,
  ): Promise<TransferRecord> {
    const id = crypto.randomUUID(),
      claim = crypto.randomUUID(),
      audit = crypto.randomUUID(),
      feeId = input.fee ? crypto.randomUUID() : null,
      now = new Date().toISOString(),
      payload = JSON.stringify(input);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(payload),
        ),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const gate = `EXISTS(SELECT 1 FROM posting_requests WHERE id='${claim}')`;
    const feeRsd = input.fee
      ? recordConversion(
          BigInt(input.fee.amountMinor),
          input.debitCurrency,
          input.fee.exchangeRate,
          input.fee.exchangeRateSource,
        ).rsdEquivalentMinor
      : null;
    const s = [
      this.access(identity, h),
      this.stmt(
        `INSERT OR IGNORE INTO posting_requests(id,household_id,member_id,request_key,payload) VALUES(?,?,${member},?,?)`,
        claim,
        h,
        h,
        identity.subject,
        key,
        payload,
      ),
      this.check(gate),
      this.stmt(
        `INSERT INTO posting_request_checks(household_id,member_id,request_key,payload) VALUES(?,${member},?,?)`,
        h,
        h,
        identity.subject,
        key,
        payload,
      ),
      this.stmt(
        `INSERT INTO transfer_checks(household_id,member_id,transaction_id,version,operation,expected_json) SELECT ?,${member},?,NULL,'post',? WHERE ${gate}`,
        h,
        h,
        identity.subject,
        id,
        payload,
      ),
      this.stmt(
        `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,merchant,note,author_member_id,status,version,created_at,updated_at) SELECT ?,?,'transfer',?,NULL,?,?,${member},'posted',1,?,? WHERE ${gate}`,
        id,
        h,
        input.transactionDate,
        input.merchant,
        input.note,
        h,
        identity.subject,
        now,
        now,
      ),
      this.check(gate),
    ];
    if (input.fee && feeId)
      s.push(
        this.stmt(
          `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,merchant,note,author_member_id,status,version,parent_transaction_id,created_at,updated_at) SELECT ?,?,'fee',?,?,NULL,NULL,${member},'posted',1,?,?,? WHERE ${gate}`,
          feeId,
          h,
          input.transactionDate,
          input.fee.categoryId,
          h,
          identity.subject,
          id,
          now,
          now,
        ),
        this.check(gate),
        this.stmt(
          `INSERT INTO posting_details(transaction_id,household_id,account_id,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source) SELECT ?,?,?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,? WHERE ${gate}`,
          feeId,
          h,
          input.fromAccountId,
          input.fee.amountMinor,
          input.debitCurrency,
          feeRsd,
          input.fee.exchangeRate,
          input.fee.exchangeRateSource,
        ),
        this.check(gate),
      );
    s.push(
      this.stmt(
        `INSERT INTO transfer_details(transaction_id,household_id,from_account_id,to_account_id,debit_amount_minor,credit_amount_minor,debit_currency,credit_currency,fee_transaction_id) SELECT ?,?,?,?,CAST(? AS INTEGER),CAST(? AS INTEGER),?,?,? WHERE ${gate}`,
        id,
        h,
        input.fromAccountId,
        input.toAccountId,
        input.debitAmountMinor,
        input.creditAmountMinor,
        input.debitCurrency,
        input.creditCurrency,
        feeId,
      ),
      this.check(gate),
    );
    for (const [account, amount, currency] of [
      [input.fromAccountId, `-${input.debitAmountMinor}`, input.debitCurrency],
      [input.toAccountId, input.creditAmountMinor, input.creditCurrency],
    ])
      s.push(
        this.stmt(
          `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,created_at) SELECT ?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,? WHERE ${gate}`,
          crypto.randomUUID(),
          h,
          account,
          id,
          input.transactionDate,
          amount,
          currency,
          now,
        ),
        this.check(gate),
      );
    if (input.fee && feeId)
      s.push(
        this.stmt(
          `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) SELECT ?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,?,? WHERE ${gate}`,
          crypto.randomUUID(),
          h,
          input.fromAccountId,
          feeId,
          input.transactionDate,
          `-${input.fee.amountMinor}`,
          input.debitCurrency,
          `-${feeRsd}`,
          input.fee.exchangeRate,
          input.fee.exchangeRateSource,
          now,
        ),
        this.check(gate),
      );
    s.push(
      this.stmt(
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) SELECT ?,?,${member},'transaction.posted',?,?,? WHERE ${gate}`,
        audit,
        h,
        h,
        identity.subject,
        id,
        payload,
        now,
      ),
      this.check(gate),
      this.stmt(
        `INSERT INTO idempotency_keys(id,household_id,member_id,request_key,payload_hash,transaction_id,created_at) SELECT ?,?,${member},?,?,?,? WHERE ${gate}`,
        crypto.randomUUID(),
        h,
        h,
        identity.subject,
        key,
        hash,
        id,
        now,
      ),
      this.check(gate),
      this.stmt(
        `UPDATE posting_requests SET response_json=(${snapshot}) WHERE id=?`,
        h,
        id,
        claim,
      ),
      this.check(gate),
      this.stmt(
        `INSERT INTO transfer_result_checks(household_id,transaction_id,version,operation,expected_json,fee_id,fee_rsd,audit_id,claim_id) SELECT ?,?,1,'post',?,?,?,?,? WHERE ${gate}`,
        h,
        id,
        payload,
        feeId,
        feeRsd,
        audit,
        claim,
      ),
      ...(hook ? hook(id, gate) : []),
      this.stmt(
        `INSERT INTO posting_replay_checks(household_id,member_id,request_key) VALUES(?,${member},?)`,
        h,
        h,
        identity.subject,
        key,
      ),
      this.stmt(
        `SELECT response_json AS responseJson FROM posting_requests WHERE household_id=? AND member_id=${member} AND request_key=?`,
        h,
        h,
        identity.subject,
        key,
      ),
    );
    const result = await this.run(s);
    const row = result.at(-1)?.results?.[0] as
      { responseJson?: string } | undefined;
    if (!row?.responseJson) throw unavailable();
    return JSON.parse(row.responseJson) as TransferRecord;
  }
  async change(
    identity: Identity,
    h: string,
    id: string,
    version: number,
    input: TransferInput | null,
  ): Promise<TransferRecord> {
    const now = new Date().toISOString(),
      audit = crypto.randomUUID(),
      newFee = crypto.randomUUID();
    const oldFee = `(SELECT json_extract(details_json,'$.before.fee.id') FROM audit_events WHERE id='${audit}')`;
    const hasOld = `${oldFee} IS NOT NULL`;
    const feeId = input?.fee ? `COALESCE(${oldFee},'${newFee}')` : 'NULL';
    const payload = JSON.stringify(input ?? {}),
      operation = input ? 'edit' : 'void';
    const feeRsd = input?.fee
      ? recordConversion(
          BigInt(input.fee.amountMinor),
          input.debitCurrency,
          input.fee.exchangeRate,
          input.fee.exchangeRateSource,
        ).rsdEquivalentMinor
      : null;
    const s = [
      this.access(identity, h),
      this.stmt(
        `INSERT INTO transfer_checks(household_id,member_id,transaction_id,version,operation,expected_json) VALUES(?,${member},?,?,?,?)`,
        h,
        h,
        identity.subject,
        id,
        version,
        operation,
        payload,
      ),
      this.stmt(
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) VALUES(?,?,${member},?,?,json_object('before',json((${snapshot}))),?)`,
        audit,
        h,
        h,
        identity.subject,
        `transaction.${input ? 'edited' : 'voided'}`,
        id,
        h,
        id,
        now,
      ),
      this.check(),
      this.stmt(
        `DELETE FROM account_movements WHERE household_id=? AND transaction_id=? AND account_id=(SELECT from_account_id FROM transfer_details WHERE household_id=? AND transaction_id=?)`,
        h,
        id,
        h,
        id,
      ),
      this.check(),
      this.stmt(
        `DELETE FROM account_movements WHERE household_id=? AND transaction_id=? AND account_id=(SELECT to_account_id FROM transfer_details WHERE household_id=? AND transaction_id=?)`,
        h,
        id,
        h,
        id,
      ),
      this.check(),
      this.stmt(
        `DELETE FROM account_movements WHERE household_id=? AND transaction_id=${oldFee}`,
        h,
      ),
      this.check(hasOld),
    ];
    if (input) {
      if (input.fee) {
        s.push(
          this.stmt(
            `UPDATE transactions SET transaction_date=?,category_id=?,version=version+CASE WHEN transaction_date IS NOT ? OR category_id IS NOT ? OR EXISTS(SELECT 1 FROM posting_details p WHERE p.household_id=transactions.household_id AND p.transaction_id=transactions.id AND (p.account_id IS NOT ? OR p.amount_minor IS NOT CAST(? AS INTEGER) OR p.currency IS NOT ? OR p.rsd_equivalent_minor IS NOT CAST(? AS INTEGER) OR p.exchange_rate IS NOT ? OR p.exchange_rate_source IS NOT ?)) THEN 1 ELSE 0 END,updated_at=? WHERE household_id=? AND id=${oldFee}`,
            input.transactionDate,
            input.fee.categoryId,
            input.transactionDate,
            input.fee.categoryId,
            input.fromAccountId,
            input.fee.amountMinor,
            input.debitCurrency,
            feeRsd,
            input.fee.exchangeRate,
            input.fee.exchangeRateSource,
            now,
            h,
          ),
          this.check(hasOld),
          this.stmt(
            `UPDATE posting_details SET account_id=?,amount_minor=CAST(? AS INTEGER),currency=?,rsd_equivalent_minor=CAST(? AS INTEGER),exchange_rate=?,exchange_rate_source=? WHERE household_id=? AND transaction_id=${oldFee}`,
            input.fromAccountId,
            input.fee.amountMinor,
            input.debitCurrency,
            feeRsd,
            input.fee.exchangeRate,
            input.fee.exchangeRateSource,
            h,
          ),
          this.check(hasOld),
          this.stmt(
            `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,merchant,note,author_member_id,status,version,parent_transaction_id,created_at,updated_at) SELECT ?,?,'fee',?,?,NULL,NULL,${member},'posted',1,?,?,? WHERE NOT (${hasOld})`,
            newFee,
            h,
            input.transactionDate,
            input.fee.categoryId,
            h,
            identity.subject,
            id,
            now,
            now,
          ),
          this.check(`NOT (${hasOld})`),
          this.stmt(
            `INSERT INTO posting_details(transaction_id,household_id,account_id,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source) SELECT ?,?,?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,? WHERE NOT (${hasOld})`,
            newFee,
            h,
            input.fromAccountId,
            input.fee.amountMinor,
            input.debitCurrency,
            feeRsd,
            input.fee.exchangeRate,
            input.fee.exchangeRateSource,
          ),
          this.check(`NOT (${hasOld})`),
        );
      } else
        s.push(
          this.stmt(
            `UPDATE transactions SET status='void',version=version+1,updated_at=? WHERE household_id=? AND id=${oldFee}`,
            now,
            h,
          ),
          this.check(hasOld),
        );
      s.push(
        this.stmt(
          `UPDATE transactions SET transaction_date=?,merchant=?,note=?,version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=? AND status='posted'`,
          input.transactionDate,
          input.merchant,
          input.note,
          now,
          h,
          id,
          version,
        ),
        this.check(),
        this.stmt(
          `UPDATE transfer_details SET from_account_id=?,to_account_id=?,debit_amount_minor=CAST(? AS INTEGER),credit_amount_minor=CAST(? AS INTEGER),debit_currency=?,credit_currency=?,fee_transaction_id=${feeId} WHERE household_id=? AND transaction_id=?`,
          input.fromAccountId,
          input.toAccountId,
          input.debitAmountMinor,
          input.creditAmountMinor,
          input.debitCurrency,
          input.creditCurrency,
          h,
          id,
        ),
        this.check(),
      );
      for (const [account, amount, currency] of [
        [
          input.fromAccountId,
          `-${input.debitAmountMinor}`,
          input.debitCurrency,
        ],
        [input.toAccountId, input.creditAmountMinor, input.creditCurrency],
      ])
        s.push(
          this.stmt(
            `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,created_at) VALUES(?,?,?,?,'transaction',?,CAST(? AS INTEGER),?,?)`,
            crypto.randomUUID(),
            h,
            account,
            id,
            input.transactionDate,
            amount,
            currency,
            now,
          ),
          this.check(),
        );
      if (input.fee)
        s.push(
          this.stmt(
            `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) VALUES(?,?,?,${feeId},'transaction',?,CAST(? AS INTEGER),?,CAST(? AS INTEGER),?,?,?)`,
            crypto.randomUUID(),
            h,
            input.fromAccountId,
            input.transactionDate,
            `-${input.fee.amountMinor}`,
            input.debitCurrency,
            `-${feeRsd}`,
            input.fee.exchangeRate,
            input.fee.exchangeRateSource,
            now,
          ),
          this.check(),
        );
    } else
      s.push(
        this.stmt(
          `UPDATE transactions SET status='void',version=version+1,updated_at=? WHERE household_id=? AND id=${oldFee}`,
          now,
          h,
        ),
        this.check(hasOld),
        this.stmt(
          `UPDATE transactions SET status='void',version=version+1,updated_at=? WHERE household_id=? AND id=? AND version=? AND status='posted'`,
          now,
          h,
          id,
          version,
        ),
        this.check(),
      );
    s.push(
      this.stmt(
        `UPDATE audit_events SET details_json=json_set(details_json,'$.after',json((${snapshot}))) WHERE id=?`,
        h,
        id,
        audit,
      ),
      this.check(),
      this.stmt(
        `INSERT INTO transfer_result_checks(household_id,transaction_id,version,operation,expected_json,fee_id,fee_rsd,audit_id,claim_id) VALUES(?,?,?,?,?,${feeId},?,?,NULL)`,
        h,
        id,
        version + 1,
        operation,
        payload,
        feeRsd,
        audit,
      ),
      this.stmt(snapshot, h, id),
    );
    const result = await this.run(s);
    const row = result.at(-1)?.results?.[0];
    if (!row) throw unavailable();
    const value = Object.values(row)[0];
    if (typeof value !== 'string') throw unavailable();
    return JSON.parse(value) as TransferRecord;
  }
}
