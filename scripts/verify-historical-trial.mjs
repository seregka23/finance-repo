import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runHistoricalTrial } from "./historical-trial.mjs";
import { openTrialDatabase } from "./historical-trial/d1.mjs";
import { normalizeSnapshot } from "./historical-trial/snapshot.mjs";

const snapshot = JSON.parse(
  await readFile(
    new URL("./historical-trial/fixtures/synthetic.json", import.meta.url),
    "utf8",
  ),
);
const noInput = await runHistoricalTrial();
assert.equal(noInput.status, "missing-inputs");
assert.ok(noInput.missingInputs.length > 0);

const incomplete = structuredClone(snapshot);
delete incomplete.datasets.supabase.transactions;
let report = await runHistoricalTrial(incomplete);
assert.equal(report.status, "missing-inputs");
assert.equal(report.inventory.supabase.transactions, null);
assert.ok(report.missingInputs.length > 0);
const withoutControls = structuredClone(snapshot);
delete withoutControls.controls;
report = await runHistoricalTrial(withoutControls);
assert.equal(report.status, "missing-inputs");
assert.ok(report.missingInputs.length > 0);
console.log("PASS missing approved coverage produces an input list");

report = await runHistoricalTrial(snapshot);
assert.equal(report.status, "reconciled", JSON.stringify(report.discrepancies));
assert.equal(report.inventory.supabase.accounts, 1);
assert.equal(report.inventory.notion.accounts, 2);
assert.equal(report.repeat.identical, true);
assert.deepEqual(report.repeat.first, report.repeat.second);
for (const [key, value] of Object.entries(snapshot.controls.counts)) {
  assert.equal(report.actual.counts[key], value, key);
}
assert.equal(report.actual.counts.accountMovements, 11);
assert.equal(report.actual.counts.reserveMovements, 3);
assert.ok(report.actual.counts.importReferences >= 16);
const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(
  byId(report.actual.accountBalances),
  byId(snapshot.controls.accountBalances),
);
assert.deepEqual(report.actual.monthly, snapshot.controls.monthly);
assert.deepEqual(
  report.actual.reserveBalances,
  snapshot.controls.reserveBalances,
);
assert.deepEqual(
  Object.fromEntries(
    Object.entries(report.exceptions).map(([key, entries]) => [
      key,
      entries.length,
    ]),
  ),
  { unconfirmed: 1, unmatchedTransfers: 1, missingFx: 1, unresolved: 0 },
);
assert.deepEqual(report.discrepancies, []);
console.log(
  "PASS both imports match independent controls and identify exceptions",
);

const { plan } = normalizeSnapshot(snapshot);
const references = new Map(
  plan.tables.import_references.map((ref) => [ref.source_record_id, ref]),
);
const transferId = references.get("fx-transfer").transaction_id;
const feeId = references.get("bank-transfer-fee").transaction_id;
assert.equal(references.get("bank-transfer-debit").transaction_id, transferId);
assert.equal(references.get("bank-transfer-credit").transaction_id, transferId);
assert.equal(
  plan.tables.transfer_details.find((row) => row.transaction_id === transferId)
    .fee_transaction_id,
  feeId,
);
assert.equal(
  plan.tables.transactions.find((row) => row.id === feeId).transaction_date,
  "2026-02-01",
);
assert.ok(
  plan.tables.account_movements.some(
    (row) =>
      row.transaction_id === transferId &&
      row.currency === "EUR" &&
      row.movement_date === "2026-01-13",
  ),
);
console.log(
  "PASS original transfer dates and parent, leg and fee references are retained",
);

const fxRounding = structuredClone(snapshot);
fxRounding.datasets.supabase.transactions.push(
  {
    id: "fx-purchase-rounding",
    type: "expense",
    status: "posted",
    date: "2026-02-14",
    accountId: "eur-account",
    categoryId: "food",
    amountMinor: "5",
    currency: "EUR",
    exchangeRate: "117.3",
    exchangeRateSource: "synthetic bank snapshot",
    rsdEquivalentMinor: "587",
  },
  {
    id: "fx-refund-rounding-remainder",
    type: "refund",
    status: "posted",
    date: "2026-01-30",
    accountId: "eur-account",
    purchaseId: "fx-purchase-rounding",
    allocationSequence: 3,
    amountMinor: "1",
    currency: "EUR",
    rsdEquivalentMinor: "118",
  },
  {
    id: "fx-refund-rounding",
    type: "refund",
    status: "posted",
    date: "2026-01-31",
    accountId: "eur-account",
    purchaseId: "fx-purchase-rounding",
    allocationSequence: 1,
    amountMinor: "4",
    currency: "EUR",
    rsdEquivalentMinor: "469",
  },
);
const normalizedFx = normalizeSnapshot(fxRounding);
assert.deepEqual(normalizedFx.exceptions.unresolved, []);
const refundId = normalizedFx.plan.tables.import_references.find(
  (row) => row.source_record_id === "fx-refund-rounding",
).transaction_id;
assert.equal(
  normalizedFx.plan.tables.posting_details.find(
    (row) => row.transaction_id === refundId,
  ).rsd_equivalent_minor,
  "469",
);
assert.equal(
  normalizedFx.plan.tables.account_movements.find(
    (row) => row.transaction_id === refundId,
  ).movement_date,
  "2026-01-31",
);
const remainderId = normalizedFx.plan.tables.import_references.find(
  (row) => row.source_record_id === "fx-refund-rounding-remainder",
).transaction_id;
assert.equal(
  normalizedFx.plan.tables.posting_details.find(
    (row) => row.transaction_id === remainderId,
  ).rsd_equivalent_minor,
  "118",
);
assert.equal(
  normalizedFx.plan.tables.refund_details.find(
    (row) => row.transaction_id === remainderId,
  ).allocation_sequence,
  3,
);
delete fxRounding.datasets.supabase.transactions.at(-2).allocationSequence;
assert.deepEqual(
  normalizeSnapshot(fxRounding).exceptions.unresolved.map(
    ({ reason }) => reason,
  ),
  ["invalid_refund_sequence", "invalid_refund_sequence"],
);
console.log(
  "PASS partial refunds keep actual dates and allocate FX in source sequence",
);

const mismatched = structuredClone(snapshot);
mismatched.controls.accountBalances[0].balanceMinor = "555899";
report = await runHistoricalTrial(mismatched);
assert.equal(report.status, "discrepancies");
assert.equal(report.repeat.identical, true);
assert.ok(report.discrepancies.length > 0);
assert.equal(
  report.actual.accountBalances.find((row) => row.id === "rsd-account")
    .balanceMinor,
  "555900",
);
console.log(
  "PASS incorrect source control is reported without changing the import",
);

const db = await openTrialDatabase();
const household = {
  id: "synthetic-replay-check",
  name: "Synthetic exact replay",
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
};
try {
  await db.importPlan({
    householdId: household.id,
    tables: { households: [household] },
  });
  await assert.rejects(
    () =>
      db.importPlan({
        householdId: household.id,
        tables: { households: [{ ...household, name: "Changed" }] },
      }),
    /Changed replay/,
  );
  await assert.rejects(() => db.reconcile(household.id), /closed/);
} finally {
  await db.close();
}
console.log(
  "PASS changed replay is rejected and its disposable database closes",
);
