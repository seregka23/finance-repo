import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "finance-schema-"));
const persistence = join(temporary, "state");
const databaseId = randomUUID(); // Simulator identity, never a remote resource.
const configPath = join(temporary, "wrangler.json");
const baselineDir = join(temporary, "baseline");
const executeFile = promisify(execFile);
const env = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  NO_COLOR: "1",
  XDG_CONFIG_HOME: join(temporary, "cli"),
};
for (const key of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
])
  delete env[key];
let runtime;
let db;
let checks = 0;
const timestamp = "2026-11-16T12:00:00.000Z";
const tables = [
  "households",
  "household_members",
  "accounts",
  "categories",
  "monthly_plans",
  "transactions",
  "account_movements",
  "reserves",
  "reserve_movements",
  "audit_events",
  "import_references",
  "idempotency_keys",
  "import_drafts",
  "receipt_items",
];

async function configuration(migrationsDir) {
  await writeFile(
    configPath,
    JSON.stringify({
      name: "finance-schema-verification",
      compatibility_date: "2026-11-16",
      d1_databases: [
        {
          binding: "DB",
          database_name: "disposable-schema",
          database_id: databaseId,
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );
}
async function migrate() {
  try {
    await executeFile(
      process.execPath,
      [
        join(root, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "migrations",
        "apply",
        "DB",
        "--config",
        configPath,
        "--local",
        "--persist-to",
        persistence,
      ],
      { cwd: root, env, timeout: 60000, maxBuffer: 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(
      `Local migration failed: ${error.stdout ?? ""}\n${error.stderr ?? error.message}`,
    );
  }
}
async function open() {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        'export default { fetch() { return new Response("schema verifier"); } };',
      compatibilityDate: "2026-11-16",
      host: "127.0.0.1",
      port: 0,
      cf: false,
      d1Databases: { DB: databaseId },
      resourcePersistencePath: join(persistence, "v3"),
    }),
  );
  db = await runtime.getD1Database("DB");
}
async function close() {
  if (runtime) await runtime.dispose();
  runtime = undefined;
}
async function all(sql, ...params) {
  return (
    await db
      .prepare(sql)
      .bind(...params)
      .all()
  ).results;
}
async function run(sql, ...params) {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}
function statement(table, record) {
  assert.ok(tables.includes(table));
  const columns = Object.keys(record);
  assert.ok(columns.every((c) => /^[a-z_]+$/.test(c)));
  return db
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .bind(...Object.values(record));
}
async function insert(table, record) {
  return statement(table, record).run();
}
async function rejects(
  table,
  record,
  pattern = /FOREIGN KEY constraint failed/i,
) {
  await assert.rejects(() => insert(table, record), pattern);
}
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
const dated = { created_at: timestamp, updated_at: timestamp };
const fixtures = {};
function row(table, patch = {}) {
  const unique =
    table === "idempotency_keys"
      ? { request_key: randomUUID() }
      : table === "import_drafts"
        ? { source_hash: randomUUID() }
        : table === "import_references"
          ? { source_record_id: randomUUID() }
          : {};
  return { ...fixtures[table], ...unique, id: randomUUID(), ...patch };
}

async function seed() {
  for (const suffix of ["a", "b"]) {
    const household_id = `house-${suffix}`;
    await insert("households", {
      id: household_id,
      name: `Household ${suffix}`,
      ...dated,
    });
    await insert("household_members", {
      id: `member-${suffix}`,
      household_id,
      identity_subject: `identity-${suffix}`,
      role: "owner",
      status: "active",
      ...dated,
    });
    await insert("accounts", {
      id: `account-${suffix}`,
      household_id,
      name: "Cash",
      type: "cash",
      currency: "RSD",
      owner_member_id: `member-${suffix}`,
      designation: "personal",
      ...dated,
    });
    await insert("categories", {
      id: `category-${suffix}`,
      household_id,
      name: "Groceries",
      type: "expense",
      ...dated,
    });
    await insert("transactions", {
      id: `transaction-${suffix}`,
      household_id,
      type: "expense",
      transaction_date: "2026-11-16",
      category_id: `category-${suffix}`,
      author_member_id: `member-${suffix}`,
      ...dated,
    });
    await insert("reserves", {
      id: `reserve-${suffix}`,
      household_id,
      account_id: `account-${suffix}`,
      name: "Utilities",
      ...dated,
    });
    await insert("monthly_plans", {
      id: `plan-${suffix}`,
      household_id,
      month: "2026-11",
      category_id: `category-${suffix}`,
      limit_minor: 1000000,
      ...dated,
    });
    await insert("import_drafts", {
      id: `draft-${suffix}`,
      household_id,
      author_member_id: `member-${suffix}`,
      source_type: "receipt",
      source_hash: `hash-${suffix}`,
      extracted_fields_json: "{}",
      status: "confirmed",
      transaction_id: `transaction-${suffix}`,
      ...dated,
    });
  }
  const household_id = "house-a";
  Object.assign(fixtures, {
    household_members: {
      household_id,
      identity_subject: null,
      role: "member",
      status: "invited",
      ...dated,
    },
    accounts: {
      household_id,
      name: "Account",
      type: "bank",
      currency: "RSD",
      owner_member_id: "member-a",
      designation: "personal",
      ...dated,
    },
    monthly_plans: {
      household_id,
      month: "2026-12",
      category_id: "category-a",
      limit_minor: 1000,
      ...dated,
    },
    transactions: {
      household_id,
      type: "expense",
      transaction_date: "2026-11-16",
      category_id: "category-a",
      author_member_id: "member-a",
      ...dated,
    },
    account_movements: {
      household_id,
      account_id: "account-a",
      transaction_id: "transaction-a",
      type: "transaction",
      movement_date: "2026-11-16",
      amount_minor: -1000,
      currency: "RSD",
      rsd_equivalent_minor: -1000,
      created_at: timestamp,
    },
    reserves: {
      household_id,
      account_id: "account-a",
      name: "Reserve",
      ...dated,
    },
    reserve_movements: {
      household_id,
      reserve_id: "reserve-a",
      account_id: "account-a",
      transaction_id: "transaction-a",
      type: "spend",
      movement_date: "2026-11-16",
      amount_minor: -1000,
      created_at: timestamp,
    },
    audit_events: {
      household_id,
      actor_member_id: "member-a",
      action: "create",
      transaction_id: "transaction-a",
      details_json: "{}",
      created_at: timestamp,
    },
    import_references: {
      household_id,
      source_type: "approved_snapshot",
      source_record_id: randomUUID(),
      transaction_id: "transaction-a",
      created_at: timestamp,
    },
    idempotency_keys: {
      household_id,
      member_id: "member-a",
      request_key: randomUUID(),
      payload_hash: "payload-hash",
      transaction_id: "transaction-a",
      created_at: timestamp,
    },
    import_drafts: {
      household_id,
      author_member_id: "member-a",
      source_type: "receipt",
      source_hash: randomUUID(),
      extracted_fields_json: "{}",
      status: "pending",
      suggested_account_id: "account-a",
      suggested_category_id: "category-a",
      ...dated,
    },
    receipt_items: {
      household_id,
      import_draft_id: "draft-a",
      transaction_id: "transaction-a",
      name: "Milk ' and č",
      quantity: "1.5",
      unit_price_minor: 100,
      line_total_minor: 150,
      created_at: timestamp,
    },
  });
}

async function verify() {
  await mkdir(baselineDir);
  await copyFile(
    join(root, "backend/migrations/0001_infrastructure_probe.sql"),
    join(baselineDir, "0001_infrastructure_probe.sql"),
  );
  await configuration(baselineDir);
  await migrate();
  await open();
  const baselineHistory = await all(
    "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
  );
  await run(
    "INSERT INTO infrastructure_probe (id, value) VALUES (?, ?)",
    "pre-existing-probe",
    "preserve this existing record",
  );
  await close();
  await configuration(join(root, "backend/migrations"));
  await migrate();
  await open();
  const fullHistory = await all(
    "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
  );
  await check(
    "native migration upgrade preserves existing data and history",
    async () => {
      assert.equal(baselineHistory.length, 1);
      assert.deepEqual(fullHistory.slice(0, 1), baselineHistory);
      assert.deepEqual(
        fullHistory.map((r) => r.name),
        [
          "0001_infrastructure_probe.sql",
          "0002_household_finance_schema.sql",
          "0003_household_access.sql",
          "0004_category_eligibility.sql",
          "0005_native_auth.sql",
        ],
      );
      assert.deepEqual(
        await all(
          "SELECT value FROM infrastructure_probe WHERE id = ?",
          "pre-existing-probe",
        ),
        [{ value: "preserve this existing record" }],
      );
      for (const table of tables)
        assert.equal(
          (await all(`SELECT COUNT(*) AS count FROM ${table}`))[0].count,
          0,
          `${table} must start empty`,
        );
    },
  );
  await check(
    "all required tables and descending transaction index exist",
    async () => {
      const actual = (
        await all("SELECT name FROM sqlite_master WHERE type = 'table'")
      ).map((r) => r.name);
      for (const table of tables) assert.ok(actual.includes(table), table);
      const index = await all(
        "PRAGMA index_xinfo('transactions_household_date_id_idx')",
      );
      assert.deepEqual(
        index.filter((r) => r.key).map((r) => [r.name, r.desc]),
        [
          ["household_id", 0],
          ["transaction_date", 1],
          ["id", 1],
        ],
      );
    },
  );
  await seed();
  await check("valid records exercise every scoped table", async () => {
    for (const table of Object.keys(fixtures)) await insert(table, row(table));
    assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
  });
  await check(
    "optional owners, historical conversion data and independent movements remain supported",
    async () => {
      await insert("accounts", row("accounts", { owner_member_id: null }));
      for (const type of ["opening_balance", "adjustment"]) {
        await insert(
          "account_movements",
          row("account_movements", {
            type,
            transaction_id: null,
            rsd_equivalent_minor: null,
            exchange_rate: null,
            exchange_rate_source: null,
          }),
        );
      }
      for (const type of ["allocation", "release"]) {
        await insert(
          "reserve_movements",
          row("reserve_movements", { type, transaction_id: null }),
        );
      }
      await insert(
        "receipt_items",
        row("receipt_items", {
          quantity: null,
          unit_price_minor: null,
          line_total_minor: null,
        }),
      );
      await insert(
        "audit_events",
        row("audit_events", { transaction_id: null, details_json: null }),
      );
    },
  );
  const scopeCases = [
    ["accounts", { owner_member_id: "member-b" }],
    ["monthly_plans", { category_id: "category-b" }],
    ["transactions", { category_id: "category-b" }],
    ["transactions", { author_member_id: "member-b" }],
    ["transactions", { parent_transaction_id: "transaction-b" }],
    ["account_movements", { account_id: "account-b" }],
    ["account_movements", { transaction_id: "transaction-b" }],
    ["reserves", { account_id: "account-b" }],
    ["reserve_movements", { reserve_id: "reserve-b", account_id: "account-b" }],
    ["reserve_movements", { transaction_id: "transaction-b" }],
    ["audit_events", { actor_member_id: "member-b" }],
    ["audit_events", { transaction_id: "transaction-b" }],
    ["import_references", { transaction_id: "transaction-b" }],
    ["idempotency_keys", { member_id: "member-b" }],
    ["idempotency_keys", { transaction_id: "transaction-b" }],
    ["import_drafts", { author_member_id: "member-b" }],
    ["import_drafts", { suggested_account_id: "account-b" }],
    ["import_drafts", { suggested_category_id: "category-b" }],
    ["import_drafts", { transaction_id: "transaction-b" }],
    ["receipt_items", { import_draft_id: "draft-b" }],
    ["receipt_items", { transaction_id: "transaction-b" }],
  ];
  await check(
    "cross-household ownership, authors and financial/import relationships are rejected",
    async () => {
      for (const [table, patch] of scopeCases)
        await rejects(table, row(table, patch));
    },
  );
  await check(
    "currency, reserve-account and receipt-draft transaction relationships are consistent",
    async () => {
      await rejects(
        "account_movements",
        row("account_movements", { currency: "EUR" }),
      );
      await insert("accounts", row("accounts", { id: "second-account-a" }));
      await rejects(
        "reserve_movements",
        row("reserve_movements", { account_id: "second-account-a" }),
      );
      await insert(
        "transactions",
        row("transactions", { id: "second-transaction-a" }),
      );
      await rejects(
        "receipt_items",
        row("receipt_items", { transaction_id: "second-transaction-a" }),
      );
    },
  );
  await check(
    "all typed audit/import-reference targets enforce household scope",
    async () => {
      const targets = {
        account_id: "account-b",
        category_id: "category-b",
        monthly_plan_id: "plan-b",
        transaction_id: "transaction-b",
        reserve_id: "reserve-b",
      };
      for (const table of ["audit_events", "import_references"]) {
        for (const [column, id] of Object.entries(targets))
          await rejects(
            table,
            row(table, { transaction_id: null, [column]: id }),
          );
        await rejects(
          table,
          row(table, { account_id: "account-a" }),
          /CHECK constraint failed/i,
        );
      }
      await rejects(
        "import_references",
        row("import_references", { transaction_id: null }),
        /CHECK constraint failed/i,
      );
    },
  );
  await check(
    "integer minor units, safe ranges, enums, months, versions and JSON are enforced",
    async () => {
      for (const amount of [1.5, 9007199254740992, -9007199254740992])
        await rejects(
          "account_movements",
          row("account_movements", { amount_minor: amount }),
          /CHECK constraint failed/i,
        );
      await rejects(
        "monthly_plans",
        row("monthly_plans", { limit_minor: -1 }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "monthly_plans",
        row("monthly_plans", { month: "2026-13" }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "transactions",
        row("transactions", { version: 0 }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "transactions",
        row("transactions", { status: "unknown" }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "accounts",
        row("accounts", { currency: "GBP" }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "import_drafts",
        row("import_drafts", { extracted_fields_json: "not JSON" }),
        /CHECK constraint failed/i,
      );
      await rejects(
        "audit_events",
        row("audit_events", { details_json: "{" }),
        /CHECK constraint failed/i,
      );
    },
  );
  await check(
    "decimal-string rates and exact text aggregates avoid number precision loss",
    async () => {
      for (const rate of ["NaN", "0", "-1", "1.2.3", "1e2"])
        await rejects(
          "account_movements",
          row("account_movements", { exchange_rate: rate }),
          /CHECK constraint failed/i,
        );
      await insert(
        "account_movements",
        row("account_movements", {
          exchange_rate: "117.2000",
          exchange_rate_source: "manual",
          rsd_equivalent_minor: null,
        }),
      );
      const rate = (
        await all(
          "SELECT exchange_rate, typeof(exchange_rate) AS storage FROM account_movements WHERE exchange_rate = '117.2000'",
        )
      )[0];
      assert.deepEqual(rate, { exchange_rate: "117.2000", storage: "text" });
      for (const id of ["aggregate-a", "aggregate-b"])
        await insert(
          "account_movements",
          row("account_movements", { id, amount_minor: 5000000000000000 }),
        );
      assert.equal(
        (
          await all(
            "SELECT CAST(SUM(amount_minor) AS TEXT) AS total FROM account_movements WHERE id IN ('aggregate-a','aggregate-b')",
          )
        )[0].total,
        "10000000000000000",
      );
    },
  );
  await check(
    "unique keys reject duplicate budgets, sources and idempotency while allowing separate scopes",
    async () => {
      await rejects(
        "monthly_plans",
        row("monthly_plans", { month: "2026-11" }),
        /UNIQUE constraint failed/i,
      );
      await rejects(
        "import_drafts",
        row("import_drafts", { source_hash: "hash-a" }),
        /UNIQUE constraint failed/i,
      );
      const reference = row("import_references", {
        source_record_id: "external-1",
      });
      await insert("import_references", reference);
      await rejects(
        "import_references",
        { ...reference, id: randomUUID() },
        /UNIQUE constraint failed/i,
      );
      await insert(
        "import_drafts",
        row("import_drafts", {
          source_type: "notification",
          source_hash: "hash-a",
        }),
      );
      await insert(
        "import_drafts",
        row("import_drafts", {
          household_id: "house-b",
          author_member_id: "member-b",
          suggested_account_id: null,
          suggested_category_id: null,
          source_hash: "hash-a",
        }),
      );
    },
  );
  await check(
    "simultaneous duplicates are arbitrated atomically by each required unique constraint",
    async () => {
      const cases = [
        ["monthly_plans", { month: "2027-01" }],
        ["idempotency_keys", { request_key: "concurrent-key" }],
        ["import_drafts", { source_hash: "concurrent-source" }],
      ];
      for (const [table, patch] of cases) {
        const outcomes = await Promise.allSettled([
          insert(table, row(table, patch)),
          insert(table, row(table, patch)),
        ]);
        assert.equal(
          outcomes.filter((r) => r.status === "fulfilled").length,
          1,
          table,
        );
        const failures = outcomes.filter((r) => r.status === "rejected");
        assert.equal(failures.length, 1, table);
        assert.match(String(failures[0].reason), /UNIQUE constraint failed/i);
      }
      await insert(
        "household_members",
        row("household_members", { id: "second-member-a" }),
      );
      await insert(
        "idempotency_keys",
        row("idempotency_keys", {
          member_id: "second-member-a",
          request_key: "concurrent-key",
        }),
      );
    },
  );
  await check(
    "failed batches roll back earlier writes and referenced history cannot be deleted",
    async () => {
      await assert.rejects(
        () =>
          db.batch([
            statement(
              "transactions",
              row("transactions", { id: "rolled-back-transaction" }),
            ),
            statement(
              "account_movements",
              row("account_movements", {
                id: "invalid-batch-movement",
                account_id: "account-b",
              }),
            ),
          ]),
        /FOREIGN KEY constraint failed/i,
      );
      assert.deepEqual(
        await all(
          "SELECT id FROM transactions WHERE id = ?",
          "rolled-back-transaction",
        ),
        [],
      );
      await assert.rejects(
        () => run("DELETE FROM accounts WHERE id = ?", "account-a"),
        /FOREIGN KEY constraint failed/i,
      );
      assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
    },
  );
  const beforeReplay = await all(
    "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
  );
  const countsBefore = [];
  for (const table of tables)
    countsBefore.push(
      (await all(`SELECT COUNT(*) AS count FROM ${table}`))[0].count,
    );
  await close();
  await migrate();
  await open();
  await check(
    "full migration replay preserves finance fixtures, legacy probe and all history",
    async () => {
      assert.deepEqual(
        await all("SELECT id, name, applied_at FROM d1_migrations ORDER BY id"),
        beforeReplay,
      );
      for (const [index, table] of tables.entries())
        assert.equal(
          (await all(`SELECT COUNT(*) AS count FROM ${table}`))[0].count,
          countsBefore[index],
          table,
        );
      assert.deepEqual(
        await all(
          "SELECT value FROM infrastructure_probe WHERE id = ?",
          "pre-existing-probe",
        ),
        [{ value: "preserve this existing record" }],
      );
      assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
    },
  );
  console.log(
    `Household schema verification passed (${checks} groups, ${scopeCases.length} scoped relationship rejection cases).`,
  );
}

try {
  await verify();
} finally {
  await close();
  await rm(temporary, { recursive: true, force: true });
}
