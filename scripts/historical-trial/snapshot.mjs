import { createHash } from "node:crypto";
const datasets = [
  "accounts",
  "categories",
  "transactions",
  "plans",
  "reserves",
];
const sources = ["notion", "supabase"];
const currencies = new Set(["RSD", "EUR", "RUB", "USD"]);
const MAX = 9007199254740991n;
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const validId = (x) =>
  typeof x === "string" && x.length > 0 && x.length <= 200 && x.trim() === x;
const validText = (x) =>
  typeof x === "string" && x.trim().length > 0 && x.length <= 200;
const date = (x) => {
  if (typeof x !== "string" || !/^\d{4}-\d\d-\d\d$/.test(x)) return false;
  const d = new Date(x + "T00:00:00.000Z");
  return (
    Number.isFinite(d.valueOf()) &&
    d.toISOString().slice(0, 10) === x &&
    !x.startsWith("0000")
  );
};
const month = (x) =>
  typeof x === "string" && /^\d{4}-\d\d$/.test(x) && date(x + "-01");
function integer(x, { positive = false, nonnegative = false } = {}) {
  if (
    typeof x !== "string" ||
    !/^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(x) ||
    x.length > 17
  )
    throw Error("invalid_amount");
  const n = BigInt(x);
  if (n > MAX || n < -MAX || (positive && n <= 0n) || (nonnegative && n < 0n))
    throw Error("invalid_amount");
  return x;
}
const currency = (x) => {
  if (!currencies.has(x)) throw Error("invalid_currency");
  return x;
};
function rate(v) {
  if (v === null || v === undefined) return null;
  if (
    typeof v !== "string" ||
    v.length > 80 ||
    !/^\d+(?:\.\d+)?$/.test(v) ||
    !/[1-9]/.test(v)
  )
    throw Error("invalid_rate");
  return v;
}
function rateParts(value) {
  const [whole, fraction = ""] = value.split(".");
  return {
    numerator: BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  };
}
function convertAtRate(amount, value) {
  const { numerator, denominator } = rateParts(value);
  return (BigInt(amount) * numerator + denominator / 2n) / denominator;
}
function valuation(row, amt, cur) {
  const r = rate(row.exchangeRate),
    source = row.exchangeRateSource ?? null;
  if (source !== null && (!validText(source) || !r)) throw Error("invalid_fx");
  let rsd =
    row.rsdEquivalentMinor == null
      ? null
      : integer(row.rsdEquivalentMinor, { nonnegative: true });
  if (cur === "RSD") {
    if (
      (r !== null &&
        (() => {
          const p = rateParts(r);
          return p.numerator !== p.denominator;
        })()) ||
      (rsd !== null && rsd !== amt)
    )
      throw Error("invalid_fx");
    rsd = amt;
  }
  const inconsistent =
    cur !== "RSD" &&
    r !== null &&
    rsd !== null &&
    convertAtRate(amt, r) !== BigInt(rsd);
  return { rsd, rate: r, source, inconsistent };
}
function inventory(snapshot) {
  const result = {};
  for (const source of sources) {
    result[source] = {};
    for (const d of datasets) {
      const v = snapshot?.datasets?.[source]?.[d];
      result[source][d] = Array.isArray(v) ? v.length : null;
    }
  }
  return result;
}
export function inspectSnapshot(snapshot) {
  const inv = inventory(snapshot),
    missing = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return {
      inventory: inv,
      missingInputs: [
        "snapshot",
        "version",
        "snapshotId",
        "asOf",
        ...datasets.flatMap((d) => [
          `authority.${d}`,
          `datasets.<authoritative-source>.${d}`,
        ]),
        "controls.counts",
        "controls.accountBalances",
        "controls.monthly",
        "controls.reserveBalances",
      ],
      valid: false,
    };
  if (snapshot.version !== 1) missing.push("version");
  if (!validId(snapshot.snapshotId)) missing.push("snapshotId");
  if (
    typeof snapshot.asOf !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(snapshot.asOf) ||
    !Number.isFinite(Date.parse(snapshot.asOf)) ||
    new Date(snapshot.asOf).toISOString() !== snapshot.asOf
  )
    missing.push("asOf");
  for (const source of sources)
    for (const d of datasets) {
      const value = snapshot.datasets?.[source]?.[d];
      if (value !== undefined && !Array.isArray(value))
        missing.push(`datasets.${source}.${d}.invalid`);
    }
  for (const d of datasets) {
    const authority = snapshot.authority?.[d];
    if (!sources.includes(authority)) missing.push(`authority.${d}`);
    else if (!Array.isArray(snapshot.datasets?.[authority]?.[d]))
      missing.push(`datasets.${authority}.${d}`);
  }
  const counts = snapshot.controls?.counts;
  if (
    !counts ||
    datasets.some((d) => !Number.isSafeInteger(counts[d]) || counts[d] < 0)
  )
    missing.push("controls.counts");
  for (const key of ["accountBalances", "monthly", "reserveBalances"])
    if (!Array.isArray(snapshot.controls?.[key]))
      missing.push(`controls.${key}`);
  return {
    inventory: inv,
    missingInputs: missing,
    valid: missing.length === 0,
  };
}
export function normalizeSnapshot(snapshot) {
  const exceptions = {
    unconfirmed: [],
    unmatchedTransfers: [],
    missingFx: [],
    unresolved: [],
  };
  const tables = {};
  for (const n of [
    "households",
    "household_members",
    "accounts",
    "categories",
    "monthly_plans",
    "transactions",
    "posting_details",
    "transfer_details",
    "refund_details",
    "account_movements",
    "reserves",
    "reserve_movements",
    "import_references",
  ])
    tables[n] = [];
  const snap = snapshot.snapshotId,
    now = snapshot.asOf,
    householdId = hash(snap, "household"),
    member = hash(snap, "member");
  tables.households.push({
    id: householdId,
    name: "Historical trial",
    base_currency: "RSD",
    time_zone: "Europe/Belgrade",
    status: "active",
    created_at: now,
    updated_at: now,
  });
  tables.household_members.push({
    id: member,
    household_id: householdId,
    role: "owner",
    status: "active",
    created_at: now,
    updated_at: now,
  });
  const prefix = { household_id: householdId };
  const ids = {
    accounts: new Map(),
    categories: new Map(),
    transactions: new Map(),
    reserves: new Map(),
  };
  const seen = {};
  const records = (d) => snapshot.datasets[snapshot.authority[d]][d];
  const id = (dataset, external, source = snapshot.authority[dataset]) =>
    hash(snap, dataset, source, external);
  function problem(kind, dataset, index, reason) {
    const safe = new Set([
      "invalid_id",
      "duplicate_id",
      "invalid_amount",
      "invalid_currency",
      "invalid_date",
      "invalid_month",
      "invalid_account",
      "invalid_category",
      "account_mismatch",
      "category_mismatch",
      "invalid_rate",
      "invalid_fx",
      "unsupported_type",
      "invalid_transfer",
      "invalid_fee",
      "missing_purchase",
      "refund_currency_mismatch",
      "refund_exceeds_purchase",
      "refund_fx_mismatch",
      "invalid_refund_sequence",
      "unresolved_prior_refund",
      "duplicate_plan",
      "invalid_reserve",
      "invalid_reserve_movement",
      "invalid_reserve_link",
      "not_posted",
      "missing_leg",
      "missing_fx",
      "fee_missing_fx",
      "refund_missing_fx",
      "inconsistent_fx",
      "invalid_adjustment",
      "duplicate_reference",
    ]);
    exceptions[kind].push({
      dataset,
      source: snapshot.authority[dataset],
      index,
      reason: safe.has(reason) ? reason : "invalid_record",
    });
  }
  function ref(dataset, external, targetType, targetId, extra = "") {
    tables.import_references.push({
      id: hash(
        snap,
        "reference",
        dataset,
        snapshot.authority[dataset],
        external,
        extra,
      ),
      ...prefix,
      source_type: `${snapshot.authority[dataset]}:${dataset}`,
      source_record_id: external,
      [targetType]: targetId,
      created_at: now,
    });
  }
  function checkUnique(d, r) {
    if (!r || typeof r !== "object" || Array.isArray(r) || !validId(r.id))
      throw Error("invalid_id");
    seen[d] ??= new Set();
    if (seen[d].has(r.id)) throw Error("duplicate_id");
    seen[d].add(r.id);
  }
  const accountExternalIds = new Set(
    records("accounts")
      .map((r) => r?.id)
      .filter(validId),
  );
  const adjustmentRefs = new Set();
  records("accounts").forEach((r, i) => {
    try {
      checkUnique("accounts", r);
      if (
        !validText(r.name) ||
        !["cash", "bank", "card"].includes(r.type) ||
        !date(r.openingDate)
      )
        throw Error("invalid_account");
      currency(r.currency);
      integer(r.openingBalanceMinor, { nonnegative: true });
      const x = id("accounts", r.id);
      ids.accounts.set(r.id, { id: x, currency: r.currency });
      tables.accounts.push({
        id: x,
        ...prefix,
        name: r.name.trim(),
        type: r.type,
        currency: r.currency,
        owner_member_id: null,
        designation: "personal",
        status: "active",
        created_at: now,
        updated_at: now,
      });
      tables.account_movements.push({
        id: hash(snap, "opening", x),
        ...prefix,
        account_id: x,
        transaction_id: null,
        type: "opening_balance",
        movement_date: r.openingDate,
        amount_minor: r.openingBalanceMinor,
        currency: r.currency,
        created_at: now,
      });
      ref("accounts", r.id, "account_id", x);
      if (r.adjustments !== undefined) {
        if (!Array.isArray(r.adjustments))
          problem("unresolved", "accounts", i, "invalid_adjustment");
        else
          for (const a of r.adjustments) {
            try {
              if (
                !a ||
                !validId(a.id) ||
                accountExternalIds.has(a.id) ||
                adjustmentRefs.has(a.id) ||
                !date(a.date) ||
                (a.currency !== undefined && a.currency !== r.currency)
              )
                throw Error("invalid_adjustment");
              const amount = integer(a.amountMinor);
              if (amount === "0") throw Error("invalid_adjustment");
              adjustmentRefs.add(a.id);
              tables.account_movements.push({
                id: hash(snap, "adjustment", snapshot.authority.accounts, a.id),
                ...prefix,
                account_id: x,
                transaction_id: null,
                type: "adjustment",
                movement_date: a.date,
                amount_minor: amount,
                currency: r.currency,
                created_at: now,
              });
              ref("accounts", a.id, "account_id", x, "adjustment");
            } catch {
              problem("unresolved", "accounts", i, "invalid_adjustment");
            }
          }
      }
    } catch (e) {
      problem("unresolved", "accounts", i, e.message);
    }
  });
  records("categories").forEach((r, i) => {
    try {
      checkUnique("categories", r);
      if (!validText(r.name) || !["expense", "income"].includes(r.type))
        throw Error("invalid_category");
      const x = id("categories", r.id);
      ids.categories.set(r.id, { id: x, type: r.type });
      tables.categories.push({
        id: x,
        ...prefix,
        name: r.name.trim(),
        type: r.type,
        status: "active",
        created_at: now,
        updated_at: now,
      });
      ref("categories", r.id, "category_id", x);
    } catch (e) {
      problem("unresolved", "categories", i, e.message);
    }
  });
  const account = (external, cur) => {
    const x = ids.accounts.get(external);
    if (!x || x.currency !== cur) throw Error("account_mismatch");
    return x;
  };
  const category = (external, type) => {
    const x = ids.categories.get(external);
    if (!x || x.type !== type) throw Error("category_mismatch");
    return x;
  };
  const txnRows = records("transactions");
  const txnIds = new Set(txnRows.map((r) => r?.id).filter(validId)),
    auxiliaryIds = new Set();
  const refundsByPurchase = new Map();
  function header(x, type, dt, cat, parent = null) {
    tables.transactions.push({
      id: x,
      ...prefix,
      type,
      transaction_date: dt,
      category_id: cat,
      merchant: null,
      note: null,
      author_member_id: member,
      status: "posted",
      version: 1,
      parent_transaction_id: parent,
      created_at: now,
      updated_at: now,
    });
  }
  function posting(x, acct, cat, type, dt, amt, cur, fx, parent = null) {
    header(x, type, dt, cat, parent);
    tables.posting_details.push({
      transaction_id: x,
      ...prefix,
      account_id: acct.id,
      amount_minor: amt,
      currency: cur,
      rsd_equivalent_minor: fx.rsd,
      exchange_rate: fx.rate,
      exchange_rate_source: fx.source,
    });
    const sign = type === "expense" || type === "fee" ? -1n : 1n;
    tables.account_movements.push({
      id: hash(snap, "movement", x),
      ...prefix,
      account_id: acct.id,
      transaction_id: x,
      type: "transaction",
      movement_date: dt,
      amount_minor: (sign * BigInt(amt)).toString(),
      currency: cur,
      rsd_equivalent_minor:
        fx.rsd === null ? null : (sign * BigInt(fx.rsd)).toString(),
      exchange_rate: fx.rate,
      exchange_rate_source: fx.source,
      created_at: now,
    });
  }
  txnRows.forEach((r, i) => {
    try {
      checkUnique("transactions", r);
      if (r.status !== "posted") {
        if (!["unconfirmed", "pending", "declined", "void"].includes(r.status))
          throw Error("unsupported_type");
        problem("unconfirmed", "transactions", i, "not_posted");
        return;
      }
      if (r.type === "refund") {
        if (!validId(r.purchaseId)) throw Error("missing_purchase");
        const refunds = refundsByPurchase.get(r.purchaseId) ?? [];
        refunds.push({ r, i, sequence: r.allocationSequence });
        refundsByPurchase.set(r.purchaseId, refunds);
        return;
      }
      if (!date(r.date)) throw Error("invalid_date");
      if (r.type === "transfer") {
        if (!r.debit || !r.credit) {
          problem("unmatchedTransfers", "transactions", i, "missing_leg");
          return;
        }
        if (
          !validId(r.debit.id) ||
          !validId(r.credit.id) ||
          r.debit.id === r.credit.id ||
          txnIds.has(r.debit.id) ||
          txnIds.has(r.credit.id) ||
          auxiliaryIds.has(r.debit.id) ||
          auxiliaryIds.has(r.credit.id) ||
          (r.debit.date !== undefined && !date(r.debit.date)) ||
          (r.credit.date !== undefined && !date(r.credit.date))
        )
          throw Error("invalid_transfer");
        const dc = currency(r.debit.currency),
          cc = currency(r.credit.currency),
          da = account(r.debit.accountId, dc),
          ca = account(r.credit.accountId, cc),
          dm = integer(r.debit.amountMinor, { positive: true }),
          cm = integer(r.credit.amountMinor, { positive: true });
        if (da.id === ca.id || (dc === cc && dm !== cm))
          throw Error("invalid_transfer");
        let fee = null;
        if (r.fee) {
          if (
            !validId(r.fee.id) ||
            r.fee.id === r.id ||
            r.fee.id === r.debit.id ||
            r.fee.id === r.credit.id ||
            txnIds.has(r.fee.id) ||
            auxiliaryIds.has(r.fee.id) ||
            (r.fee.date !== undefined && !date(r.fee.date)) ||
            r.fee.currency !== dc
          )
            throw Error("invalid_fee");
          const fcat = category(r.fee.categoryId, "expense"),
            fa = integer(r.fee.amountMinor, { positive: true }),
            fx = valuation(r.fee, fa, dc);
          fee = {
            id: hash(snap, "fee", snapshot.authority.transactions, r.fee.id),
            category: fcat,
            amount: fa,
            fx,
          };
        }
        auxiliaryIds.add(r.debit.id);
        auxiliaryIds.add(r.credit.id);
        if (r.fee) auxiliaryIds.add(r.fee.id);
        const x = id("transactions", r.id);
        header(x, "transfer", r.date, null);
        ids.transactions.set(r.id, { id: x, type: "transfer" });
        tables.transfer_details.push({
          transaction_id: x,
          ...prefix,
          from_account_id: da.id,
          to_account_id: ca.id,
          debit_amount_minor: dm,
          credit_amount_minor: cm,
          debit_currency: dc,
          credit_currency: cc,
          fee_transaction_id: fee?.id ?? null,
        });
        for (const [leg, acct, cur, amt, sign] of [
          [r.debit, da, dc, dm, -1n],
          [r.credit, ca, cc, cm, 1n],
        ]) {
          tables.account_movements.push({
            id: hash(snap, "leg", snapshot.authority.transactions, leg.id),
            ...prefix,
            account_id: acct.id,
            transaction_id: x,
            type: "transaction",
            movement_date: leg.date ?? r.date,
            amount_minor: (sign * BigInt(amt)).toString(),
            currency: cur,
            created_at: now,
          });
          ref("transactions", leg.id, "transaction_id", x, "leg");
        }
        if (fee) {
          posting(
            fee.id,
            da,
            fee.category.id,
            "fee",
            r.fee.date ?? r.date,
            fee.amount,
            dc,
            fee.fx,
            x,
          );
          ref("transactions", r.fee.id, "transaction_id", fee.id, "fee");
          if (dc !== "RSD" && (fee.fx.rsd === null || fee.fx.rate === null))
            problem("missingFx", "transactions", i, "fee_missing_fx");
          if (fee.fx.inconsistent)
            problem("unresolved", "transactions", i, "inconsistent_fx");
        }
        ref("transactions", r.id, "transaction_id", x);
        return;
      }
      if (!["expense", "income"].includes(r.type))
        throw Error("unsupported_type");
      const cur = currency(r.currency),
        acct = account(r.accountId, cur),
        cat = category(r.categoryId, r.type),
        amt = integer(r.amountMinor, { positive: true }),
        fx = valuation(r, amt, cur),
        x = id("transactions", r.id);
      posting(x, acct, cat.id, r.type, r.date, amt, cur, fx);
      ids.transactions.set(r.id, {
        id: x,
        type: r.type,
        amount: amt,
        currency: cur,
        categoryId: cat.id,
        accountId: acct.id,
        fx,
      });
      ref("transactions", r.id, "transaction_id", x);
      if (cur !== "RSD" && (fx.rsd === null || fx.rate === null))
        problem("missingFx", "transactions", i, "missing_fx");
      if (fx.inconsistent)
        problem("unresolved", "transactions", i, "inconsistent_fx");
    } catch (e) {
      problem("unresolved", "transactions", i, e.message);
    }
  });
  function importRefund({ r, i, sequence }, allocatedAmount) {
    try {
      if (!date(r.date)) throw Error("invalid_date");
      const p = ids.transactions.get(r.purchaseId);
      if (!p || p.type !== "expense") throw Error("missing_purchase");
      const cur = currency(r.currency),
        acct = account(r.accountId, cur),
        amt = integer(r.amountMinor, { positive: true });
      if (cur !== p.currency) throw Error("refund_currency_mismatch");
      const next = allocatedAmount + BigInt(amt);
      if (next > BigInt(p.amount)) throw Error("refund_exceeds_purchase");
      let fx;
      if (
        cur === "RSD" ||
        (p.fx.rsd !== null && p.fx.rate !== null && !p.fx.inconsistent)
      ) {
        if (r.exchangeRate != null && rate(r.exchangeRate) !== p.fx.rate)
          throw Error("refund_fx_mismatch");
        if (
          r.exchangeRateSource != null &&
          r.exchangeRateSource !== p.fx.source
        )
          throw Error("refund_fx_mismatch");
        const rsd =
          cur === "RSD"
            ? amt
            : (
                convertAtRate(next, p.fx.rate) -
                convertAtRate(allocatedAmount, p.fx.rate)
              ).toString();
        if (
          r.rsdEquivalentMinor != null &&
          integer(r.rsdEquivalentMinor, { nonnegative: true }) !== rsd
        )
          throw Error("refund_fx_mismatch");
        fx = { rsd, rate: p.fx.rate, source: p.fx.source };
      } else {
        // Preserve source values when present; never infer a missing or inconsistent rate.
        fx = valuation(r, amt, cur);
        if (fx.inconsistent)
          problem("unresolved", "transactions", i, "inconsistent_fx");
      }
      const x = id("transactions", r.id);
      posting(x, acct, p.categoryId, "refund", r.date, amt, cur, fx, p.id);
      tables.refund_details.push({
        transaction_id: x,
        ...prefix,
        purchase_transaction_id: p.id,
        allocation_sequence: sequence,
      });
      ids.transactions.set(r.id, { id: x, type: "refund" });
      ref("transactions", r.id, "transaction_id", x);
      if (cur !== "RSD" && (fx.rsd === null || fx.rate === null))
        problem("missingFx", "transactions", i, "refund_missing_fx");
      return next;
    } catch (e) {
      problem("unresolved", "transactions", i, e.message);
      return null;
    }
  }
  for (const refunds of refundsByPurchase.values()) {
    const sequences = new Set(refunds.map(({ sequence }) => sequence));
    if (
      sequences.size !== refunds.length ||
      [...sequences].some(
        (sequence) => !Number.isSafeInteger(sequence) || sequence < 1,
      )
    ) {
      for (const { i } of refunds)
        problem("unresolved", "transactions", i, "invalid_refund_sequence");
      continue;
    }
    refunds.sort((a, b) => a.sequence - b.sequence);
    let allocatedAmount = 0n;
    for (const refund of refunds) {
      if (allocatedAmount === null) {
        problem(
          "unresolved",
          "transactions",
          refund.i,
          "unresolved_prior_refund",
        );
        continue;
      }
      allocatedAmount = importRefund(refund, allocatedAmount);
    }
  }
  records("plans").forEach((r, i) => {
    try {
      checkUnique("plans", r);
      if (!month(r.month)) throw Error("invalid_month");
      const c = category(r.categoryId, "expense"),
        limit = integer(r.limitMinor, { nonnegative: true }),
        x = id("plans", r.id);
      if (
        tables.monthly_plans.some(
          (p) => p.month === r.month && p.category_id === c.id,
        )
      )
        throw Error("duplicate_plan");
      tables.monthly_plans.push({
        id: x,
        ...prefix,
        month: r.month,
        category_id: c.id,
        limit_minor: limit,
        created_at: now,
        updated_at: now,
      });
      ref("plans", r.id, "monthly_plan_id", x);
    } catch (e) {
      problem("unresolved", "plans", i, e.message);
    }
  });
  const reserveExternalIds = new Set(
    records("reserves")
      .map((r) => r?.id)
      .filter(validId),
  );
  const reserveMovementRefs = new Set();
  records("reserves").forEach((r, i) => {
    try {
      checkUnique("reserves", r);
      if (!validText(r.name) || !Array.isArray(r.movements))
        throw Error("invalid_reserve");
      const acct = ids.accounts.get(r.accountId);
      if (!acct) throw Error("account_mismatch");
      const movements = [];
      const movementIds = new Set();
      for (const m of r.movements) {
        if (
          !m ||
          !validId(m.id) ||
          movementIds.has(m.id) ||
          reserveExternalIds.has(m.id) ||
          reserveMovementRefs.has(m.id) ||
          !date(m.date) ||
          !["allocation", "release", "spend", "reversal"].includes(m.type)
        )
          throw Error("invalid_reserve_movement");
        movementIds.add(m.id);
        const amt = BigInt(integer(m.amountMinor));
        if (
          (["allocation", "reversal"].includes(m.type) && amt <= 0n) ||
          (["release", "spend"].includes(m.type) && amt >= 0n)
        )
          throw Error("invalid_reserve_movement");
        const t = m.transactionId
          ? ids.transactions.get(m.transactionId)
          : null;
        if (
          (["spend", "reversal"].includes(m.type) &&
            (!t || t.type !== "expense" || t.accountId !== acct.id)) ||
          (["allocation", "release"].includes(m.type) && m.transactionId)
        )
          throw Error("invalid_reserve_link");
        movements.push({ m, amt, t });
      }
      const daily = new Map();
      for (const { m, amt } of movements)
        daily.set(m.date, (daily.get(m.date) ?? 0n) + amt);
      let balance = 0n;
      for (const day of [...daily.keys()].sort()) {
        balance += daily.get(day);
        if (balance < 0n || balance > MAX)
          throw Error("invalid_reserve_movement");
      }
      for (const { m } of movements) reserveMovementRefs.add(m.id);
      const x = id("reserves", r.id);
      ids.reserves.set(r.id, { id: x, currency: acct.currency });
      tables.reserves.push({
        id: x,
        ...prefix,
        account_id: acct.id,
        name: r.name.trim(),
        status: "active",
        created_at: now,
        updated_at: now,
      });
      for (const { m, amt, t } of movements) {
        tables.reserve_movements.push({
          id: hash(
            snap,
            "reserve-movement",
            snapshot.authority.reserves,
            r.id,
            m.id,
          ),
          ...prefix,
          reserve_id: x,
          account_id: acct.id,
          transaction_id: t?.id ?? null,
          type: m.type,
          movement_date: m.date,
          amount_minor: amt.toString(),
          created_at: now,
        });
        ref("reserves", m.id, "reserve_id", x, "movement");
      }
      ref("reserves", r.id, "reserve_id", x);
    } catch (e) {
      problem("unresolved", "reserves", i, e.message);
    }
  });
  return { plan: { householdId, tables }, ids, exceptions };
}
