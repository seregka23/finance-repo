import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  inspectSnapshot,
  normalizeSnapshot,
} from "./historical-trial/snapshot.mjs";

const emptyExceptions = () => ({
  unconfirmed: [],
  unmatchedTransfers: [],
  missingFx: [],
  unresolved: [],
});
function base(snapshot, inspection) {
  return {
    status: "missing-inputs",
    snapshotId:
      typeof snapshot?.snapshotId === "string" ? snapshot.snapshotId : null,
    inventory: inspection.inventory,
    missingInputs: [...inspection.missingInputs],
    expected: null,
    actual: null,
    repeat: { identical: null, first: null, second: null },
    discrepancies: [],
    exceptions: emptyExceptions(),
  };
}
const integer = (x) =>
  typeof x === "string" &&
  x.length <= 200 &&
  /^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(x);
function validateControls(snapshot, normalized, result) {
  const c = snapshot.controls;
  const seenAccount = new Set(),
    seenReserve = new Set(),
    seenMonth = new Set();
  for (const [key, map, seen] of [
    ["accountBalances", normalized.ids.accounts, seenAccount],
    ["reserveBalances", normalized.ids.reserves, seenReserve],
  ]) {
    for (const x of c[key]) {
      const match = map.get(x?.id);
      if (
        !match ||
        seen.has(x.id) ||
        x.currency !== match.currency ||
        !integer(x.balanceMinor)
      ) {
        result.missingInputs.push(`controls.${key}.invalid`);
        continue;
      }
      seen.add(x.id);
    }
    if ([...map.keys()].some((x) => !seen.has(x)))
      result.missingInputs.push(`controls.${key}.coverage`);
  }
  for (const x of c.monthly) {
    if (
      !x ||
      typeof x.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month) ||
      x.month.startsWith("0000") ||
      seenMonth.has(x.month) ||
      !integer(x.incomeRsdMinor) ||
      !integer(x.expensesRsdMinor) ||
      !Number.isSafeInteger(x.missingFxCount) ||
      x.missingFxCount < 0
    ) {
      result.missingInputs.push("controls.monthly.invalid");
      continue;
    }
    seenMonth.add(x.month);
  }
  const months = new Set(
    normalized.plan.tables.transactions.map((x) =>
      x.transaction_date.slice(0, 7),
    ),
  );
  if ([...months].some((x) => !seenMonth.has(x)))
    result.missingInputs.push("controls.monthly.coverage");
  result.missingInputs = [...new Set(result.missingInputs)];
}
const normalizeList = (rows, key) =>
  [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
function externalize(actual, ids, expectedMonths) {
  const accounts = new Map([...ids.accounts].map(([id, x]) => [x.id, id]));
  const reserves = new Map([...ids.reserves].map(([id, x]) => [x.id, id]));
  const monthly = new Map(actual.monthly.map((row) => [row.month, row]));
  for (const { month } of expectedMonths)
    if (!monthly.has(month))
      monthly.set(month, {
        month,
        incomeRsdMinor: "0",
        expensesRsdMinor: "0",
        missingFxCount: 0,
      });
  return {
    ...actual,
    accountBalances: normalizeList(
      actual.accountBalances.map((x) => ({
        ...x,
        id: accounts.get(x.id) ?? null,
      })),
      "id",
    ),
    reserveBalances: normalizeList(
      actual.reserveBalances.map((x) => ({
        ...x,
        id: reserves.get(x.id) ?? null,
      })),
      "id",
    ),
    monthly: normalizeList([...monthly.values()], "month"),
  };
}
function compare(expected, actual) {
  const discrepancies = [];
  for (const key of [
    "accounts",
    "categories",
    "transactions",
    "plans",
    "reserves",
  ])
    if (expected.counts[key] !== actual.counts[key])
      discrepancies.push({
        field: `counts.${key}`,
        expected: expected.counts[key],
        actual: actual.counts[key],
      });
  for (const key of ["accountBalances", "monthly", "reserveBalances"]) {
    const idKey = key === "monthly" ? "month" : "id",
      left = new Map(expected[key].map((x) => [x[idKey], x])),
      right = new Map(actual[key].map((x) => [x[idKey], x]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id),
        b = right.get(id);
      const fields =
        key === "monthly"
          ? ["incomeRsdMinor", "expensesRsdMinor", "missingFxCount"]
          : ["currency", "balanceMinor"];
      if (!a || !b || fields.some((f) => a[f] !== b[f]))
        discrepancies.push({
          field: key,
          id,
          expected: a ?? null,
          actual: b ?? null,
        });
    }
  }
  return discrepancies;
}
export async function runHistoricalTrial(snapshot) {
  const inspection = inspectSnapshot(snapshot),
    result = base(snapshot, inspection);
  if (!inspection.valid) return result;
  const normalized = normalizeSnapshot(snapshot);
  result.exceptions = normalized.exceptions;
  validateControls(snapshot, normalized, result);
  if (result.missingInputs.length) return result;
  result.expected = {
    counts: Object.fromEntries(
      ["accounts", "categories", "transactions", "plans", "reserves"].map(
        (x) => [x, snapshot.controls.counts[x]],
      ),
    ),
    accountBalances: normalizeList(
      snapshot.controls.accountBalances.map(
        ({ id, currency, balanceMinor }) => ({ id, currency, balanceMinor }),
      ),
      "id",
    ),
    monthly: normalizeList(
      snapshot.controls.monthly.map(
        ({ month, incomeRsdMinor, expensesRsdMinor, missingFxCount }) => ({
          month,
          incomeRsdMinor,
          expensesRsdMinor,
          missingFxCount,
        }),
      ),
      "month",
    ),
    reserveBalances: normalizeList(
      snapshot.controls.reserveBalances.map(
        ({ id, currency, balanceMinor }) => ({ id, currency, balanceMinor }),
      ),
      "id",
    ),
  };
  const { openTrialDatabase } = await import("./historical-trial/d1.mjs");
  const db = await openTrialDatabase();
  try {
    await db.importPlan(normalized.plan);
    const first = externalize(
      await db.reconcile(normalized.plan.householdId),
      normalized.ids,
      result.expected.monthly,
    );
    await db.importPlan(normalized.plan);
    const second = externalize(
      await db.reconcile(normalized.plan.householdId),
      normalized.ids,
      result.expected.monthly,
    );
    const identical = JSON.stringify(first) === JSON.stringify(second);
    result.actual = second;
    result.repeat = { identical, first, second };
    result.discrepancies = compare(result.expected, second);
    if (!identical)
      result.discrepancies.push({
        field: "repeat",
        expected: "identical",
        actual: "changed",
      });
    result.status = result.discrepancies.length
      ? "discrepancies"
      : "reconciled";
    return result;
  } finally {
    await db.close();
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(JSON.stringify(await runHistoricalTrial(undefined), null, 2));
    return;
  }
  if (args.length !== 2 || args[0] !== "--snapshot") {
    console.error(
      JSON.stringify({
        error: {
          code: "INVALID_ARGUMENT",
          message: "Use --snapshot with a local JSON file",
        },
      }),
    );
    process.exitCode = 2;
    return;
  }
  try {
    const info = await stat(args[1]);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw Error("input");
    const snapshot = JSON.parse(await readFile(args[1], "utf8"));
    console.log(JSON.stringify(await runHistoricalTrial(snapshot), null, 2));
  } catch {
    console.error(
      JSON.stringify({
        error: {
          code: "TRIAL_FAILED",
          message:
            "Snapshot could not be validated or imported into the disposable local trial database",
        },
      }),
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
