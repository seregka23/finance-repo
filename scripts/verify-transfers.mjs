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
  join(root, "backend/.cloudflare/transfer-verify-"),
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
    "@nestjs/microservices": "backend/cloudflare/missing-optional-package.mjs",
    "@nestjs/microservices/microservices-module.js":
      "backend/cloudflare/missing-optional-package.mjs",
    "@nestjs/websockets/socket-module.js":
      "backend/cloudflare/missing-optional-package.mjs",
  };
  await writeFile(
    configPath,
    JSON.stringify({
      name: "finance-transfer-verification",
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
          database_name: "disposable-transfer-verification",
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
    "transfer_details",
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
    body: { name: "Transfer fixture" },
    status: 201,
  });
  const other = await api("/api/v1/households", stranger, {
    method: "POST",
    body: { name: "Other fixture" },
    status: 201,
  });
  const h = household.id,
    path = `/api/v1/households/${h}/transactions`;
  const invitation = await api(`/api/v1/households/${h}/invitations`, owner, {
    method: "POST",
    body: { email: "member@example.invalid" },
    status: 201,
  });
  await api("/api/v1/invitations/accept", member, {
    method: "POST",
    body: { token: invitation.token },
    status: 201,
  });
  const expense = await api(`/api/v1/households/${h}/categories`, owner, {
    method: "POST",
    body: { name: "Transfer fee", type: "expense" },
    status: 201,
  });
  const income = await api(`/api/v1/households/${h}/categories`, owner, {
    method: "POST",
    body: { name: "Income", type: "income" },
    status: 201,
  });
  const foreignCategory = await api(
    `/api/v1/households/${other.id}/categories`,
    stranger,
    { method: "POST", body: { name: "Foreign", type: "expense" }, status: 201 },
  );
  async function account(
    id,
    amount = "1000000",
    currency = "RSD",
    householdId = h,
  ) {
    await query(
      `INSERT INTO accounts(id,household_id,name,type,currency,designation,created_at,updated_at) VALUES (${quote(id)},${quote(householdId)},'Synthetic account','cash',${quote(currency)},'personal','2026-11-17','2026-11-17')`,
    );
    await query(
      `INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) VALUES (${quote(randomUUID())},${quote(householdId)},${quote(id)},'opening_balance','2026-01-01',${amount},${quote(currency)},'2026-11-17')`,
    );
    return id;
  }
  const src = await account("rsd-source", "100000000"),
    dst = await account("rsd-dest", "0"),
    eur = await account("eur-source", "100000000", "EUR"),
    rsd = await account("fx-dest", "0");
  const foreignAccount = await account(
    "foreign-hh",
    "1000000",
    "RSD",
    other.id,
  );
  const base = (
    from = src,
    to = dst,
    debit = "1200000",
    credit = debit,
    dc = "RSD",
    cc = dc,
    extra = {},
  ) => ({
    type: "transfer",
    transactionDate: "2026-11-17",
    fromAccountId: from,
    toAccountId: to,
    debitAmountMinor: debit,
    creditAmountMinor: credit,
    debitCurrency: dc,
    creditCurrency: cc,
    fee: null,
    merchant: null,
    note: null,
    ...extra,
  });
  const post = (input, key = randomUUID(), status = 201, session = owner) =>
    api(path, session, { method: "POST", body: input, key, status });
  const patch = (
    record,
    input,
    version = record.version,
    status = 200,
    session = owner,
  ) =>
    api(`${path}/${record.id}`, session, {
      method: "PATCH",
      body: { ...input, version },
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
  const totals = async (id) =>
    (
      await query(
        `SELECT CAST(COALESCE(SUM(CASE WHEN v.type IN ('expense','fee') THEN -v.amount_minor ELSE 0 END),0) AS TEXT) AS expense,CAST(COALESCE(SUM(CASE WHEN v.type='income' THEN v.amount_minor ELSE 0 END),0) AS TEXT) AS income FROM transaction_reporting_movements v JOIN transactions t ON t.id=v.transaction_id WHERE t.id=${quote(id)} OR t.parent_transaction_id=${quote(id)}`,
      )
    )[0];
  await check(
    "same currency transfer charges linked fee once and excludes principal from reporting",
    async () => {
      const record = await post(
        base(src, dst, "1200000", "1200000", "RSD", "RSD", {
          fee: {
            amountMinor: "10000",
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
        "fee-transfer",
      );
      assert.equal(await balance(src), "98790000");
      assert.equal(await balance(dst), "1200000");
      assert.equal(record.type, "transfer");
      assert.equal(record.fee.amountMinor, "10000");
      assert.deepEqual(await totals(record.id), {
        expense: "10000",
        income: "0",
      });
      const rows = await query(
        `SELECT t.type,CAST(m.amount_minor AS TEXT) amount FROM transactions t JOIN account_movements m ON m.transaction_id=t.id WHERE t.id=${quote(record.id)} OR t.parent_transaction_id=${quote(record.id)} ORDER BY t.type`,
      );
      assert.deepEqual(rows, [
        { type: "fee", amount: "-10000" },
        { type: "transfer", amount: "-1200000" },
        { type: "transfer", amount: "1200000" },
      ]);
      const fee = await api(`${path}/${record.fee.id}`, owner);
      assert.equal(fee.type, "fee");
      assert.equal(fee.parentTransactionId, record.id);
      await api(`${path}/${record.fee.id}/void`, owner, {
        method: "POST",
        body: { version: 1 },
        status: 409,
      });
    },
  );
  await check(
    "FX principal keeps actual amounts and reports zero income and expense",
    async () => {
      const record = await post(
        base(eur, rsd, "65000", "7800000", "EUR", "RSD"),
        "actual-fx",
      );
      assert.equal(await balance(eur), "99935000");
      assert.equal(await balance(rsd), "7800000");
      assert.equal(record.debitAmountMinor, "65000");
      assert.equal(record.creditAmountMinor, "7800000");
      assert.deepEqual(await totals(record.id), { expense: "0", income: "0" });
      assert.equal(
        (
          await post(
            base(eur, rsd, "65000", "7800000", "EUR", "RSD"),
            "actual-fx",
          )
        ).id,
        record.id,
      );
    },
  );
  await check(
    "invalid amounts, account and category eligibility leave no writes",
    async () => {
      const before = await counts();
      for (const input of [
        base(src, dst, "0"),
        base(src, dst, "01"),
        base(src, dst, "9007199254740992"),
        base(src, src),
        base(src, dst, "1200000", "11000"),
      ])
        await post(input, randomUUID(), 400);
      await post(
        base(src, dst, "1200000", "1200000", "RSD", "RSD", {
          fee: {
            amountMinor: "1",
            categoryId: income.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
        randomUUID(),
        409,
      );
      await post(
        base(src, dst, "1200000", "1200000", "RSD", "RSD", {
          fee: {
            amountMinor: "1",
            categoryId: foreignCategory.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
        randomUUID(),
        409,
      );
      await post(base(foreignAccount, dst), randomUUID(), 409);
      await post(
        base(src, dst, "1200000", "1200000", "USD", "USD"),
        randomUUID(),
        409,
      );
      await post(
        base(src, dst, "1200000", "1200000", "EUR", "RSD"),
        randomUUID(),
        409,
      );
      assert.deepEqual(await counts(), before);
      const beforeConflict = await counts();
      await post(
        base(src, dst, "1200000", "11000", "RSD", "RSD"),
        randomUUID(),
        400,
      );
      assert.deepEqual(await counts(), beforeConflict);
    },
  );
  await check(
    "cross type key namespace, idempotency replay snapshot and changed payload conflict",
    async () => {
      const rec = await post(base(src, dst, "5000"), "unified-key");
      assert.deepEqual(await post(base(src, dst, "5000"), "unified-key"), rec);
      await post(
        {
          type: "expense",
          transactionDate: "2026-11-17",
          accountId: src,
          categoryId: expense.id,
          amountMinor: "1",
          currency: "RSD",
          exchangeRate: null,
          exchangeRateSource: null,
          merchant: null,
          note: null,
        },
        "unified-key",
        409,
      );
      const edited = await patch(rec, base(src, dst, "6000"));
      assert.equal(edited.version, 2);
      assert.deepEqual(await post(base(src, dst, "5000"), "unified-key"), rec);
      await voidRecord(edited);
      assert.deepEqual(await post(base(src, dst, "5000"), "unified-key"), rec);
    },
  );
  await check(
    "fee add, remove, edit and stale version update atomically",
    async () => {
      const rec = await post(base(src, dst, "3000"));
      const withFee = await patch(
        rec,
        base(src, dst, "3000", "3000", "RSD", "RSD", {
          fee: {
            amountMinor: "10",
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
      );
      assert.ok(withFee.fee?.id);
      assert.equal(await balance(src), "98786990");
      const changed = await patch(
        withFee,
        base(src, dst, "4000", "4000", "RSD", "RSD", {
          fee: {
            amountMinor: "20",
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
      );
      assert.equal(changed.fee.id, withFee.fee.id);
      assert.equal(changed.version, 3);
      await patch(withFee, base(src, dst, "3000"), 2, 409);
      const removed = await patch(changed, base(src, dst, "4000"));
      assert.equal(removed.fee, null);
      assert.equal(await balance(src), "98786000");
      await voidRecord(removed);
      assert.equal(await balance(src), "98790000");
    },
  );
  await check(
    "late audit and ignored movement failures roll back all transfer state and allow retry",
    async () => {
      const failures = [
        {
          name: "audit",
          sql: "CREATE TRIGGER fixture_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
        },
        {
          name: "second-leg",
          sql: `CREATE TRIGGER fixture_failure BEFORE INSERT ON account_movements WHEN NEW.account_id=${quote(dst)} AND NEW.type='transaction' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END`,
        },
        {
          name: "fee-child",
          sql: "CREATE TRIGGER fixture_failure BEFORE INSERT ON transactions WHEN NEW.type='fee' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
        },
        {
          name: "idempotency-key",
          sql: "CREATE TRIGGER fixture_failure BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
        },
        {
          name: "response-snapshot",
          sql: "CREATE TRIGGER fixture_failure BEFORE UPDATE OF response_json ON posting_requests BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
        },
        {
          name: "ignored-movement",
          sql: "CREATE TRIGGER fixture_failure BEFORE INSERT ON account_movements BEGIN SELECT RAISE(IGNORE); END",
        },
      ];
      for (const failure of failures) {
        const before = await counts(),
          bsrc = await balance(src),
          bdst = await balance(dst);
        await query(failure.sql);
        const input = base(src, dst, "2500", "2500", "RSD", "RSD", {
          fee: {
            amountMinor: "5",
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        });
        const key = `retry-${failure.name}`;
        await post(input, key, 503);
        assert.deepEqual(await counts(), before);
        assert.equal(await balance(src), bsrc);
        assert.equal(await balance(dst), bdst);
        await query("DROP TRIGGER fixture_failure");
        const success = await post(input, key);
        await voidRecord(success);
      }
    },
  );
  await check(
    "failed edit and void audit writes preserve existing transfer rows and balances",
    async () => {
      const input = (amount, feeAmount) =>
        base(src, dst, amount, amount, "RSD", "RSD", {
          fee: {
            amountMinor: feeAmount,
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        });
      const record = await post(input("5000", "100"));
      const parentBefore = await api(`${path}/${record.id}`, owner);
      const feeBefore = await api(`${path}/${record.fee.id}`, owner);
      const before = await counts(),
        bsrc = await balance(src),
        bdst = await balance(dst);
      await query(
        "CREATE TRIGGER fixture_failure BEFORE UPDATE OF details_json ON audit_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END",
      );
      await patch(record, input("6000", "200"), record.version, 503);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(src), bsrc);
      assert.equal(await balance(dst), bdst);
      assert.deepEqual(await api(`${path}/${record.id}`, owner), parentBefore);
      assert.deepEqual(await api(`${path}/${record.fee.id}`, owner), feeBefore);
      await voidRecord(record, record.version, 503);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(src), bsrc);
      assert.equal(await balance(dst), bdst);
      assert.deepEqual(await api(`${path}/${record.id}`, owner), parentBefore);
      assert.deepEqual(await api(`${path}/${record.fee.id}`, owner), feeBefore);
      await query("DROP TRIGGER fixture_failure");
    },
  );
  await check(
    "available funds include fees and reserves; destination safe integer overflow is rejected",
    async () => {
      const tight = await account("reserved-source", "1000000");
      await query(
        `INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES ('fee-reserve',${quote(h)},${quote(tight)},'Fee reserve','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,created_at) VALUES ('fee-reserve-seed',${quote(h)},'fee-reserve',${quote(tight)},'allocation','2026-01-01',900000,'2026-11-17')`,
      );
      const overflow = await account("overflow-dest", "9007199254740000");
      const before = await counts();
      await post(
        base(tight, dst, "50000", "50000", "RSD", "RSD", {
          fee: {
            amountMinor: "200000",
            categoryId: expense.id,
            exchangeRate: null,
            exchangeRateSource: null,
          },
        }),
        randomUUID(),
        409,
      );
      await post(base(src, overflow, "1000", "1000"), randomUUID(), 409);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(tight), "1000000");
      assert.equal(await balance(overflow), "9007199254740000");
    },
  );
  await check(
    "concurrent identical keys create one parent, two principal legs, one fee and one key",
    async () => {
      const before = await counts();
      const body = base(src, dst, "25000", "25000", "RSD", "RSD", {
        fee: {
          amountMinor: "500",
          categoryId: expense.id,
          exchangeRate: null,
          exchangeRateSource: null,
        },
      });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post(body, "same-transfer-race")),
      );
      for (const result of results) assert.deepEqual(result, results[0]);
      assert.deepEqual(await counts(), {
        transactions: before.transactions + 2,
        account_movements: before.account_movements + 3,
        audit_events: before.audit_events + 1,
        idempotency_keys: before.idempotency_keys + 1,
        posting_requests: before.posting_requests + 1,
        posting_details: before.posting_details + 1,
        transfer_details: before.transfer_details + 1,
      });
    },
  );
  await check(
    "Prisma detail/list scope and BigInt serialization; revoked member cannot read or post",
    async () => {
      const all = await api(path, owner);
      assert(Array.isArray(all.transactions));
      const feeParent = all.transactions.find(
        (x) => x.id && x.fee?.amountMinor === "10000",
      );
      assert(feeParent);
      const detail = await api(`${path}/${feeParent.id}`, owner);
      assert.equal(detail.fee.amountMinor, "10000");
      await api(`${path}/${feeParent.id}`, stranger, { status: 404 });
      await query(
        "UPDATE household_members SET status='revoked' WHERE identity_subject=(SELECT 'user:' || id FROM auth_users WHERE email='member@example.invalid')",
      );
      await api(path, member, { status: 404 });
      await post(base(src, dst, "1"), "revoked", 404, member);
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
    },
  );
  console.log(
    `Atomic transfer verification passed (${groups} groups; production API, native Workerd, disposable local D1).`,
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
