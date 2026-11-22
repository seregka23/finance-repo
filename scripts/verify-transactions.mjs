import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Keeping the fixture under backend allows Wrangler to resolve Nest dependencies.
const temporary = await mkdtemp(
  join(root, "backend/.cloudflare/posting-verify-"),
);
const configPath = join(temporary, "wrangler.json");
const persistence = join(temporary, "state");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const appOrigin = `http://127.0.0.1:${port}`;
const children = new Set();
const logs = [];
const env = {
  ...process.env,
  CI: "1",
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
let server;
let base;
let groups = 0;
const fixturePassword = "Fixture-password-2026!";
const tokens = new Map();
async function token(user) {
  if (tokens.has(user)) return tokens.get(user);
  const response = await fetch(base + "/api/v1/auth/register", {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${user}@example.invalid`,
      password: fixturePassword,
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const value = setCookie.split(";")[0].slice("finance_session=".length);
  tokens.set(user, value);
  return value;
}
function launch(args) {
  const child = spawn(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  let output = "",
    stdout = "";
  child.stdout.on("data", (d) => {
    stdout += d;
    output = (output + d).slice(-60000);
  });
  child.stderr.on("data", (d) => {
    output = (output + d).slice(-60000);
  });
  return { child, output: () => output, stdout: () => stdout };
}
function signal(child, sig) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, sig);
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}
async function stop(proc) {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode !== null)
    return;
  const done = new Promise((resolve) => proc.child.once("close", resolve));
  signal(proc.child, "SIGTERM");
  const timer = setTimeout(() => signal(proc.child, "SIGKILL"), 3000);
  await done;
  clearTimeout(timer);
}
async function command(args) {
  const proc = launch(args);
  const timer = setTimeout(() => signal(proc.child, "SIGKILL"), 60000);
  try {
    const code = await new Promise((resolve, reject) => {
      proc.child.once("error", reject);
      proc.child.once("close", resolve);
    });
    logs.push(proc.output());
    assert.equal(code, 0, proc.output());
    return proc.stdout();
  } finally {
    clearTimeout(timer);
  }
}
const common = ["--config", configPath, "--local", "--persist-to", persistence];
async function query(sql) {
  if (base) {
    const response = await fetch(base + "/_verification/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data.results;
  }
  const output = await command([
    "d1",
    "execute",
    "DB",
    ...common,
    "--command",
    sql,
    "--json",
  ]);
  return JSON.parse(output)[0].results;
}
async function check(name, fn) {
  await fn();
  groups++;
  console.log(`PASS ${name}`);
}
async function api(
  path,
  sessionToken,
  { method = "GET", body, status = 200, origin = appOrigin, key } = {},
) {
  const headers = {};
  if (key !== undefined) headers["Idempotency-Key"] = key;
  if (sessionToken) headers.Cookie = `finance_session=${sessionToken}`;
  if (!["GET", "HEAD"].includes(method) && origin !== null)
    headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const value = response.status === 204 ? undefined : await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(value)}`,
  );
  if (path.startsWith("/api/v1/"))
    assert.equal(response.headers.get("cache-control"), "no-store");
  return value;
}
function readCsv(csv) {
  const [columns, ...values] = csv
    .slice(1, -2)
    .split(/\r\n(?=(?:[^"]*"[^"]*")*[^"]*$)/u)
    .map((row) =>
      row
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/u)
        .map((cell) =>
          cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell,
        ),
    );
  return {
    columns,
    rows: values.map((row) => {
      assert.equal(row.length, columns.length);
      return Object.fromEntries(columns.map((key, index) => [key, row[index]]));
    }),
  };
}
async function prepare() {
  // SQL diagnostics exist only in this disposable local test Worker. All
  // financial requests pass through the production native-auth NestJS API.
  const fixture = `
import 'reflect-metadata';
import {env} from 'cloudflare:workers';
import worker from '../../dist/worker.js';
import {AuthService} from '../../dist/auth/auth.js';
import {PrismaService} from '../../dist/database/prisma.service.js';
import {HouseholdAccessService} from '../../dist/households/households.js';
import {PostingRepository} from '../../dist/transactions/posting.repository.js';
import {TransactionsService} from '../../dist/transactions/transactions.service.js';
const prisma=new PrismaService(env.DB);
const auth=new AuthService(env.DB,prisma);
export default {async fetch(request, bindings, context) {
  const url = new URL(request.url);
  if(url.pathname === '/_verification/sql' && request.method === 'POST') {
    const {sql} = await request.json();
    return Response.json(await env.DB.prepare(sql).all());
  }
  if(url.pathname === '/_verification/revoked-in-batch' && request.method === 'POST') {
    try {
      const value=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('finance_session='))?.slice('finance_session='.length);
      const identity=await auth.verify(value||'');
      const {householdId,body}=await request.json();
      // Model revocation after the HTTP guard's preflight. It must be checked
      // again inside the same batch that would make financial changes.
      await new HouseholdAccessService(env.DB,prisma).get(identity,householdId);
      const wrapped={prepare:sql=>env.DB.prepare(sql),batch:statements=>env.DB.batch([
        env.DB.prepare("UPDATE household_members SET status='revoked' WHERE household_id=? AND identity_subject=?").bind(householdId,identity.subject),...statements
      ])};
      const result=await new TransactionsService(new PostingRepository(wrapped,prisma)).create(identity,householdId,body,'inside-batch-revocation');
      return Response.json(result,{status:201});
    } catch(e) {return Response.json(e.getResponse?.()||{error:{code:'FIXTURE_ERROR'}},{status:e.getStatus?.()||500});}
  }
  return worker.fetch(request,bindings,context);
}};
`;
  await writeFile(join(temporary, "worker.mjs"), fixture);
  const aliases = {
    "class-validator": "backend/cloudflare/missing-optional-package.mjs",
    "class-transformer": "backend/cloudflare/missing-optional-package.mjs",
    "@nestjs/microservices": "backend/cloudflare/missing-optional-package.mjs",
    "@nestjs/microservices/microservices-module.js":
      "backend/cloudflare/missing-optional-package.mjs",
    "@nestjs/websockets/socket-module.js":
      "backend/cloudflare/missing-optional-package.mjs",
  };
  await writeFile(
    configPath,
    JSON.stringify({
      name: "finance-posting-verification",
      main: join(temporary, "worker.mjs"),
      compatibility_date: "2026-11-16",
      compatibility_flags: [
        "nodejs_compat",
        "enable_nodejs_http_server_modules",
      ],
      assets: {
        directory: join(root, "frontend/dist/frontend/browser"),
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*", "/_verification/*"],
      },
      alias: Object.fromEntries(
        Object.entries(aliases).map(([k, v]) => [k, join(root, v)]),
      ),
      d1_databases: [
        {
          binding: "DB",
          database_name: "disposable-posting-verification",
          database_id: randomUUID(),
          migrations_dir: join(root, "backend/migrations"),
        },
      ],
    }),
  );
  await command(["d1", "migrations", "apply", "DB", ...common]);
  server = launch([
    "dev",
    ...common,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
  ]);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const match = server
      .output()
      .match(/Ready on https?:\/\/127\.0\.0\.1:(\d+)/i);
    if (match) {
      base = `http://127.0.0.1:${match[1]}`;
      return;
    }
    if (server.child.exitCode !== null) throw new Error(server.output());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Worker startup timed out");
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function balance(accountId) {
  return (
    await query(
      `SELECT CAST(COALESCE(SUM(amount_minor),0) AS TEXT) AS amount FROM account_movements WHERE account_id=${quote(accountId)}`,
    )
  )[0].amount;
}
async function counts() {
  const tables = [
    "transactions",
    "account_movements",
    "audit_events",
    "idempotency_keys",
    "posting_requests",
    "posting_details",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (await query(`SELECT count(*) AS n FROM ${table}`))[0].n,
      ]),
    ),
  );
}
async function verify() {
  await prepare();
  const owner = await token("owner"),
    member = await token("member"),
    stranger = await token("stranger");
  const household = await api("/api/v1/households", owner, {
    method: "POST",
    body: { name: "Synthetic posting household" },
    status: 201,
  });
  const other = await api("/api/v1/households", stranger, {
    method: "POST",
    body: { name: "Other synthetic household" },
    status: 201,
  });
  const householdId = household.id;
  const path = `/api/v1/households/${householdId}/transactions`;
  const exportPath = path + "/export";
  async function csvExport(params = {}, session = owner) {
    const response = await fetch(
      `${base}${exportPath}?${new URLSearchParams(params)}`,
      {
        headers: { Cookie: `finance_session=${session}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    const bytes = await response.arrayBuffer();
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    assert.equal(response.status, 200, csv);
    assert.match(response.headers.get("content-type"), /^text\/csv\b/i);
    assert.match(
      response.headers.get("content-disposition"),
      /^attachment;\s*filename="?transactions\.csv"?$/i,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(csv[0], "\uFEFF");
    assert.ok(csv.endsWith("\r\n"));
    return readCsv(csv);
  }
  const invitation = await api(
    `/api/v1/households/${householdId}/invitations`,
    owner,
    { method: "POST", body: { email: "member@example.invalid" }, status: 201 },
  );
  await api("/api/v1/invitations/accept", member, {
    method: "POST",
    body: { token: invitation.token },
    status: 201,
  });
  const expense = await api(
    `/api/v1/households/${householdId}/categories`,
    owner,
    {
      method: "POST",
      body: { name: "Fixture expense", type: "expense" },
      status: 201,
    },
  );
  const income = await api(
    `/api/v1/households/${householdId}/categories`,
    owner,
    {
      method: "POST",
      body: { name: "Fixture income", type: "income" },
      status: 201,
    },
  );
  const foreignCategory = await api(
    `/api/v1/households/${other.id}/categories`,
    stranger,
    {
      method: "POST",
      body: { name: "Private category", type: "expense" },
      status: 201,
    },
  );
  async function account(
    id,
    amount = "1000000",
    currency = "RSD",
    target = householdId,
  ) {
    await query(
      `INSERT INTO accounts(id,household_id,name,type,currency,designation,created_at,updated_at) VALUES (${quote(id)},${quote(target)},'Synthetic account','cash',${quote(currency)},'personal','2026-11-17','2026-11-17')`,
    );
    await query(
      `INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) VALUES (${quote(randomUUID())},${quote(target)},${quote(id)},'opening_balance','2026-01-01',${amount},${quote(currency)},'2026-11-17')`,
    );
    return id;
  }
  const primary = await account("primary");
  const foreignAccount = await account(
    "foreign-account",
    "1000000",
    "RSD",
    other.id,
  );
  const input = (accountId = primary, amountMinor = "10000", extra = {}) => ({
    type: "expense",
    transactionDate: "2026-11-17",
    accountId,
    categoryId: expense.id,
    amountMinor,
    currency: "RSD",
    exchangeRate: null,
    exchangeRateSource: null,
    merchant: null,
    note: null,
    ...extra,
  });
  const post = (body, key = randomUUID(), status = 201, session = owner) =>
    api(path, session, { method: "POST", body, key, status });
  const patch = (
    record,
    body,
    version = record.version,
    status = 200,
    session = owner,
  ) =>
    api(`${path}/${record.id}`, session, {
      method: "PATCH",
      body: { ...body, version },
      status,
    });
  const voidRecord = (
    record,
    version = record.version,
    status = 200,
    session = owner,
  ) =>
    api(`${path}/${record.id}/void`, session, {
      method: "POST",
      body: { version },
      status,
    });
  await check(
    "strict input, session, origin and household boundaries cause no financial writes",
    async () => {
      const before = await counts();
      await api(path, null, {
        method: "POST",
        body: input(),
        key: "anonymous",
        status: 401,
      });
      await api(path, owner, {
        method: "POST",
        body: input(),
        key: "csrf",
        origin: "https://evil.invalid",
        status: 403,
      });
      await post(input(), "outsider", 404, stranger);
      await api(path, owner, { method: "POST", body: input(), status: 400 });
      for (const extra of [
        { amountMinor: "0" },
        { amountMinor: "-1" },
        { amountMinor: 10 },
        { amountMinor: "01" },
        { amountMinor: "9007199254740992" },
        { transactionDate: "2026-02-29" },
        { type: "transfer" },
        { unexpected: true },
      ])
        await post(input(primary, "10000", extra), randomUUID(), 400);
      assert.deepEqual(await counts(), before);
    },
  );
  async function totals(id) {
    return (
      await query(
        `SELECT CAST(COALESCE(SUM(CASE WHEN t.type='expense' THEN -m.amount_minor ELSE 0 END),0) AS TEXT) AS expenses,CAST(COALESCE(SUM(CASE WHEN t.type='income' THEN m.amount_minor ELSE 0 END),0) AS TEXT) AS income FROM transactions t JOIN account_movements m ON m.household_id=t.household_id AND m.transaction_id=t.id WHERE t.id=${quote(id)} AND t.status='posted'`,
      )
    )[0];
  }
  let original;
  await check(
    "concurrent normalized retries post once and conflicting key reuse is rejected",
    async () => {
      const body = input(primary, "800000", { merchant: "Fixture shop" });
      const before = await counts();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => post(body, "concurrent-key")),
      );
      original = results[0];
      assert.deepEqual(await totals(original.id), {
        expenses: "800000",
        income: "0",
      });
      for (const r of results) assert.deepEqual(r, original);
      assert.equal(await balance(primary), "200000");
      const after = await counts();
      for (const table of Object.keys(before))
        assert.equal(after[table] - before[table], 1, table);
      await post({ ...body, amountMinor: "799999" }, "concurrent-key", 409);
      assert.deepEqual(await counts(), after);
      await query(
        `UPDATE accounts SET status='archived' WHERE id=${quote(primary)}`,
      );
      assert.deepEqual(
        await post({ ...body, merchant: " Fixture shop " }, "concurrent-key"),
        original,
      );
      await query(
        `UPDATE accounts SET status='active' WHERE id=${quote(primary)}`,
      );
    },
  );
  await check(
    "versioned edit and void update balances, keep author and retain original replay snapshot",
    async () => {
      const changed = input(primary, "500000", { merchant: "Edited fixture" });
      const edited = await patch(original, changed, 1, 200, member);
      assert.equal(edited.version, 2);
      assert.deepEqual(await totals(original.id), {
        expenses: "500000",
        income: "0",
      });
      assert.equal(edited.authorMemberId, original.authorMemberId);
      assert.equal(await balance(primary), "500000");
      const before = await counts();
      await patch(original, changed, 1, 409);
      await voidRecord(original, 1, 409);
      assert.deepEqual(await counts(), before);
      const voided = await voidRecord(edited, 2, 200, member);
      assert.equal(voided.version, 3);
      assert.equal(voided.status, "void");
      assert.deepEqual(await totals(original.id), {
        expenses: "0",
        income: "0",
      });
      assert.equal(await balance(primary), "1000000");
      await voidRecord(voided, 3, 409);
      assert.deepEqual(
        await post(
          input(primary, "800000", { merchant: "Fixture shop" }),
          "concurrent-key",
        ),
        original,
      );
      assert.equal(
        (
          await query(
            `SELECT count(*) AS n FROM audit_events WHERE transaction_id=${quote(original.id)}`,
          )
        )[0].n,
        3,
      );
      assert.equal((await api(`${path}/${original.id}`, owner)).status, "void");
      assert.equal(
        (
          await query(
            `SELECT CAST(COALESCE(SUM(m.amount_minor),0) AS TEXT) AS n FROM transactions t JOIN account_movements m ON m.transaction_id=t.id AND m.household_id=t.household_id WHERE t.id=${quote(original.id)} AND t.status='posted'`,
          )
        )[0].n,
        "0",
      );
    },
  );
  await check(
    "concurrent expenses check latest available funds within their atomic batches",
    async () => {
      const id = await account("concurrent-funds");
      const before = await counts();
      const responses = await Promise.all(
        ["spend-a", "spend-b"].map((key) =>
          fetch(base + path, {
            method: "POST",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify(input(id, "800000")),
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await balance(id), "200000");
      const after = await counts();
      for (const table of Object.keys(before))
        assert.equal(after[table] - before[table], 1, table);
    },
  );
  await check(
    "invalid account/category selection and reserved funds reject without partial writes",
    async () => {
      const id = await account("reserved");
      await query(
        `INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES ('reserve',${quote(householdId)},${quote(id)},'Fixture reserve','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,created_at) VALUES ('reserve-seed',${quote(householdId)},'reserve',${quote(id)},'allocation','2026-01-01',700000,'2026-01-01')`,
      );
      const archivedSource = await account("archived-source");
      const archivedRecord = await post(input(archivedSource));
      await query(
        `UPDATE accounts SET status='archived' WHERE id=${quote(archivedSource)}`,
      );
      const before = await counts();
      for (const body of [
        input(foreignAccount),
        input(primary, "10000", { categoryId: foreignCategory.id }),
        input(primary, "10000", { categoryId: income.id }),
        input(primary, "10000", {
          currency: "USD",
          exchangeRate: "100",
          exchangeRateSource: "manual",
        }),
        input(id, "400000"),
      ])
        await post(body, randomUUID(), 409);
      await query(
        `UPDATE accounts SET status='archived' WHERE id=${quote(primary)}`,
      );
      await post(input(), randomUUID(), 409);
      await query(
        `UPDATE accounts SET status='active' WHERE id=${quote(primary)}`,
      );
      await query(
        `UPDATE categories SET status='archived' WHERE id=${quote(expense.id)}`,
      );
      await post(input(), randomUUID(), 409);
      await query(
        `UPDATE categories SET status='active' WHERE id=${quote(expense.id)}`,
      );
      await voidRecord(archivedRecord, 1, 409);
      await patch(archivedRecord, input(primary), 1, 409);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(id), "1000000");
    },
  );
  await check(
    "edits move money between accounts and income reversal cannot overdraw an account",
    async () => {
      const a = await account("edit-a"),
        b = await account("edit-b");
      const expenseRecord = await post(input(a, "300000"));
      assert.equal(await balance(a), "700000");
      const edited = await patch(expenseRecord, input(b, "400000"));
      assert.equal(await balance(a), "1000000");
      assert.equal(await balance(b), "600000");
      await voidRecord(edited);
      assert.equal(await balance(b), "1000000");
      const c = await account("income-account", "0");
      const credit = await post(
        input(c, "200000", { type: "income", categoryId: income.id }),
      );
      await post(input(c, "150000"));
      const before = await counts();
      await voidRecord(credit, 1, 409);
      await patch(
        credit,
        input(c, "100000", { type: "income", categoryId: income.id }),
        1,
        409,
      );
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(c), "50000");
    },
  );
  await check(
    "recorded FX normalizes equivalent payloads and preserves exact signed movement valuation",
    async () => {
      const id = await account("euro", "1000000", "EUR");
      const body = input(id, "3", {
        currency: "EUR",
        exchangeRate: "000.5000",
        exchangeRateSource: " manual ",
      });
      const record = await post(body, "fx-key");
      assert.equal(record.rsdEquivalentMinor, "2");
      assert.deepEqual(
        await post(
          { ...body, exchangeRate: "0.5", exchangeRateSource: "manual" },
          "fx-key",
        ),
        record,
      );
      const rows = await query(
        `SELECT CAST(amount_minor AS TEXT) AS amount,CAST(rsd_equivalent_minor AS TEXT) AS rsd FROM account_movements WHERE transaction_id=${quote(record.id)}`,
      );
      assert.deepEqual(rows, [{ amount: "-3", rsd: "-2" }]);
    },
  );
  await check(
    "errors late in creation roll back transaction, movement, audit, saved result and key",
    async () => {
      const id = await account("rollback");
      for (const table of ["audit_events", "idempotency_keys"]) {
        const before = await counts();
        await query(
          `CREATE TRIGGER fixture_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'fixture_failure'); END`,
        );
        await post(input(id, "12345"), "failed-" + table, 503);
        assert.deepEqual(await counts(), before);
        assert.equal(await balance(id), "1000000");
        await query("DROP TRIGGER fixture_failure");
        const retry = await post(input(id, "12345"), "failed-" + table);
        await voidRecord(retry);
      }
    },
  );
  await check(
    "failed edit/void audit writes restore previous version, movement and balance",
    async () => {
      const id = await account("rollback-edit");
      const record = await post(input(id, "10000"));
      const before = await counts();
      await query(
        "CREATE TRIGGER fixture_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
      );
      await patch(record, input(id, "20000"), 1, 503);
      await voidRecord(record, 1, 503);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(id), "990000");
      assert.deepEqual(await api(`${path}/${record.id}`, owner), record);
      await query("DROP TRIGGER fixture_failure");
    },
  );
  await check(
    "current-version concurrent edits allow one winner and linked records remain protected",
    async () => {
      const id = await account("edit-race");
      const record = await post(input(id, "10000"));
      const results = await Promise.all(
        ["20000", "30000"].map((amountMinor) =>
          fetch(base + path + "/" + record.id, {
            method: "PATCH",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...input(id, amountMinor), version: 1 }),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const winner = await results.find((r) => r.status === 200).json();
      assert.equal(
        await balance(id),
        (1000000n - BigInt(winner.amountMinor)).toString(),
      );
      const parent = await post(input(id, "10000"));
      await query(
        `UPDATE transactions SET parent_transaction_id=${quote(parent.id)} WHERE id=${quote(record.id)}`,
      );
      const before = await counts();
      await voidRecord(winner, winner.version, 409);
      await voidRecord(parent, parent.version, 409);
      assert.deepEqual(await counts(), before);
      await query(
        `UPDATE transactions SET parent_transaction_id=NULL WHERE id=${quote(record.id)}`,
      );
    },
  );
  await check(
    "required zero-row updates abort in SQL before any partial state commits",
    async () => {
      const id = await account("ignored-update");
      const record = await post(input(id, "10000"));
      for (const table of ["transactions", "posting_details", "audit_events"]) {
        const before = await counts();
        await query(
          `CREATE TRIGGER fixture_ignore BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
        );
        // Same fields intentionally test the write-count guard as well as
        // the final row-state assertions.
        await patch(record, input(id, "10000"), 1, 503);
        assert.deepEqual(await counts(), before);
        assert.equal(await balance(id), "990000");
        assert.deepEqual(await api(`${path}/${record.id}`, owner), record);
        await query("DROP TRIGGER fixture_ignore");
      }
    },
  );
  await check(
    "membership is rechecked inside the financial write batch after preflight",
    async () => {
      const before = await counts();
      await api("/_verification/revoked-in-batch", member, {
        method: "POST",
        body: { householdId, body: input() },
        status: 404,
      });
      assert.deepEqual(await counts(), before);
      assert.equal(
        (
          await query(
            `SELECT count(*) AS n FROM household_members WHERE household_id=${quote(householdId)} AND status='active'`,
          )
        )[0].n,
        2,
      );
    },
  );
  await check(
    "filtered pagination, literal search and validation",
    async () => {
      const a = await post(
        input(primary, "11", {
          transactionDate: "2026-10-05",
          merchant: "Market 100%_Sale",
        }),
      );
      const b = await post(
        input(primary, "12", {
          transactionDate: "2026-10-05",
          note: "MARKET 100%_sale",
        }),
      );
      await post(
        input(primary, "13", {
          transactionDate: "2026-10-05",
          merchant: "Market 100xxSale",
        }),
      );
      const params = new URLSearchParams({
        search: "100%_",
        dateFrom: "2026-10-05",
        dateTo: "2026-10-05",
        type: "expense",
        status: "posted",
        categoryId: expense.id,
        accountId: primary,
        ownerMemberId: "household",
        currency: "RSD",
        limit: "1",
      });
      const first = await api(path + "?" + params, owner);
      assert.equal(first.transactions.length, 1);
      assert(first.nextCursor);
      params.set("cursor", first.nextCursor);
      const second = await api(path + "?" + params, owner);
      assert.deepEqual(
        new Set([first.transactions[0].id, second.transactions[0].id]),
        new Set([a.id, b.id]),
      );
      assert.equal(second.nextCursor, null);
      for (const q of [
        "search=",
        "search=a&search=b",
        "dateFrom=2026-02-29",
        "dateFrom=2026-10-06&dateTo=2026-10-05",
        "type=unknown",
        "status=unknown",
        "currency=XYZ",
        "unknown=x",
        "accountId=",
      ])
        await api(path + "?" + q, owner, { status: 400 });
      await api(path + "?search=Market", stranger, { status: 404 });
      const otherPage = await api(
        `/api/v1/households/${other.id}/transactions?search=Market`,
        stranger,
      );
      assert.deepEqual(otherPage.transactions, []);
    },
  );
  await check(
    "cursor reads are scoped, bounded and stable with no duplicated transactions",
    async () => {
      const seen = new Set();
      let cursor;
      do {
        const page = await api(
          path +
            "?limit=2" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          owner,
        );
        assert(page.transactions.length <= 2);
        for (const record of page.transactions) {
          assert.equal(record.householdId, householdId);
          assert(!seen.has(record.id));
          seen.add(record.id);
        }
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(
        seen.size,
        (
          await query(
            `SELECT count(*) AS n FROM posting_details WHERE household_id=${quote(householdId)}`,
          )
        )[0].n,
      );
      await api(path + "?limit=101", owner, { status: 400 });
      await api(path + "?cursor=garbage", owner, { status: 400 });
      await api(`${path}/${original.id}`, stranger, { status: 404 });
      await api(
        `/api/v1/households/${other.id}/transactions/${original.id}`,
        stranger,
        { status: 404 },
      );
    },
  );
  await check(
    "transfer account, owner and currency filters share a leg",
    async () => {
      const memberId = (
        await query(
          `SELECT id FROM household_members WHERE household_id=${quote(householdId)} AND identity_subject=(SELECT 'user:' || id FROM auth_users WHERE email='owner@example.invalid')`,
        )
      )[0].id;
      const destination = await account("filter-eur", "100000", "EUR");
      await query(
        `UPDATE accounts SET owner_member_id=${quote(memberId)} WHERE id=${quote(destination)}`,
      );
      const transfer = await post({
        type: "transfer",
        transactionDate: "2026-09-01",
        fromAccountId: primary,
        toAccountId: destination,
        debitAmountMinor: "100",
        creditAmountMinor: "1",
        debitCurrency: "RSD",
        creditCurrency: "EUR",
        merchant: "Transfer filter",
        fee: {
          amountMinor: "1",
          categoryId: expense.id,
          exchangeRate: null,
          exchangeRateSource: null,
        },
      });
      const list = async (query) =>
        (await api(path + "?" + new URLSearchParams(query), owner))
          .transactions;
      for (const search of [undefined, "Transfer filter"]) {
        const common = { type: "transfer", ...(search ? { search } : {}) };
        assert(
          (
            await list({
              ...common,
              accountId: destination,
              ownerMemberId: memberId,
              currency: "EUR",
            })
          ).some((t) => t.id === transfer.id),
        );
        assert(
          !(
            await list({
              ...common,
              accountId: primary,
              ownerMemberId: memberId,
              currency: "EUR",
            })
          ).some((t) => t.id === transfer.id),
        );
        assert(
          !(
            await list({
              ...common,
              accountId: destination,
              ownerMemberId: "household",
              currency: "EUR",
            })
          ).some((t) => t.id === transfer.id),
        );
      }
      assert(
        (
          await list({
            type: "fee",
            accountId: primary,
            categoryId: expense.id,
          })
        ).some((t) => t.id === transfer.fee.id),
      );
      const matchedTransfer = (
        await csvExport({
          type: "transfer",
          accountId: destination,
          currency: "EUR",
          ownerMemberId: memberId,
          search: "Transfer filter",
        })
      ).rows;
      assert.deepEqual(
        matchedTransfer.map((row) => row.transaction_id),
        [transfer.id],
      );
      assert.deepEqual(
        [
          matchedTransfer[0].amount_minor,
          matchedTransfer[0].currency,
          matchedTransfer[0].received_amount_minor,
          matchedTransfer[0].received_currency,
        ],
        ["100", "RSD", "1", "EUR"],
      );
      const feeRows = (
        await csvExport({
          type: "fee",
          accountId: primary,
          categoryId: expense.id,
        })
      ).rows;
      const fee = feeRows.find((row) => row.transaction_id === transfer.fee.id);
      assert.deepEqual(
        [fee.transfer_id, fee.rsd_equivalent_minor, fee.currency],
        [transfer.id, "1", "RSD"],
      );
      assert.ok(feeRows.every((row) => row.type === "fee"));
    },
  );
  await check(
    "literal search supports the full 100-row page size",
    async () => {
      const expected = [];
      for (let index = 0; index < 101; index += 1) {
        const row = await post(
          input(primary, "1", { merchant: "Max page %_" }),
        );
        expected.push(row.id);
      }
      const params = new URLSearchParams({
        search: "Max page %_",
        limit: "100",
        type: "expense",
        accountId: primary,
        currency: "RSD",
      });
      const first = await api(path + "?" + params, owner);
      assert.equal(first.transactions.length, 100);
      assert(first.nextCursor);
      params.set("cursor", first.nextCursor);
      const last = await api(path + "?" + params, owner);
      assert.equal(last.nextCursor, null);
      assert.deepEqual(
        [...first.transactions, ...last.transactions].map((row) => row.id),
        expected.sort().reverse(),
      );
      params.delete("cursor");
      params.delete("limit");
      const exportResults = await csvExport(params);
      assert.deepEqual(
        exportResults.rows.map((row) => row.transaction_id),
        expected,
      );
    },
  );
  await check(
    "CSV download preserves text, prevents formula interpretation and rejects private exports",
    async () => {
      const special = await account("csv-eur", "100000", "EUR");
      await query(
        `UPDATE accounts SET name='+Cash, EUR' WHERE id=${quote(special)}`,
      );
      const category = await api(
        `/api/v1/households/${householdId}/categories`,
        owner,
        {
          method: "POST",
          status: 201,
          body: { name: "＠CSV test", type: "expense" },
        },
      );
      const note = 'CSV %_ test, "quoted"\r\nСреда · sreda';
      const saved = await post(
        input(special, "125", {
          categoryId: category.id,
          currency: "EUR",
          exchangeRate: "120",
          exchangeRateSource: "manual",
          merchant: "=2+3",
          note,
        }),
      );
      const filters = {
        search: "CSV %_ test",
        type: "expense",
        accountId: special,
        categoryId: category.id,
        currency: "EUR",
        status: "posted",
      };
      const { columns, rows } = await csvExport(filters, member);
      assert.deepEqual(columns, [
        "transaction_id",
        "date",
        "type",
        "status",
        "account",
        "amount_minor",
        "currency",
        "category",
        "merchant",
        "note",
        "rsd_equivalent_minor",
        "to_account",
        "received_amount_minor",
        "received_currency",
        "transfer_id",
      ]);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        transaction_id: saved.id,
        date: saved.transactionDate,
        type: "expense",
        status: "posted",
        account: "'+Cash, EUR",
        amount_minor: "125",
        currency: "EUR",
        category: "'＠CSV test",
        merchant: "'=2+3",
        note,
        rsd_equivalent_minor: "15000",
        to_account: "",
        received_amount_minor: "",
        received_currency: "",
        transfer_id: "",
      });
      assert.deepEqual(
        (await csvExport({ ...filters, search: "CSV no match" })).rows,
        [],
      );
      for (const invalid of [
        "limit=100",
        "cursor=abcd",
        "search=x&search=y",
        "dateFrom=2026-12-01&dateTo=2026-01-01",
      ]) {
        await api(`${exportPath}?${invalid}`, owner, { status: 400 });
      }
      await api(exportPath, null, { status: 401 });
      await api(exportPath, stranger, { status: 404 });
      await api(`/api/v1/households/${other.id}/transactions/export`, owner, {
        status: 404,
      });
    },
  );
  await check(
    "revoked member cannot read or write and no failed request key persists",
    async () => {
      await query(
        "UPDATE household_members SET status='revoked' WHERE identity_subject=(SELECT 'user:' || id FROM auth_users WHERE email='member@example.invalid')",
      );
      const before = await counts();
      await post(input(), "revoked-key", 404, member);
      await api(path, member, { status: 404 });
      await api(exportPath, member, { status: 404 });
      assert.deepEqual(await counts(), before);
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
    },
  );
  console.log(
    `Atomic transaction verification passed (${groups} groups; production API, native Workerd, disposable local D1).`,
  );
}
async function cleanup() {
  await Promise.all([...children].map((child) => stop({ child })));
  await rm(temporary, { recursive: true, force: true });
}
for (const [name, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
])
  process.once(name, () => {
    void cleanup().finally(() => process.exit(code));
  });
try {
  await verify();
} catch (error) {
  console.error(error.stack || error);
  if (server) console.error(server.output());
  process.exitCode = 1;
} finally {
  await cleanup();
}
