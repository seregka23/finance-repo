// Disposable local D1 only. This module accepts normalized rows, never source snapshots.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tables = [
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
];
const primary = (table) =>
  ["posting_details", "transfer_details", "refund_details"].includes(table)
    ? "transaction_id"
    : "id";
const countNames = {
  accounts: "accounts",
  categories: "categories",
  transactions: "transactions",
  monthly_plans: "plans",
  reserves: "reserves",
  account_movements: "accountMovements",
  reserve_movements: "reserveMovements",
  import_references: "importReferences",
};
const safe = 9007199254740991n;

export async function openTrialDatabase() {
  const dir = await mkdtemp(join(tmpdir(), "finance-historical-trial-"));
  const persistence = join(dir, "state");
  const databaseId = randomUUID();
  let runtime,
    closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (runtime) await runtime.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  try {
    const config = join(dir, "wrangler.json");
    await writeFile(
      config,
      JSON.stringify({
        name: "isolated-historical-trial",
        compatibility_date: "2026-11-16",
        d1_databases: [
          {
            binding: "DB",
            database_name: "disposable-trial",
            database_id: databaseId,
            migrations_dir: join(root, "backend/migrations"),
          },
        ],
      }),
    );
    const env = {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      NO_COLOR: "1",
      XDG_CONFIG_HOME: join(dir, "cli"),
    };
    for (const key of [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_EMAIL",
    ])
      delete env[key];
    await promisify(execFile)(
      process.execPath,
      [
        join(root, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "migrations",
        "apply",
        "DB",
        "--config",
        config,
        "--local",
        "--persist-to",
        persistence,
      ],
      { cwd: root, env, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script:
          'export default { fetch() { return new Response("local historical trial"); } };',
        compatibilityDate: "2026-11-16",
        host: "127.0.0.1",
        port: 0,
        cf: false,
        d1Databases: { DB: databaseId },
        resourcePersistencePath: join(persistence, "v3"),
      }),
    );
    const db = await runtime.getD1Database("DB");
    const columns = new Map();
    for (const table of tables) {
      const result = await db.prepare(`PRAGMA table_info(${table})`).all();
      columns.set(table, new Map(result.results.map((c) => [c.name, c.type])));
    }
    const query = async (sql, ...args) =>
      (
        await db
          .prepare(sql)
          .bind(...args)
          .all()
      ).results;
    function checkOpen() {
      if (closed) throw new Error("Trial database is closed");
    }
    let previousImport = Promise.resolve();
    async function importPlan(plan) {
      const previous = previousImport;
      let release;
      previousImport = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        checkOpen();
        if (
          !plan ||
          typeof plan.householdId !== "string" ||
          !plan.householdId ||
          !plan.tables ||
          typeof plan.tables !== "object" ||
          Array.isArray(plan.tables)
        )
          throw new Error("Invalid trial plan");
        if (Object.keys(plan.tables).some((t) => !tables.includes(t)))
          throw new Error("Unsupported trial table");
        const statements = [],
          seen = new Set();
        for (const table of tables) {
          const rows = plan.tables[table] ?? [];
          if (!Array.isArray(rows)) throw new Error(`Invalid ${table} rows`);
          const known = columns.get(table),
            pk = primary(table);
          for (const row of rows) {
            if (
              !row ||
              Object.getPrototypeOf(row) !== Object.prototype ||
              typeof row[pk] !== "string" ||
              !row[pk]
            )
              throw new Error(`Invalid ${table} row`);
            if (
              (table === "households" ? row.id : row.household_id) !==
              plan.householdId
            )
              throw new Error("Plan household mismatch");
            const keys = Object.keys(row);
            if (keys.some((k) => !known.has(k)))
              throw new Error(`Invalid ${table} column`);
            const marker = `${table}\0${row[pk]}`;
            if (seen.has(marker))
              throw new Error(`Duplicate ${table} identifier`);
            seen.add(marker);
            for (const key of keys) {
              const v = row[key];
              if (
                v !== null &&
                typeof v !== "string" &&
                !(typeof v === "number" && Number.isSafeInteger(v))
              )
                throw new Error(`Invalid ${table} value`);
              if (v !== null && known.get(key).toUpperCase().includes("INT")) {
                const text = String(v);
                if (
                  !/^-?(0|[1-9][0-9]*)$/.test(text) ||
                  BigInt(text) < -safe ||
                  BigInt(text) > safe
                )
                  throw new Error(`Invalid ${table} integer`);
              }
            }
            // Read text for INTEGER columns, so comparisons never round in D1.
            const selection = keys
              .map((k) =>
                known.get(k).toUpperCase().includes("INT")
                  ? `CAST(${k} AS TEXT) AS ${k}`
                  : k,
              )
              .join(",");
            const existing = await query(
              `SELECT ${selection} FROM ${table} WHERE ${pk}=?`,
              row[pk],
            );
            if (existing.length) {
              for (const k of keys) {
                // Transaction movements set this derived persistent flag.
                if (table === "accounts" && k === "currency_locked") continue;
                const expected =
                  row[k] === null
                    ? null
                    : known.get(k).toUpperCase().includes("INT")
                      ? String(row[k])
                      : row[k];
                if (existing[0][k] !== expected)
                  throw new Error(`Changed replay for ${table}`);
              }
              continue;
            }
            statements.push(
              db
                .prepare(
                  `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) ON CONFLICT(${pk}) DO NOTHING`,
                )
                .bind(...keys.map((k) => row[k])),
            );
          }
        }
        if (statements.length) await db.batch(statements);
      } catch (error) {
        await close();
        throw error;
      } finally {
        release();
      }
    }
    async function reconcile(householdId) {
      checkOpen();
      try {
        if (typeof householdId !== "string" || !householdId)
          throw new Error("Invalid household ID");
        const counts = {};
        for (const [table, name] of Object.entries(countNames))
          counts[name] = (
            await query(
              `SELECT count(*) AS count FROM ${table} WHERE household_id=?`,
              householdId,
            )
          )[0].count;
        const accountRows = await query(
          "SELECT id,currency FROM accounts WHERE household_id=? ORDER BY id",
          householdId,
        );
        const accountBalances = accountRows.map((r) => ({
          ...r,
          balanceMinor: "0",
        }));
        const accountMap = new Map(accountBalances.map((r) => [r.id, r]));
        for (const r of await query(
          "SELECT account_id,CAST(amount_minor AS TEXT) AS amount FROM account_movements WHERE household_id=? ORDER BY id",
          householdId,
        )) {
          const x = accountMap.get(r.account_id);
          x.balanceMinor = (
            BigInt(x.balanceMinor) + BigInt(r.amount)
          ).toString();
        }
        const reserveRows = await query(
          "SELECT r.id,a.currency FROM reserves r JOIN accounts a ON a.household_id=r.household_id AND a.id=r.account_id WHERE r.household_id=? ORDER BY r.id",
          householdId,
        );
        const reserveBalances = reserveRows.map((r) => ({
          ...r,
          balanceMinor: "0",
        }));
        const reserveMap = new Map(reserveBalances.map((r) => [r.id, r]));
        for (const r of await query(
          "SELECT reserve_id,CAST(amount_minor AS TEXT) AS amount FROM reserve_movements WHERE household_id=? ORDER BY id",
          householdId,
        )) {
          const x = reserveMap.get(r.reserve_id);
          x.balanceMinor = (
            BigInt(x.balanceMinor) + BigInt(r.amount)
          ).toString();
        }
        const monthlyMap = new Map();
        for (const r of await query(
          "SELECT DISTINCT substr(transaction_date,1,7) AS month FROM transactions WHERE household_id=? AND status='posted' ORDER BY month",
          householdId,
        ))
          monthlyMap.set(r.month, {
            month: r.month,
            incomeRsdMinor: "0",
            expensesRsdMinor: "0",
            missingFxCount: 0,
          });
        const values = await query(
          `SELECT substr(v.transaction_date,1,7) AS month,v.type,v.currency,CAST(v.amount_minor AS TEXT) AS amount,CAST(v.rsd_equivalent_minor AS TEXT) AS rsd,am.exchange_rate AS rate FROM transaction_reporting_movements v JOIN account_movements am ON am.household_id=v.household_id AND am.id=v.movement_id WHERE v.household_id=? ORDER BY v.transaction_date,v.transaction_id,v.movement_id`,
          householdId,
        );
        for (const r of values) {
          const x = monthlyMap.get(r.month),
            missing =
              r.currency !== "RSD" && (r.rsd === null || r.rate === null);
          if (missing) x.missingFxCount++;
          const rsd =
            r.currency === "RSD"
              ? BigInt(r.amount)
              : r.rsd === null
                ? null
                : BigInt(r.rsd);
          if (rsd !== null) {
            const key =
              r.type === "income" ? "incomeRsdMinor" : "expensesRsdMinor";
            x[key] = (
              BigInt(x[key]) + (r.type === "income" ? rsd : -rsd)
            ).toString();
          }
        }
        return {
          counts,
          accountBalances,
          monthly: [...monthlyMap.values()],
          reserveBalances,
        };
      } catch (error) {
        await close();
        throw error;
      }
    }
    return { importPlan, reconcile, close };
  } catch (error) {
    await close();
    throw error;
  }
}
