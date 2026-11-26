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
  join(root, "backend/.cloudflare/refund-verify-"),
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
      name: "finance-refund-verification",
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
          database_name: "disposable-refund-verification",
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
// Every row is compared, including IDs, timestamps, claims and serialized audit
// snapshots. This deliberately detects partial writes, not merely row counts.
async function snapshot() {
  const tables = [
    "transactions",
    "accounts",
    "posting_details",
    "refund_details",
    "account_movements",
    "reserve_movements",
    "audit_events",
    "idempotency_keys",
    "posting_requests",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        await query(`SELECT * FROM ${table} ORDER BY rowid`),
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
    body: { name: "Refund fixture" },
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
  const category = async (name, type = "expense") =>
    api(`/api/v1/households/${h}/categories`, owner, {
      method: "POST",
      body: { name, type },
      status: 201,
    });
  const expense = await category("Purchases"),
    alternative = await category("Other expenses"),
    income = await category("Income", "income");
  const account = async (
    amount = "1000000",
    currency = "RSD",
    householdId = h,
  ) => {
    const id = randomUUID();
    await query(
      `INSERT INTO accounts(id,household_id,name,type,currency,designation,created_at,updated_at) VALUES(${quote(id)},${quote(householdId)},'Fixture','cash',${quote(currency)},'personal','2026-01-01','2026-01-01')`,
    );
    await query(
      `INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) VALUES(${quote(randomUUID())},${quote(householdId)},${quote(id)},'opening_balance','2026-01-01',${amount},${quote(currency)},'2026-01-01')`,
    );
    return id;
  };
  const src = await account("100000000"),
    dst = await account("1000000"),
    eur = await account("100000000", "EUR"),
    euroDst = await account("0", "EUR");
  const foreignAccount = await account("1000000", "RSD", other.id);
  const purchaseBody = (
    amount = "1000",
    accountId = src,
    currency = "RSD",
    extra = {},
  ) => ({
    type: "expense",
    transactionDate: "2026-01-15",
    accountId,
    categoryId: expense.id,
    amountMinor: amount,
    currency,
    exchangeRate: null,
    exchangeRateSource: null,
    merchant: "Shop",
    note: null,
    ...extra,
  });
  const refundBody = (
    purchase,
    amount = "100",
    accountId = dst,
    extra = {},
  ) => ({
    type: "refund",
    transactionDate: "2026-02-15",
    purchaseTransactionId: purchase.id,
    accountId,
    amountMinor: amount,
    merchant: null,
    note: null,
    ...extra,
  });
  const post = (body, key = randomUUID(), status = 201, session = owner) =>
    api(path, session, { method: "POST", body, key, status });
  const get = (record, session = owner) => api(`${path}/${record.id}`, session);
  const patch = (
    record,
    body,
    status = 200,
    session = owner,
    version = record.version,
  ) =>
    api(`${path}/${record.id}`, session, {
      method: "PATCH",
      body: { ...body, version },
      status,
    });
  const voidRecord = (record, status = 200, session = owner) =>
    api(`${path}/${record.id}/void`, session, {
      method: "POST",
      body: { version: record.version },
      status,
    });
  const unchanged = async (fn) => {
    const before = await snapshot();
    await fn();
    assert.deepEqual(await snapshot(), before);
  };
  const archive = async (table, id, status = "archived") =>
    query(`UPDATE ${table} SET status=${quote(status)} WHERE id=${quote(id)}`);
  const reporting = async (purchase) =>
    query(
      `SELECT v.transaction_id,v.transaction_date AS movement_date,v.category_id,v.type,CAST(v.amount_minor AS TEXT) amount,CAST(v.rsd_equivalent_minor AS TEXT) rsd FROM transaction_reporting_movements v JOIN transactions t ON t.id=v.transaction_id WHERE t.id=${quote(purchase.id)} OR t.parent_transaction_id=${quote(purchase.id)} ORDER BY v.transaction_date,v.transaction_id`,
    );
  const allocations = async (records) =>
    Promise.all(
      records.map(async (r) => {
        const x = await get(r);
        return [x.amountMinor, x.rsdEquivalentMinor, x.version, x.status];
      }),
    );
  const audits = async (record) =>
    (
      await query(
        `SELECT actor_member_id,action,details_json FROM audit_events WHERE transaction_id=${quote(record.id)} ORDER BY rowid`,
      )
    ).map((x) => ({ ...x, details: JSON.parse(x.details_json) }));
  let acceptance, acceptanceRefund;
  await check(
    "5000 RSD January purchase and 1000 RSD February refund preserve dates, category, balances and reserves",
    async () => {
      const source = await account("1000000"),
        credit = await account("0");
      acceptance = await post(purchaseBody("500000", source));
      await query(
        `INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES('acceptance-reserve',${quote(h)},${quote(source)},'Purchase reserve','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,transaction_id,created_at) VALUES('reserve-allocation',${quote(h)},'acceptance-reserve',${quote(source)},'allocation','2026-01-01',500000,NULL,'2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,transaction_id,created_at) VALUES('purchase-consumption',${quote(h)},'acceptance-reserve',${quote(source)},'spend','2026-01-15',-500000,${quote(acceptance.id)},'2026-01-15')`,
      );
      const reserveBefore = await query(
        "SELECT * FROM reserve_movements ORDER BY rowid",
      );
      acceptanceRefund = await post(refundBody(acceptance, "100000", credit));
      assert.equal(await balance(source), "500000");
      assert.equal(await balance(credit), "100000");
      assert.deepEqual(
        await query("SELECT * FROM reserve_movements ORDER BY rowid"),
        reserveBefore,
      );
      assert.deepEqual(await reporting(acceptance), [
        {
          transaction_id: acceptance.id,
          movement_date: "2026-01-15",
          category_id: expense.id,
          type: "expense",
          amount: "-500000",
          rsd: "-500000",
        },
        {
          transaction_id: acceptanceRefund.id,
          movement_date: "2026-02-15",
          category_id: expense.id,
          type: "refund",
          amount: "100000",
          rsd: "100000",
        },
      ]);
      const parent = await get(acceptance);
      assert.equal(parent.version, 2);
      assert.equal(parent.transactionDate, "2026-01-15");
      assert.equal(parent.amountMinor, "500000");
      assert.equal(parent.rsdEquivalentMinor, "500000");
      assert.deepEqual(
        await query(
          `SELECT substr(transaction_date,1,7) month,CAST(SUM(CASE WHEN type IN ('expense','fee','refund') THEN -amount_minor ELSE 0 END) AS TEXT) expense,CAST(SUM(CASE WHEN type='income' THEN amount_minor ELSE 0 END) AS TEXT) income FROM transaction_reporting_movements WHERE transaction_id IN (${quote(acceptance.id)},${quote(acceptanceRefund.id)}) GROUP BY month ORDER BY month`,
        ),
        [
          { month: "2026-01", expense: "500000", income: "0" },
          { month: "2026-02", expense: "-100000", income: "0" },
        ],
      );
      assert.equal(acceptanceRefund.currency, "RSD");
      assert.equal(acceptanceRefund.categoryId, expense.id);
    },
  );
  await check(
    "cumulative FX allocation 1/0/1, earlier edit/void reallocations, full audit snapshots and permanent sequences",
    async () => {
      const p = await post(
        purchaseBody("3", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "original",
        }),
      );
      const b = (n) =>
        refundBody(p, "1", euroDst, { transactionDate: `2026-0${n + 1}-15` });
      const a = await post(b(1), "fx-original"),
        c = await post(b(2)),
        d = await post(b(3));
      assert.deepEqual(await allocations([a, c, d]), [
        ["1", "1", 1, "posted"],
        ["1", "0", 1, "posted"],
        ["1", "1", 1, "posted"],
      ]);
      await unchanged(() =>
        post(refundBody(p, "1", euroDst), randomUUID(), 409),
      );
      // Increase first refund after making room; later changed siblings must bump.
      await voidRecord(d);
      const edited = await patch(a, refundBody(p, "2", euroDst), 200, member);
      assert.equal(edited.authorMemberId, a.authorMemberId);
      assert.deepEqual(await allocations([a, c, d]), [
        ["2", "1", 2, "posted"],
        ["1", "1", 2, "posted"],
        ["1", "1", 2, "void"],
      ]);
      const memberId = (
        await query(
          `SELECT id FROM household_members WHERE household_id=${quote(h)} AND identity_subject=(SELECT 'user:'||id FROM auth_users WHERE email='member@example.invalid')`,
        )
      )[0].id;
      for (const r of [a, c, p]) {
        const audit = (await audits(r)).at(-1);
        assert.equal(audit.actor_member_id, memberId);
        assert.ok(audit.details.before);
        assert.ok(audit.details.after);
        for (const key of [
          "amountMinor",
          "currency",
          "exchangeRate",
          "exchangeRateSource",
          "rsdEquivalentMinor",
          "categoryId",
          "version",
        ])
          assert.ok(
            key in audit.details.before && key in audit.details.after,
            key,
          );
      }
      await voidRecord(edited);
      assert.deepEqual(await allocations([a, c, d]), [
        ["2", "1", 3, "void"],
        ["1", "1", 2, "posted"],
        ["1", "1", 2, "void"],
      ]);
      // c stays unchanged: its allocation is 1 both before and after this void.
      const e = await post(refundBody(p, "2", euroDst));
      assert.equal(e.rsdEquivalentMinor, "1");
      const sum = (
        await query(
          `SELECT CAST(SUM(d.rsd_equivalent_minor) AS TEXT) n FROM transactions t JOIN posting_details d ON d.transaction_id=t.id WHERE t.parent_transaction_id=${quote(p.id)} AND t.status='posted'`,
        )
      )[0].n;
      assert.equal(sum, "2");
      assert.deepEqual(
        (
          await query(
            `SELECT allocation_sequence n FROM refund_details WHERE purchase_transaction_id=${quote(p.id)} ORDER BY n`,
          )
        ).map((x) => x.n),
        [1, 2, 3, 4],
      );
      assert.deepEqual(await post(b(1), "fx-original"), a);
      const p2 = await post(
        purchaseBody("3", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "original",
        }),
      );
      const f = [];
      for (let i = 0; i < 3; i++)
        f.push(
          await post(
            refundBody(p2, "1", euroDst, {
              transactionDate: `2026-0${i + 2}-01`,
            }),
          ),
        );
      await voidRecord(f[0]);
      assert.deepEqual(await allocations(f), [
        ["1", "1", 2, "void"],
        ["1", "1", 2, "posted"],
        ["1", "0", 2, "posted"],
      ]);
      assert.deepEqual(
        (await reporting(p2)).map((x) => [x.movement_date, x.rsd]),
        [
          ["2026-01-15", "-2"],
          ["2026-03-01", "1"],
          ["2026-04-01", "0"],
        ],
      );
      for (const r of [f[1], f[2]]) {
        const a = (await audits(r)).at(-1);
        assert.equal(a.details.before.version, 1);
        assert.equal(a.details.after.version, 2);
        assert.notEqual(
          a.details.before.rsdEquivalentMinor,
          a.details.after.rsdEquivalentMinor,
        );
      }
    },
  );
  await check(
    "large exact decimals and safe credit overflow reject without rounding",
    async () => {
      const big = await account("9007199254740991", "EUR"),
        credit = await account("0", "EUR");
      const p = await post(
        purchaseBody("9007199254740991", big, "EUR", {
          exchangeRate: "0.99999999999999999999999999999999999999",
          exchangeRateSource: "exact",
        }),
      );
      assert.equal(p.rsdEquivalentMinor, "9007199254740991");
      const a = await post(refundBody(p, "4503599627370495", credit));
      const b = await post(refundBody(p, "4503599627370496", credit));
      assert.equal(a.rsdEquivalentMinor, "4503599627370495");
      assert.equal(b.rsdEquivalentMinor, "4503599627370496");
      assert.equal(await balance(credit), "9007199254740991");
      const full = await account("9007199254740991");
      const parent = await post(purchaseBody("100"));
      await unchanged(() =>
        post(refundBody(parent, "1", full), randomUUID(), 409),
      );
    },
  );
  await check(
    "invalid shapes, inherited overrides, wrong sources/currencies/households and immutable links do not write",
    async () => {
      const p = await post(purchaseBody("100")),
        r = await post(refundBody(p, "10"));
      const otherPurchase = await post(purchaseBody("100"));
      const inc = await post(
        purchaseBody("100", src, "RSD", {
          type: "income",
          categoryId: income.id,
        }),
      );
      const foreignCategory = await api(
        `/api/v1/households/${other.id}/categories`,
        stranger,
        {
          method: "POST",
          body: { name: "Foreign expense", type: "expense" },
          status: 201,
        },
      );
      const foreignPurchase = await api(
        `/api/v1/households/${other.id}/transactions`,
        stranger,
        {
          method: "POST",
          body: purchaseBody("10", foreignAccount, "RSD", {
            categoryId: foreignCategory.id,
          }),
          key: randomUUID(),
          status: 201,
        },
      );
      await unchanged(async () => {
        for (const amount of [
          "0",
          "-1",
          "01",
          "1.5",
          "9007199254740992",
          1,
          null,
        ])
          await post(refundBody(p, amount), randomUUID(), 400);
        for (const extra of [
          { categoryId: expense.id },
          { currency: "RSD" },
          { exchangeRate: "1" },
          { exchangeRateSource: "manual" },
          { rsdEquivalentMinor: "1" },
        ])
          await post(refundBody(p, "1", dst, extra), randomUUID(), 400);
        await post(refundBody(foreignPurchase, "1"), randomUUID(), 409);
        await post(refundBody(r, "1"), randomUUID(), 409);
        await post(refundBody(p, "101"), randomUUID(), 409);
        await post(refundBody(inc, "1"), randomUUID(), 409);
        await post(refundBody(p, "1", eur), randomUUID(), 409);
        await post(refundBody(p, "1", foreignAccount), randomUUID(), 409);
        await post(refundBody({ id: "missing" }, "1"), randomUUID(), 409);
        await patch(r, refundBody(otherPurchase, "10"), 409);
        await api(`${path}/${r.id}`, stranger, { status: 404 });
        await post(refundBody(p), randomUUID(), 404, stranger);
        await api(
          `/api/v1/households/${other.id}/transactions/${p.id}`,
          stranger,
          { status: 404 },
        );
      });
    },
  );
  await check(
    "archived purchase account/category inherit; archived credit and missing/inconsistent conversion fail",
    async () => {
      const source = await account("10000"),
        credit = await account("0"),
        cat = await category("Historical");
      const p = await post(
        purchaseBody("1000", source, "RSD", { categoryId: cat.id }),
      );
      await archive("accounts", source);
      await archive("categories", cat.id);
      const r = await post(refundBody(p, "100", credit));
      assert.equal(r.categoryId, cat.id);
      await archive("accounts", credit);
      await unchanged(async () => {
        await post(refundBody(p, "1", credit), randomUUID(), 409);
        await patch(r, refundBody(p, "100", dst), 409);
        await voidRecord(r, 409);
      });
      const missing = await post(
        purchaseBody("10", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "legacy",
        }),
      );
      // Simulate an imported legacy snapshot, which current POST validation forbids.
      await query(
        `UPDATE posting_details SET rsd_equivalent_minor=NULL,exchange_rate=NULL,exchange_rate_source=NULL WHERE transaction_id=${quote(missing.id)}`,
      );
      await unchanged(() =>
        post(refundBody(missing, "1", euroDst), randomUUID(), 409),
      );
      const inconsistent = await post(
        purchaseBody("10", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "recorded",
        }),
      );
      await query(
        `UPDATE posting_details SET rsd_equivalent_minor=6 WHERE transaction_id=${quote(inconsistent.id)}`,
      );
      await unchanged(() =>
        post(refundBody(inconsistent, "1", euroDst), randomUUID(), 409),
      );
    },
  );
  await check(
    "purchase edits honor ceiling and protected snapshot; all voided refunds allow purchase void; replay remains original",
    async () => {
      const p = await post(purchaseBody("1000")),
        input = refundBody(p, "400");
      const r = await post(input, "long-replay");
      let current = await get(p);
      await unchanged(async () => {
        await patch(current, purchaseBody("399"), 409);
        await voidRecord(current, 409);
        for (const extra of [
          { type: "income", categoryId: income.id },
          { categoryId: alternative.id },
          {
            currency: "EUR",
            accountId: eur,
            exchangeRate: "1",
            exchangeRateSource: "manual",
          },
        ])
          await patch(current, purchaseBody("1000", src, "RSD", extra), 409);
        await patch(p, purchaseBody("1000"), 409);
      });
      const fxParent = await post(
        purchaseBody("10", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "original",
        }),
      );
      await post(refundBody(fxParent, "1", euroDst));
      const fxCurrent = await get(fxParent);
      await unchanged(async () => {
        for (const extra of [
          { exchangeRate: "0.6", exchangeRateSource: "original" },
          { exchangeRate: "0.5", exchangeRateSource: "changed" },
        ])
          await patch(fxCurrent, purchaseBody("10", eur, "EUR", extra), 409);
      });
      current = await patch(
        current,
        purchaseBody("600", src, "RSD", {
          merchant: "Corrected",
          note: "memo",
        }),
      );
      assert.equal(current.version, 3);
      assert.equal(current.amountMinor, "600");
      current = await patch(current, purchaseBody("1200"));
      assert.equal(current.amountMinor, "1200");
      current = await patch(current, purchaseBody("400"));
      assert.equal(current.amountMinor, "400");
      const edited = await patch(r, refundBody(p, "300"));
      await unchanged(() => patch(r, refundBody(p, "200"), 409));
      await voidRecord(edited);
      current = await get(p);
      await voidRecord(current);
      const historical = await get(edited);
      assert.equal(historical.status, "void");
      assert.equal(historical.amountMinor, "300");
      assert.equal(historical.purchaseTransactionId, p.id);
      assert.equal(historical.currency, "RSD");
      await archive("accounts", dst);
      assert.deepEqual(await post(input, "long-replay"), r);
      await archive("accounts", dst, "active");
      await unchanged(() => post(refundBody(p, "1"), "long-replay", 409));
      await unchanged(() => post(purchaseBody("1"), "long-replay", 409));
    },
  );
  await check(
    "refund spent or reserved credit cannot be removed; successful void preserves reserve rows",
    async () => {
      const p = await post(purchaseBody("1000")),
        credit = await account("0");
      const r = await post(refundBody(p, "100", credit));
      const spent = await post(purchaseBody("100", credit));
      await unchanged(async () => {
        await voidRecord(r, 409);
        await patch(r, refundBody(p, "50", credit), 409);
        await patch(r, refundBody(p, "100", dst), 409);
      });
      await voidRecord(spent);
      await query(
        `INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES('credit-reserve',${quote(h)},${quote(credit)},'Credit reserve','2026-01-01','2026-01-01')`,
      );
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,created_at) VALUES('credit-reserved',${quote(h)},'credit-reserve',${quote(credit)},'allocation','2026-02-15',100,'2026-02-15')`,
      );
      await unchanged(() => voidRecord(r, 409));
      await query(
        `INSERT INTO reserve_movements(id,household_id,reserve_id,account_id,type,movement_date,amount_minor,created_at) VALUES('credit-released',${quote(h)},'credit-reserve',${quote(credit)},'release','2026-02-15',-100,'2026-02-15')`,
      );
      const reserve = await query(
        "SELECT * FROM reserve_movements ORDER BY rowid",
      );
      await voidRecord(r);
      assert.equal(await balance(credit), "0");
      assert.deepEqual(
        await query("SELECT * FROM reserve_movements ORDER BY rowid"),
        reserve,
      );
    },
  );
  await check(
    "six same-key concurrent full refunds return one original record and one parent bump",
    async () => {
      const p = await post(purchaseBody("100")),
        body = refundBody(p, "100"),
        before = await snapshot();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => post(body, "same-full-refund")),
      );
      for (const r of results) assert.deepEqual(r, results[0]);
      const after = await snapshot();
      assert.equal(after.transactions.length, before.transactions.length + 1);
      assert.equal(
        after.refund_details.length,
        before.refund_details.length + 1,
      );
      assert.equal(
        after.posting_requests.length,
        before.posting_requests.length + 1,
      );
      assert.equal(
        after.idempotency_keys.length,
        before.idempotency_keys.length + 1,
      );
      assert.equal((await get(p)).version, 2);
      assert.equal(after.audit_events.length, before.audit_events.length + 2);
    },
  );
  await check(
    "different-key overrefund race and purchase decrease/void races preserve latest parent ceiling",
    async () => {
      // Capture responses directly because the winner is deliberately nondeterministic.
      const raw = async (url, method, body, key) => {
        const response = await fetch(base + url, {
          method,
          headers: {
            Cookie: `finance_session=${owner}`,
            Origin: appOrigin,
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, body: await response.json() };
      };
      const p = await post(purchaseBody("100"));
      const race = await Promise.all([
        raw(path, "POST", refundBody(p, "70"), randomUUID()),
        raw(path, "POST", refundBody(p, "70"), randomUUID()),
      ]);
      assert.deepEqual(race.map((x) => x.status).sort(), [201, 409]);
      assert.equal((await get(p)).version, 2);
      for (const operation of ["decrease", "void"]) {
        const parent = await post(purchaseBody("100"));
        const pair = await Promise.all([
          raw(path, "POST", refundBody(parent, "80"), randomUUID()),
          operation === "decrease"
            ? raw(`${path}/${parent.id}`, "PATCH", {
                ...purchaseBody("50"),
                version: 1,
              })
            : raw(`${path}/${parent.id}/void`, "POST", { version: 1 }),
        ]);
        assert.equal(
          pair.filter((x) => [200, 201].includes(x.status)).length,
          1,
          JSON.stringify(pair),
        );
        assert.equal(
          pair.filter((x) => x.status === 409).length,
          1,
          JSON.stringify(pair),
        );
        const current = await get(parent);
        assert.equal(current.version, 2);
        if (pair[0].status === 201) {
          assert.equal(current.status, "posted");
          assert.equal(current.amountMinor, "100");
        } else if (operation === "decrease")
          assert.equal(current.amountMinor, "50");
        else assert.equal(current.status, "void");
      }
    },
  );
  await check(
    "post failure injection rolls back complete rows and same key retries after trigger removal",
    async () => {
      const p = await post(purchaseBody("1000"));
      for (const [label, event, condition, action, status] of [
        [
          "movement",
          "INSERT ON account_movements",
          "NEW.type='transaction'",
          "ABORT",
          503,
        ],
        ["details", "INSERT ON refund_details", "1", "ABORT", 503],
        ["audit", "INSERT ON audit_events", "1", "ABORT", 503],
        ["key", "INSERT ON idempotency_keys", "1", "ABORT", 503],
        [
          "response",
          "UPDATE OF response_json ON posting_requests",
          "1",
          "ABORT",
          503,
        ],
        [
          "ignored-movement",
          "INSERT ON account_movements",
          "NEW.type='transaction'",
          "IGNORE",
          503,
        ],
        ["ignored-detail", "INSERT ON refund_details", "1", "IGNORE", 503],
        [
          "ignored-parent-cas",
          "UPDATE ON transactions",
          `OLD.id=${quote(p.id)}`,
          "IGNORE",
          503,
        ],
      ]) {
        await query(
          `CREATE TRIGGER fixture_failure BEFORE ${event} WHEN ${condition} BEGIN SELECT RAISE(${action}${action === "IGNORE" ? "" : ",'fixture_failure'"}); END`,
        );
        const body = refundBody(p, "10"),
          key = `failure-${label}`;
        await unchanged(() => post(body, key, status));
        await query("DROP TRIGGER fixture_failure");
        const success = await post(body, key);
        assert.equal(success.amountMinor, "10");
      }
    },
  );
  await check(
    "late edit/void and ignored required row/bulk failures roll back versions, allocations, movements and audits",
    async () => {
      const p = await post(
        purchaseBody("3", eur, "EUR", {
          exchangeRate: "0.5",
          exchangeRateSource: "original",
        }),
      );
      const a = await post(refundBody(p, "1", euroDst)),
        b = await post(refundBody(p, "1", euroDst));
      for (const [label, event, condition, action, status] of [
        [
          "sibling-detail",
          "UPDATE ON posting_details",
          `OLD.transaction_id=${quote(b.id)}`,
          "ABORT",
          503,
        ],
        [
          "late-audit",
          "INSERT ON audit_events",
          `NEW.transaction_id=${quote(b.id)}`,
          "ABORT",
          503,
        ],
        [
          "ignored-sibling",
          "UPDATE ON posting_details",
          `OLD.transaction_id=${quote(b.id)}`,
          "IGNORE",
          409,
        ],
        [
          "ignored-delete",
          "DELETE ON account_movements",
          `OLD.transaction_id=${quote(a.id)}`,
          "IGNORE",
          503,
        ],
        [
          "ignored-target",
          "UPDATE ON transactions",
          `OLD.id=${quote(a.id)}`,
          "IGNORE",
          503,
        ],
      ]) {
        await query(
          `CREATE TRIGGER fixture_failure BEFORE ${event} WHEN ${condition} BEGIN SELECT RAISE(${action}${action === "IGNORE" ? "" : ",'fixture_failure'"}); END`,
        );
        await unchanged(() => patch(a, refundBody(p, "2", euroDst), status));
        await unchanged(() => voidRecord(a, status));
        await query("DROP TRIGGER fixture_failure");
      }
      await patch(a, refundBody(p, "2", euroDst));
      assert.deepEqual(await allocations([a, b]), [
        ["2", "1", 2, "posted"],
        ["1", "1", 2, "posted"],
      ]);
    },
  );
  await check(
    "Prisma scoped GET/list cursors retain refunds, purchases, transfer and fee string fields",
    async () => {
      const transfer = await post({
        type: "transfer",
        transactionDate: "2026-06-01",
        fromAccountId: src,
        toAccountId: dst,
        debitAmountMinor: "100",
        creditAmountMinor: "100",
        debitCurrency: "RSD",
        creditCurrency: "RSD",
        fee: {
          amountMinor: "1",
          categoryId: expense.id,
          exchangeRate: null,
          exchangeRateSource: null,
        },
        merchant: null,
        note: null,
      });
      const all = [];
      let cursor;
      do {
        const page = await api(
          path + `?limit=7${cursor ? `&cursor=${cursor}` : ""}`,
          owner,
        );
        all.push(...page.transactions);
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(new Set(all.map((x) => x.id)).size, all.length);
      assert.equal(
        all.length,
        (
          await query(
            `SELECT count(*) n FROM transactions WHERE household_id=${quote(h)}`,
          )
        )[0].n,
      );
      for (const record of all) {
        assert.equal(record.householdId, h);
        if (record.type !== "transfer") {
          assert.equal(typeof record.amountMinor, "string");
          assert.ok(
            record.rsdEquivalentMinor === null ||
              typeof record.rsdEquivalentMinor === "string",
          );
        }
        if (record.type === "refund")
          assert.equal(typeof record.purchaseTransactionId, "string");
      }
      const t = await get(transfer);
      assert.equal(t.fee.amountMinor, "1");
      assert.equal((await get(t.fee)).parentTransactionId, t.id);
      assert.ok(all.some((x) => x.id === acceptance.id));
      assert.ok(all.some((x) => x.id === acceptanceRefund.id));
      await api(path, undefined, { status: 401 });
      await api(path, stranger, { status: 404 });
    },
  );
  await check(
    "membership revocation inside the actual native batch denies refund and rolls back financial state",
    async () => {
      const p = await post(purchaseBody("100"));
      await unchanged(() =>
        api("/_verification/revoked-in-batch", member, {
          method: "POST",
          body: { householdId: h, body: refundBody(p, "10") },
          status: 404,
        }),
      );
      // The revocation is part of the failed batch and must itself roll back.
      const membership = (
        await query(
          `SELECT status FROM household_members WHERE household_id=${quote(h)} AND identity_subject=(SELECT 'user:'||id FROM auth_users WHERE email='member@example.invalid')`,
        )
      )[0];
      assert.equal(membership.status, "active");
      await query(
        `UPDATE household_members SET status='revoked' WHERE household_id=${quote(h)} AND identity_subject=(SELECT 'user:'||id FROM auth_users WHERE email='member@example.invalid')`,
      );
      await unchanged(async () => {
        await api(path, member, { status: 404 });
        await post(refundBody(p, "1"), randomUUID(), 404, member);
        await post(refundBody(p, "1"), "long-replay", 404, member);
      });
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
    },
  );
  console.log(
    `Atomic refund verification passed (${groups} groups; production API, native Workerd, disposable local D1).`,
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
