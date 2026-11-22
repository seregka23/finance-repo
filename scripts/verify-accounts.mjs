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
  join(root, "backend/.cloudflare/accounts-verify-"),
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
import {AccountsRepository} from '../../dist/accounts/accounts.repository.js';
import {AccountsService} from '../../dist/accounts/accounts.service.js';
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
      const result=await new AccountsService(new AccountsRepository(wrapped)).create(identity,householdId,body);
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
      name: "finance-accounts-verification",
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
          database_name: "disposable-accounts-verification",
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
    "accounts",
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
    body: { name: "Account verification" },
    status: 201,
  });
  const other = await api("/api/v1/households", stranger, {
    method: "POST",
    body: { name: "Private household" },
    status: 201,
  });
  const h = household.id,
    basePath = `/api/v1/households/${h}/accounts`;
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
  const members = (await api(`/api/v1/households/${h}/members`, owner)).members;
  const memberId = members.find((m) => m.email === "member@example.invalid").id;
  const otherMemberId = (
    await api(`/api/v1/households/${other.id}/members`, stranger)
  ).members[0].id;
  const category = await api(`/api/v1/households/${h}/categories`, owner, {
    method: "POST",
    body: { name: "Account test expense", type: "expense" },
    status: 201,
  });
  const input = (
    name = "Test cash",
    openingBalanceMinor = "100000",
    extra = {},
  ) => ({
    name,
    type: "cash",
    currency: "RSD",
    ownerMemberId: null,
    designation: "personal",
    openingBalanceMinor,
    openingDate: "2026-01-01",
    ...extra,
  });
  const meta = (a) => ({
    name: a.name,
    type: a.type,
    currency: a.currency,
    ownerMemberId: a.ownerMemberId,
    designation: a.designation,
  });
  const create = (body = input(), status = 201, user = owner) =>
    api(basePath, user, { method: "POST", body, status });
  const get = (a, user = owner) => api(`${basePath}/${a.id}`, user);
  const update = (a, extra = {}, status = 200, user = owner) =>
    api(`${basePath}/${a.id}`, user, {
      method: "PATCH",
      body: { ...meta(a), ...extra, version: a.version },
      status,
    });
  const adjust = (a, amountMinor, status = 201, user = owner) =>
    api(`${basePath}/${a.id}/adjustments`, user, {
      method: "POST",
      body: { amountMinor, movementDate: "2026-02-01", version: a.version },
      status,
    });
  const setStatus = (a, status, expected = 200, user = owner) =>
    api(`${basePath}/${a.id}/${status}`, user, {
      method: "POST",
      body: { version: a.version },
      status: expected,
    });
  const history = (a, query = "", user = owner) =>
    api(`${basePath}/${a.id}/movements${query}`, user);
  const reservePath = `/api/v1/households/${h}/reserves`;
  const transactionPath = `/api/v1/households/${h}/transactions`;
  const createReserve = (account, name = "Utilities", status = 201) =>
    api(reservePath, owner, {
      method: "POST",
      body: { accountId: account.id, name },
      status,
    });
  const reserve = (r, user = owner) => api(`${reservePath}/${r.id}`, user);
  const reserveHistory = async (r) =>
    (await api(`${reservePath}/${r.id}/movements`, owner)).movements;
  const moveReserve = (r, type, amountMinor, status = 201) =>
    api(`${reservePath}/${r.id}/movements`, owner, {
      method: "POST",
      body: { type, amountMinor },
      status,
    });
  const fundedExpense = (a, r, amountMinor, reservedMinor) => ({
    type: "expense",
    transactionDate: "2026-02-02",
    accountId: a.id,
    categoryId: category.id,
    amountMinor,
    currency: a.currency,
    merchant: null,
    note: null,
    exchangeRate: null,
    exchangeRateSource: null,
    reserveFunding: { reserveId: r.id, amountMinor: reservedMinor },
  });
  const postTransaction = (body, status = 201, key = randomUUID()) =>
    api(transactionPath, owner, { method: "POST", body, status, key });
  const voidTransaction = (t, status = 200) =>
    api(`${transactionPath}/${t.id}/void`, owner, {
      method: "POST",
      body: { version: t.version },
      status,
    });
  async function assertBalances(a, expected) {
    const { balanceMinor, reservedMinor, availableMinor } = await get(a);
    assert.deepEqual([balanceMinor, reservedMinor, availableMinor], expected);
  }
  const postExpense = (a, amountMinor = "1000", status = 201) =>
    api(`/api/v1/households/${h}/transactions`, owner, {
      method: "POST",
      key: randomUUID(),
      status,
      body: {
        type: "expense",
        transactionDate: "2026-02-02",
        accountId: a.id,
        categoryId: category.id,
        amountMinor,
        currency: a.currency,
        exchangeRate: a.currency === "RSD" ? null : "100",
        exchangeRateSource: a.currency === "RSD" ? null : "manual",
        merchant: null,
        note: null,
      },
    });
  let first;
  await check(
    "new household creates its first account and both members see display-owned accounts",
    async () => {
      assert.deepEqual((await api(basePath, owner)).accounts, []);
      first = await create(
        input("Personal bank", "100000", {
          type: "bank",
          ownerMemberId: memberId,
        }),
      );
      assert.equal(first.version, 1);
      assert.equal(first.currencyLocked, false);
      assert.equal(first.balanceMinor, "100000");
      assert.equal(first.reservedMinor, "0");
      assert.equal(first.availableMinor, "100000");
      assert.deepEqual(await get(first, member), first);
      assert.equal((await history(first)).movements[0].type, "opening_balance");
      const capability = await api(`/api/v1/households/${h}/workspace`, owner);
      assert.equal(capability.capabilities.accounts, true);
      assert.equal(capability.counts.accounts, 1);
    },
  );
  await check(
    "opening balances and signed reconciliation affect balances without income/expense records",
    async () => {
      let a = await adjust(first, "500");
      a = await adjust(a, "-200");
      assert.equal(a.balanceMinor, "100300");
      assert.equal(a.version, 3);
      assert.equal((await history(a)).movements.length, 3);
      assert.equal(
        (
          await query(
            `SELECT count(*) AS n FROM transactions WHERE household_id=${quote(h)}`,
          )
        )[0].n,
        0,
      );
      const rows = await query(
        `SELECT type,CAST(SUM(amount_minor) AS TEXT) AS amount FROM account_movements WHERE account_id=${quote(a.id)} GROUP BY type ORDER BY type`,
      );
      assert.deepEqual(rows, [
        { type: "adjustment", amount: "300" },
        { type: "opening_balance", amount: "100000" },
      ]);
      first = a;
    },
  );
  await check(
    "unlocked currency correction propagates opening/adjustment currency atomically",
    async () => {
      first = await update(first, { currency: "EUR", name: "Corrected bank" });
      assert.equal(first.currency, "EUR");
      assert.equal(first.balanceMinor, "100300");
      assert.equal(first.currencyLocked, false);
      for (const m of (await history(first)).movements)
        assert.equal(m.currency, "EUR");
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
      first = await update(first, { currency: "RSD" });
    },
  );
  await check(
    "first transaction locks currency permanently even after void, metadata remains editable",
    async () => {
      const t = await postExpense(first, "300");
      first = await get(first);
      assert.equal(first.currencyLocked, true);
      assert.equal(first.balanceMinor, "100000");
      await update(first, { currency: "EUR" }, 409);
      await api(`/api/v1/households/${h}/transactions/${t.id}/void`, owner, {
        method: "POST",
        body: { version: t.version },
      });
      first = await get(first);
      assert.equal(first.currencyLocked, true);
      assert.equal(first.balanceMinor, "100300");
      await update(first, { currency: "USD" }, 409);
      first = await update(
        first,
        { name: "Shared bank", ownerMemberId: null, designation: "business" },
        200,
        member,
      );
      assert.equal(first.name, "Shared bank");
      assert.equal(first.ownerMemberId, null);
    },
  );
  await check(
    "archive preserves balances/history, active options exclude archived accounts and restore works",
    async () => {
      const oldHistory = await history(first),
        oldBalance = first.balanceMinor;
      first = await setStatus(first, "archive");
      assert.equal(first.status, "archived");
      assert.equal(first.balanceMinor, oldBalance);
      assert.deepEqual(await history(first), oldHistory);
      assert(
        !(await api(basePath + "?status=active", owner)).accounts.some(
          (a) => a.id === first.id,
        ),
      );
      assert(
        (await api(basePath + "?status=archived", member)).accounts.some(
          (a) => a.id === first.id,
        ),
      );
      await adjust(first, "1", 409);
      await update(first, { name: "No" }, 409);
      await postExpense(first, "1", 409);
      first = await setStatus(first, "restore");
      assert.equal(first.status, "active");
    },
  );
  await check(
    "all account types/currencies, zero openings and safe integer bounds retain exact values",
    async () => {
      for (const [i, currency] of ["RSD", "EUR", "RUB", "USD"].entries()) {
        const a = await create(
          input("Zero " + currency, "0", {
            type: ["cash", "bank", "card"][i % 3],
            currency,
          }),
        );
        assert.equal(a.balanceMinor, "0");
        assert.equal(a.currency, currency);
      }
      const max = await create(input("Maximum", "9007199254740991"));
      await adjust(max, "1", 409);
      assert.equal((await get(max)).balanceMinor, "9007199254740991");
      const reduced = await adjust(max, "-1");
      assert.equal(reduced.balanceMinor, "9007199254740990");
    },
  );
  await check(
    "unauthorized/cross-household/invalid owners and invalid input retain no state",
    async () => {
      const before = await counts();
      await api(basePath, null, { method: "POST", body: input(), status: 401 });
      await create(input(), 404, stranger);
      await create(
        input("Bad owner", "0", { ownerMemberId: otherMemberId }),
        409,
      );
      await api(`${basePath}/${first.id}`, stranger, { status: 404 });
      await api(
        `/api/v1/households/${other.id}/accounts/${first.id}/movements`,
        stranger,
        { status: 404 },
      );
      for (const extra of [
        { openingBalanceMinor: "-1" },
        { openingBalanceMinor: 1 },
        { openingBalanceMinor: "9007199254740992" },
        { openingDate: "2026-02-29" },
        { type: ["cash"] },
        { currency: "GBP" },
        { name: "" },
        { unexpected: true },
      ])
        await create(input("Invalid", "0", extra), 400);
      await api(`${basePath}/${first.id}/adjustments`, owner, {
        method: "POST",
        body: {
          amountMinor: "0",
          movementDate: "2026-02-01",
          version: first.version,
        },
        status: 400,
      });
      assert.deepEqual(await counts(), before);
    },
  );
  await check(
    "versioned concurrent reconciliation posts once and stale metadata/status versions conflict",
    async () => {
      const a = await create(input("Concurrent", "100000"));
      const responses = await Promise.all(
        [1, 2].map(() =>
          fetch(base + basePath + "/" + a.id + "/adjustments", {
            method: "POST",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              amountMinor: "-80000",
              movementDate: "2026-02-01",
              version: 1,
            }),
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await get(a)).balanceMinor, "20000");
      const before = await counts();
      await update(a, { name: "stale" }, 409);
      await setStatus(a, "archive", 409);
      assert.deepEqual(await counts(), before);
    },
  );
  await check(
    "competing adjustment/expense batches use current available funds and reserves",
    async () => {
      const a = await create(input("Balance race", "100000"));
      const txBody = {
        type: "expense",
        transactionDate: "2026-02-02",
        accountId: a.id,
        categoryId: category.id,
        amountMinor: "80000",
        currency: "RSD",
        merchant: null,
        note: null,
        exchangeRate: null,
        exchangeRateSource: null,
      };
      const headers = {
        Origin: appOrigin,
        Cookie: `finance_session=${owner}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      };
      const responses = await Promise.all([
        fetch(base + basePath + "/" + a.id + "/adjustments", {
          method: "POST",
          headers,
          body: JSON.stringify({
            amountMinor: "-80000",
            movementDate: "2026-02-01",
            version: a.version,
          }),
        }),
        fetch(base + `/api/v1/households/${h}/transactions`, {
          method: "POST",
          headers,
          body: JSON.stringify(txBody),
        }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await get(a)).balanceMinor, "20000");
      const r = await create(input("Reserved", "100000"));
      await query(
        `INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES ('reserve',${quote(h)},${quote(r.id)},'Reserve','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,created_at) VALUES ('allocation',${quote(h)},'reserve',${quote(r.id)},'allocation','2026-01-01',70000,'2026-01-01')`,
      );
      const reserved = await get(r);
      assert.equal(reserved.reservedMinor, "70000");
      assert.equal(reserved.availableMinor, "30000");
      await adjust(reserved, "-40000", 409);
      await update(reserved, { currency: "EUR" }, 409);
    },
  );
  await check(
    "currency edit racing the first transaction has one safe winner",
    async () => {
      const a = await create(input("Currency race", "100000"));
      const headers = {
        Origin: appOrigin,
        Cookie: `finance_session=${owner}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      };
      const expenseBody = {
        type: "expense",
        transactionDate: "2026-02-02",
        accountId: a.id,
        categoryId: category.id,
        amountMinor: "1000",
        currency: "RSD",
        merchant: null,
        note: null,
        exchangeRate: null,
        exchangeRateSource: null,
      };
      const responses = await Promise.all([
        fetch(base + basePath + "/" + a.id, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ ...meta(a), currency: "EUR", version: 1 }),
        }),
        fetch(base + `/api/v1/households/${h}/transactions`, {
          method: "POST",
          headers,
          body: JSON.stringify(expenseBody),
        }),
      ]);
      assert.equal(responses.filter((r) => r.status === 409).length, 1);
      assert.equal(responses.filter((r) => r.ok).length, 1);
      const saved = await get(a);
      assert.equal(saved.currencyLocked, saved.currency === "RSD");
      for (const m of (await history(saved)).movements)
        assert.equal(m.currency, saved.currency);
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
    },
  );
  await check(
    "injected failures and suppressed required writes roll back account, movement, version and audit",
    async () => {
      const a = await create(input("Rollback", "100000"));
      for (const table of ["account_movements", "audit_events"]) {
        const before = await counts();
        await query(
          `CREATE TRIGGER fixture_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'fixture_failure'); END`,
        );
        await create(input("Failed"), 503);
        await adjust(a, "1", 503);
        assert.deepEqual(await counts(), before);
        assert.deepEqual(await get(a), a);
        await query("DROP TRIGGER fixture_failure");
      }
      await query(
        "CREATE TRIGGER fixture_ignore BEFORE UPDATE ON accounts BEGIN SELECT RAISE(IGNORE); END",
      );
      const before = await counts();
      await update(a, { name: "ignored" }, 503);
      await adjust(a, "1", 503);
      await setStatus(a, "archive", 503);
      assert.deepEqual(await counts(), before);
      assert.deepEqual(await get(a), a);
      await query("DROP TRIGGER fixture_ignore");
    },
  );
  await check(
    "currency lock migration recovers voided or moved legacy transaction audit history",
    async () => {
      const legacy = [];
      for (const label of ["original", "intermediate", "final"])
        legacy.push(await create(input("Legacy " + label, "0")));
      const transactionId = randomUUID();
      const actor = members.find((m) => m.role === "owner").id;
      await query(
        `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,author_member_id,status,created_at,updated_at) VALUES (${quote(transactionId)},${quote(h)},'expense','2026-01-01',${quote(category.id)},${quote(actor)},'void','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO audit_events(id,household_id,actor_member_id,action,transaction_id,details_json,created_at) VALUES (${quote(randomUUID())},${quote(h)},${quote(actor)},'transaction.edited',${quote(transactionId)},json_object('accountId',${quote(legacy[0].id)},'before',json_object('accountId',${quote(legacy[1].id)}),'after',json_object('accountId',${quote(legacy[2].id)})),'2026-01-01')`,
      );
      const { readFile } = await import("node:fs/promises");
      const migration = await readFile(
        join(root, "backend/migrations/0007_accounts.sql"),
        "utf8",
      );
      const backfill = migration.match(
        /^UPDATE accounts SET currency_locked=1 WHERE[^\n]*;/m,
      )?.[0];
      assert.ok(
        backfill,
        "Currency-lock backfill must remain available for verification",
      );
      await query(backfill);
      for (const a of legacy) {
        const locked = await get(a);
        assert.equal(locked.currencyLocked, true);
        await update(locked, { currency: "EUR" }, 409);
      }
    },
  );
  await check(
    "reserve funding posts one expense and preserves available funds",
    async () => {
      const a = await create(input("Reserve example", "5000000"));
      const r = await createReserve(a);
      assert.equal(r.currency, "RSD");
      assert.equal(r.accountId, a.id);
      assert.equal((await reserve(r, member)).balanceMinor, "0");
      await api(`${reservePath}/${r.id}`, stranger, { status: 404 });
      await moveReserve(r, "allocation", "1500000");
      await assertBalances(a, ["5000000", "1500000", "3500000"]);
      await setStatus(await get(a), "archive", 409);
      const body = fundedExpense(a, r, "1200000", "1200000");
      const key = randomUUID();
      const t = await postTransaction(body, 201, key);
      assert.deepEqual(t.reserveFunding, body.reserveFunding);
      assert.deepEqual(await postTransaction(body, 201, key), t);
      const conflict = await postTransaction(
        fundedExpense(a, r, "1200000", "1100000"),
        409,
        key,
      );
      assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
      await assertBalances(a, ["3800000", "300000", "3500000"]);
      assert.equal((await reserve(r)).balanceMinor, "300000");
      const list = await api(`${transactionPath}?accountId=${a.id}`, owner);
      assert.deepEqual(
        list.transactions.map((row) => row.id),
        [t.id],
      );
      assert.deepEqual(
        list.transactions[0].reserveFunding,
        body.reserveFunding,
      );
      assert.deepEqual(
        (await reserveHistory(r))
          .map(({ type, amountMinor }) => [type, amountMinor])
          .sort(),
        [
          ["allocation", "1500000"],
          ["spend", "-1200000"],
        ],
      );
      await voidTransaction(t);
      await assertBalances(a, ["5000000", "1500000", "3500000"]);
      assert.equal(
        (await reserveHistory(r)).filter(
          (m) => m.type === "reversal" && m.transactionId === t.id,
        ).length,
        1,
      );
      assert.deepEqual(await postTransaction(body, 201, key), t);
    },
  );
  await check(
    "competing allocations and funded expenses use current reserves",
    async () => {
      const a = await create(input("Reserve race", "2000000"));
      const r = await createReserve(a, "Race");
      const s = await createReserve(a, "Other reserve");
      await moveReserve(r, "allocation", "1000000");
      const results = await Promise.all(
        [1, 2].map(() =>
          fetch(base + transactionPath, {
            method: "POST",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
              "Idempotency-Key": randomUUID(),
            },
            body: JSON.stringify(fundedExpense(a, r, "800000", "800000")),
          }),
        ),
      );
      assert.deepEqual(
        results.map((response) => response.status).sort(),
        [201, 409],
      );
      const rejected = await results
        .find((response) => response.status === 409)
        .json();
      assert.equal(rejected.error.code, "RESERVE_INSUFFICIENT_FUNDS");
      assert.equal(rejected.error.availableReserveMinor, "200000");
      await assertBalances(a, ["1200000", "200000", "1000000"]);
      assert.equal(
        (await reserveHistory(r)).filter((m) => m.type === "spend").length,
        1,
      );
      await moveReserve(s, "allocation", "1000000");
      await moveReserve(r, "allocation", "1", 409);
      await moveReserve(r, "release", "200001", 409);
      await assertBalances(a, ["1200000", "1200000", "0"]);
      await moveReserve(r, "release", "200000");
      await assertBalances(a, ["1200000", "1000000", "200000"]);
      await postTransaction(fundedExpense(a, s, "1000001", "700000"), 409);
      const unrelated = await create(input("Wrong account", "1000000"));
      await postTransaction(fundedExpense(unrelated, s, "1", "1"), 409);
      await assertBalances(a, ["1200000", "1000000", "200000"]);
      const a2 = await create(input("Allocation race", "100"));
      const r2 = await createReserve(a2, "First");
      const r3 = await createReserve(a2, "Second");
      const allocations = await Promise.all(
        [r2, r3].map((r) =>
          fetch(`${base}${reservePath}/${r.id}/movements`, {
            method: "POST",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ type: "allocation", amountMinor: "80" }),
          }),
        ),
      );
      assert.deepEqual(
        allocations.map((response) => response.status).sort(),
        [201, 409],
      );
      await assertBalances(a2, ["100", "80", "20"]);
    },
  );
  await check(
    "partial funding, edits and refunds preserve both ledgers",
    async () => {
      const a = await create(input("Reserve change", "200000"));
      const r = await createReserve(a);
      await moveReserve(r, "allocation", "80000");
      const body = fundedExpense(a, r, "60000", "20000");
      const t = await postTransaction(body);
      await assertBalances(a, ["140000", "60000", "80000"]);
      const updated = await api(`${transactionPath}/${t.id}`, owner, {
        method: "PATCH",
        body: {
          ...body,
          version: t.version,
          reserveFunding: { reserveId: r.id, amountMinor: "30000" },
        },
      });
      assert.equal(updated.reserveFunding.amountMinor, "30000");
      await assertBalances(a, ["140000", "50000", "90000"]);
      const [audit] = await query(
        `SELECT details_json FROM audit_events WHERE household_id=${quote(h)} AND transaction_id=${quote(t.id)} AND action='transaction.edited'`,
      );
      const { before, after } = JSON.parse(audit.details_json);
      assert.deepEqual(before.reserveFunding, body.reserveFunding);
      assert.deepEqual(after.reserveFunding, updated.reserveFunding);
      await api(`${transactionPath}/${t.id}`, owner, {
        method: "PATCH",
        body: { ...body, version: t.version },
        status: 409,
      });
      await assertBalances(a, ["140000", "50000", "90000"]);
      const refund = await postTransaction({
        type: "refund",
        transactionDate: "2026-03-01",
        purchaseTransactionId: t.id,
        accountId: a.id,
        amountMinor: "10000",
      });
      await assertBalances(a, ["150000", "50000", "100000"]);
      await voidTransaction(
        await api(`${transactionPath}/${t.id}`, owner),
        409,
      );
      await voidTransaction(refund);
      await voidTransaction(await api(`${transactionPath}/${t.id}`, owner));
      await assertBalances(a, ["200000", "80000", "120000"]);
      assert.equal((await reserve(r)).balanceMinor, "80000");
    },
  );
  await check(
    "a suppressed reserve write rolls back its entire posting",
    async () => {
      const a = await create(input("Reserve write rollback", "10000"));
      const r = await createReserve(a);
      await moveReserve(r, "allocation", "8000");
      const body = fundedExpense(a, r, "6500", "4500");
      const key = randomUUID();
      await query(
        "CREATE TRIGGER ignore_fixture_reserve_spend BEFORE INSERT ON reserve_movements WHEN NEW.type='spend' BEGIN SELECT RAISE(IGNORE); END",
      );
      try {
        await postTransaction(body, 503, key);
        await assertBalances(a, ["10000", "8000", "2000"]);
        assert.deepEqual(
          (await api(`${transactionPath}?accountId=${a.id}`, owner))
            .transactions,
          [],
        );
        assert.equal((await reserveHistory(r)).length, 1);
      } finally {
        await query("DROP TRIGGER ignore_fixture_reserve_spend");
      }
      await postTransaction(body, 201, key);
      await assertBalances(a, ["3500", "3500", "0"]);
    },
  );
  await check(
    "monthly plans use posted category spending and enforce a single limit",
    async () => {
      const path = `/api/v1/households/${h}/plans`;
      const month = "2025-08";
      const nextMonth = "2025-09";
      const a = await create(
        input("Budget account", "1500000", { openingDate: `${month}-01` }),
      );
      const reports = `/api/v1/households/${h}/reports/monthly`;
      const report = (target, filter = "") =>
        api(`${reports}?month=${target}${filter}`, member);
      const b = await create(input("Budget transfer destination", "0"));
      const travel = await api(`/api/v1/households/${h}/categories`, owner, {
        method: "POST",
        status: 201,
        body: { name: "Budget travel", type: "expense" },
      });
      const payload = { month, categoryId: travel.id, limitMinor: "1000000" };
      const defaultMonth = await api(path, owner);
      assert.equal(
        defaultMonth.month,
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Belgrade",
          year: "numeric",
          month: "2-digit",
        }).format(new Date()),
      );
      await api(`${path}?month=2025-13`, owner, { status: 400 });
      await api(path, stranger, { status: 404 });
      const results = await Promise.all(
        [1, 2].map(() =>
          fetch(base + path, {
            method: "POST",
            headers: {
              Origin: appOrigin,
              Cookie: `finance_session=${owner}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }),
        ),
      );
      assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
      const plan = await results.find(({ status }) => status === 201).json();
      const nextPlan = await api(path, owner, {
        method: "POST",
        status: 201,
        body: { ...payload, month: nextMonth, limitMinor: "0" },
      });
      await api(path, owner, {
        method: "POST",
        status: 400,
        body: { ...payload, limitMinor: "-1" },
      });
      const expense = {
        type: "expense",
        transactionDate: `${month}-03`,
        accountId: a.id,
        categoryId: travel.id,
        currency: "RSD",
        amountMinor: "200000",
        merchant: "Market 100%_",
        note: null,
        exchangeRate: null,
        exchangeRateSource: null,
      };
      const spent = await postTransaction(expense);
      async function figures(target, expected) {
        const result = await api(`${path}?month=${target}`, member);
        assert.equal(result.month, target);
        assert.equal(result.plans.length, 1);
        const {
          actualMinor,
          remainingMinor,
          overspentMinor,
          utilizationBasisPoints,
          missingFxCount,
        } = result.plans[0];
        assert.deepEqual(
          [
            actualMinor,
            remainingMinor,
            overspentMinor,
            utilizationBasisPoints,
            missingFxCount,
          ],
          expected,
        );
      }
      await figures(month, ["200000", "800000", "0", "2000", 0]);
      await figures(nextMonth, ["0", "0", "0", null, 0]);
      const salary = await api(`/api/v1/households/${h}/categories`, owner, {
        method: "POST",
        status: 201,
        body: { type: "income", name: "Report salary" },
      });
      await postTransaction({
        ...expense,
        type: "income",
        categoryId: salary.id,
        amountMinor: "50000",
        merchant: null,
      });
      const transfer = await postTransaction({
        type: "transfer",
        transactionDate: `${month}-05`,
        fromAccountId: a.id,
        toAccountId: b.id,
        debitAmountMinor: "50000",
        creditAmountMinor: "50000",
        debitCurrency: "RSD",
        creditCurrency: "RSD",
        fee: { amountMinor: "1000", categoryId: travel.id },
      });
      await figures(month, ["201000", "799000", "0", "2010", 0]);
      const withFee = await report(month);
      assert.equal(withFee.monthTransactionCount, 4);
      assert.equal(withFee.totals.incomeMinor, "50000");
      assert.equal(withFee.totals.expenseMinor, "201000");
      assert.equal(withFee.totals.netMinor, "-151000");
      assert.equal(
        withFee.byCategory.find((x) => x.categoryId === travel.id).expenseMinor,
        "201000",
      );
      assert.equal(
        withFee.balances.find((x) => x.currency === "RSD").balanceMinor,
        "1349000",
      );
      const filtered = await report(month, "&merchant=market%20100%25_");
      assert.equal(filtered.matchedTransactionCount, 1);
      assert.equal(filtered.totals.expenseMinor, "200000");
      assert.equal(
        filtered.byMerchant.find((x) => x.name === expense.merchant)
          .expenseMinor,
        "200000",
      );
      assert.deepEqual(filtered.balances, withFee.balances);
      const unmatched = await report(month, "&merchant=no-such-merchant");
      assert.equal(unmatched.monthTransactionCount, 4);
      assert.equal(unmatched.matchedTransactionCount, 0);
      assert.equal(unmatched.totals.expenseMinor, "0");
      const categoryOnly = await report(
        month,
        `&categoryId=${encodeURIComponent(travel.id)}`,
      );
      assert.equal(categoryOnly.totals.expenseMinor, "201000");
      assert.equal(categoryOnly.totals.incomeMinor, "0");
      assert.equal((await report("2024-01")).monthTransactionCount, 0);
      await api(`${reports}?month=2025-13`, owner, { status: 400 });
      await api(reports, stranger, { status: 404 });
      await voidTransaction(transfer);
      const adjusted = await api(`${transactionPath}/${spent.id}`, owner, {
        method: "PATCH",
        body: { ...expense, amountMinor: "1100000", version: spent.version },
      });
      await figures(month, ["1100000", "-100000", "100000", "11000", 0]);
      const refund = await postTransaction({
        type: "refund",
        purchaseTransactionId: spent.id,
        transactionDate: `${nextMonth}-01`,
        accountId: a.id,
        amountMinor: "10000",
      });
      await figures(month, ["1100000", "-100000", "100000", "11000", 0]);
      await figures(nextMonth, ["-10000", "10000", "0", null, 0]);
      const creditMonth = await report(nextMonth);
      assert.equal(creditMonth.totals.expenseMinor, "-10000");
      assert.equal(creditMonth.totals.netMinor, "10000");
      assert.equal(
        creditMonth.byMerchant.find((x) => x.name === expense.merchant)
          .expenseMinor,
        "-10000",
      );
      await api(`${path}/${nextPlan.id}`, owner, {
        method: "PATCH",
        body: { limitMinor: "20000" },
      });
      await figures(nextMonth, ["-10000", "30000", "0", "-5000", 0]);
      await voidTransaction(refund);
      assert(adjusted.version > spent.version);
      await voidTransaction(await api(`${transactionPath}/${spent.id}`, owner));
      await figures(month, ["0", "1000000", "0", "0", 0]);
      const foreign = await create(
        input("Historical EUR budget account", "10000", { currency: "EUR" }),
      );
      const legacy = randomUUID();
      const actor = members.find((m) => m.role === "owner").id;
      await query(
        `INSERT INTO transactions(id,household_id,type,transaction_date,category_id,author_member_id,status,created_at,updated_at) VALUES (${quote(legacy)},${quote(h)},'expense','${month}-10',${quote(travel.id)},${quote(actor)},'posted','${month}-10','${month}-10')`,
      );
      await query(
        `INSERT INTO account_movements(id,household_id,account_id,transaction_id,type,movement_date,amount_minor,currency,created_at) VALUES (${quote(randomUUID())},${quote(h)},${quote(foreign.id)},${quote(legacy)},'transaction','${month}-10',-500,'EUR','${month}-10')`,
      );
      const recorded = await postTransaction({
        ...expense,
        amountMinor: "1234",
      });
      await figures(month, ["1234", null, null, null, 1]);
      const partial = await report(month);
      assert.equal(partial.totals.expenseMinor, "1234");
      assert.equal(partial.totals.missingFxCount, 1);
      assert.equal(
        partial.totals.originalCurrencies.find((x) => x.currency === "EUR")
          .expenseMinor,
        "500",
      );
      assert.equal(
        partial.byCategory.find((x) => x.categoryId === travel.id)
          .missingFxCount,
        1,
      );
      await voidTransaction(recorded);
      await api(`${path}/${plan.id}`, owner, { method: "DELETE", status: 204 });
      assert.deepEqual((await api(`${path}?month=${month}`, owner)).plans, []);
    },
  );
  await check(
    "dashboard shares monthly aggregates and returns 15 stable recent transactions",
    async () => {
      const route = `/api/v1/households/${h}`;
      const firstRead = await api(`${route}/dashboard`, member);
      const ownAccount = await create(
        input("Recent activity cash", "2000", {
          openingDate: `${firstRead.month}-01`,
        }),
      );
      const currentDate = `${firstRead.month}-01`;
      for (let index = 0; index < 16; index++) {
        await postTransaction({
          type: "expense",
          transactionDate: currentDate,
          accountId: ownAccount.id,
          categoryId: category.id,
          currency: "RSD",
          amountMinor: "1",
          merchant: `Recent ${index}`,
        });
      }
      const fund = await createReserve(ownAccount, "Recent activity reserve");
      await moveReserve(fund, "allocation", "1000");
      const dashboard = await api(`${route}/dashboard`, member);
      const report = await api(`${route}/reports/monthly`, member);
      assert.equal(dashboard.month, report.month);
      assert.deepEqual(dashboard.totals, report.totals);
      const expected = await query(
        `SELECT id FROM transactions WHERE household_id=${quote(h)} AND status='posted' ORDER BY transaction_date DESC, id DESC LIMIT 15`,
      );
      assert.equal(dashboard.recentTransactions.length, 15);
      assert.deepEqual(
        dashboard.recentTransactions.map(({ id }) => id),
        expected.map(({ id }) => id),
      );
      assert.equal(
        dashboard.recentTransactions[0].accountName,
        ownAccount.name,
      );
      assert.equal(dashboard.recentTransactions[0].amountMinor, "1");
      const previousRsd = firstRead.balances.find((x) => x.currency === "RSD");
      const currentRsd = dashboard.balances.find((x) => x.currency === "RSD");
      assert.equal(
        BigInt(currentRsd.reservedMinor) - BigInt(previousRsd.reservedMinor),
        1000n,
      );
      assert.equal(
        BigInt(currentRsd.balanceMinor) - BigInt(previousRsd.balanceMinor),
        1984n,
      );
      for (const {
        balanceMinor,
        reservedMinor,
        availableMinor,
      } of dashboard.balances) {
        assert.equal(
          BigInt(balanceMinor) - BigInt(reservedMinor),
          BigInt(availableMinor),
        );
      }
      await api(`${route}/dashboard`, stranger, { status: 404 });
    },
  );
  await check(
    "movement cursors are bounded and live membership is rechecked inside a write batch",
    async () => {
      let a = await create(input("Pages", "0"));
      for (let n = 0; n < 4; n++) a = await adjust(a, "1");
      const seen = new Set();
      let cursor;
      do {
        const p = await history(
          a,
          "?limit=2" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        for (const m of p.movements) {
          assert(!seen.has(m.id));
          seen.add(m.id);
        }
        cursor = p.nextCursor;
      } while (cursor);
      assert.equal(seen.size, 5);
      await api(`${basePath}/${a.id}/movements?cursor=invalid`, owner, {
        status: 400,
      });
      const before = await counts();
      await api("/_verification/revoked-in-batch", member, {
        method: "POST",
        body: { householdId: h, body: input("Revoked") },
        status: 404,
      });
      assert.deepEqual(await counts(), before);
      await query(
        `UPDATE household_members SET status='revoked' WHERE id=${quote(memberId)}`,
      );
      await create(input("No access"), 404, member);
      await api(basePath, member, { status: 404 });
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
    },
  );
  console.log(
    `Accounts verification passed (${groups} groups; production API, native Workerd and disposable D1).`,
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
