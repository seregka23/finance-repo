import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(
  join(root, "backend/.cloudflare/money-verification-"),
);
const configPath = join(temporary, "wrangler.json");
const persistence = join(temporary, "state");
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
const children = new Set();
let server,
  base,
  groups = 0;
function launch(args) {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules/wrangler/bin/wrangler.js"), ...args],
    {
      cwd: root,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.add(child);
  child.once("close", () => children.delete(child));
  let output = "";
  child.stdout.on("data", (v) => {
    output = (output + v).slice(-60000);
  });
  child.stderr.on("data", (v) => {
    output = (output + v).slice(-60000);
  });
  return { child, output: () => output };
}
function signal(child, name) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, name);
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
}
async function stop(proc) {
  if (proc.child.exitCode !== null || proc.child.signalCode !== null) return;
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
    assert.equal(code, 0, proc.output());
  } finally {
    clearTimeout(timer);
  }
}
async function api(operation, body = {}, status = 200, identity = "owner-a") {
  const response = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Fixture-Identity": identity,
    },
    body: JSON.stringify({ operation, ...body }),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  assert.equal(
    response.status,
    status,
    `${operation}: ${JSON.stringify(value)}`,
  );
  return value;
}
async function check(name, fn) {
  await fn();
  groups++;
  console.log(`PASS ${name}`);
}
async function setup() {
  const worker = `
import 'reflect-metadata';
import {env} from 'cloudflare:workers';
import * as money from '../../dist/finance/money.js';
import * as fx from '../../dist/finance/fx.js';
import * as calendar from '../../dist/finance/calendar.js';
import {summarizeRecordedMoney,RecordedMoneyError} from '../../dist/finance/recorded-money.js';
import {MonetaryRepository} from '../../dist/finance/monetary-repository.js';
import {HouseholdAccessService} from '../../dist/households/households.js';
export default {async fetch(request){
 try{
  const b=await request.json();const db=env.DB;const access=new HouseholdAccessService(db);
  const identity={subject:request.headers.get('x-fixture-identity')||'',email:'fixture@example.invalid'};
  let result;
  switch(b.operation){
   case 'parse': {const minor=money.parseAmount(b.amount,b.currency);result={amountMinor:minor.toString(),amount:money.formatAmount(minor,b.currency),binding:money.toD1Minor(minor)};break;}
   case 'minor': result={minor:money.parseMinor(b.value).toString()};break;
   case 'd1-number': result={minor:money.fromD1Minor(b.value).toString()};break;
   case 'sum': result={amount:money.formatAmount(money.sumMinor(b.values.map(v=>money.parseMinor(v))),b.currency)};break;
   case 'conversion': result=fx.recordConversion(money.parseAmount(b.amount,b.currency),b.currency,b.rate,b.source??null);break;
   case 'refunds': {let previous=0n;const deltas=[];for(const value of b.refunds){const amount=money.parseMinor(value);deltas.push(fx.cumulativeRefundRsd(money.parseMinor(b.originalMinor),money.parseMinor(b.originalRsdMinor),b.currency,b.rate,previous,amount).toString());previous+=amount;}result={deltas,totalMinor:money.sumMinor(deltas.map(v=>money.parseMinor(v))).toString()};break;}
   case 'calendar': result={date:calendar.householdDateForInstant(b.instant,b.timeZone),month:calendar.householdMonthForInstant(b.instant,b.timeZone)};break;
   case 'civil': result={date:calendar.validateDate(b.date),month:calendar.monthForFinancialDate(b.date)};break;
   case 'month': result=calendar.monthDateRange(b.month);break;
   case 'summary-input': result=summarizeRecordedMoney(b.records);break;
   case 'setup': {
    const now='2026-01-01T00:00:00.000Z';const statements=[];
    for(const [householdId,zone,subject] of [['house-a','Europe/Belgrade','owner-a'],['house-b','America/New_York','owner-b']]){
     statements.push(db.prepare('INSERT INTO households(id,name,time_zone,created_at,updated_at) VALUES (?,?,?,?,?)').bind(householdId,'Synthetic money fixture',zone,now,now));
     statements.push(db.prepare("INSERT INTO household_members(id,household_id,identity_subject,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?)").bind(subject,householdId,subject,now,now));
     for(const currency of ['RSD','EUR','RUB','USD'])statements.push(db.prepare("INSERT INTO accounts(id,household_id,name,type,currency,designation,created_at,updated_at) VALUES (?,?,?,'cash',?,'personal',?,?)").bind(householdId+'-'+currency,householdId,'Synthetic '+currency,currency,now,now));
    }
    statements.push(db.prepare("INSERT INTO household_members(id,household_id,identity_subject,role,status,created_at,updated_at) VALUES ('member-a','house-a','member-a','member','active',?,?)").bind(now,now));
    await db.batch(statements);result={ok:true};break;
   }
   case 'seed': {
    for(let i=0;i<b.records.length;i+=50){const statements=b.records.slice(i,i+50).map(r=>db.prepare("INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,rsd_equivalent_minor,exchange_rate,exchange_rate_source,created_at) VALUES (?,?,?,'opening_balance',?,?,?,?,?,?,?)").bind(r.id,b.householdId,b.householdId+'-'+money.validateCurrency(r.currency),calendar.validateDate(r.movementDate),money.toD1Minor(money.parseMinor(r.amountMinor)),r.currency,r.rsdEquivalentMinor===null?null:money.toD1Minor(money.parseMinor(r.rsdEquivalentMinor)),r.exchangeRate,r.exchangeRateSource,'2026-04-15T12:00:00.000Z'));await access.batch(identity,b.householdId,'member',statements);}
    result={ok:true};break;
   }
   case 'read': result=await new MonetaryRepository(db,access).readRecordedMonth(identity,b.householdId,b.month);break;
   case 'current-month': {const household=await access.get(identity,b.householdId);result={month:calendar.householdMonthForInstant(b.instant,household.timeZone)};break;}
   case 'sql-sum': {const range=calendar.monthDateRange(b.month);await access.get(identity,b.householdId);result=await db.prepare('SELECT CAST(SUM(amount_minor) AS TEXT) AS totalMinor FROM account_movements WHERE household_id=? AND movement_date>=? AND movement_date<=?').bind(b.householdId,range.startDate,range.endDate).first();break;}
   case 'revoke': await db.prepare("UPDATE household_members SET status='revoked' WHERE id='member-a'").run();result={ok:true};break;
   default: return Response.json({error:{code:'UNKNOWN_FIXTURE_OPERATION'}},{status:404});
  }
  return Response.json(result);
 }catch(e){return Response.json({error:{code:e.code||(e instanceof RecordedMoneyError?'RECORDED_MONEY_INVALID':'D1_ERROR'),message:e.message}},{status:e.getStatus?.()||(e instanceof money.FinanceError?400:500)});}
}};
`;
  await writeFile(join(temporary, "worker.mjs"), worker);
  const aliases = Object.fromEntries(
    [
      "class-validator",
      "class-transformer",
      "@nestjs/microservices",
      "@nestjs/microservices/microservices-module.js",
      "@nestjs/websockets/socket-module.js",
    ].map((name) => [
      name,
      join(root, "backend/cloudflare/missing-optional-package.mjs"),
    ]),
  );
  await writeFile(
    configPath,
    JSON.stringify({
      name: "finance-money-verification",
      main: join(temporary, "worker.mjs"),
      compatibility_date: "2026-11-16",
      compatibility_flags: [
        "nodejs_compat",
        "enable_nodejs_http_server_modules",
      ],
      alias: aliases,
      d1_databases: [
        {
          binding: "DB",
          database_name: "disposable-money-verification",
          database_id: randomUUID(),
          migrations_dir: join(root, "backend/migrations"),
        },
      ],
    }),
  );
  const common = [
    "--config",
    configPath,
    "--local",
    "--persist-to",
    persistence,
  ];
  await command(["d1", "migrations", "apply", "DB", ...common]);
  server = launch([
    "dev",
    ...common,
    "--ip",
    "127.0.0.1",
    "--port",
    "0",
    "--inspector-port",
    "0",
  ]);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const match = server
      .output()
      .match(/Ready on https?:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      base = "http://127.0.0.1:" + match[1];
      return;
    }
    if (server.child.exitCode !== null) throw new Error(server.output());
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Money Worker startup timed out");
}
const max = 9007199254740991n;
function row(
  id,
  currency,
  amountMinor,
  rsdEquivalentMinor,
  exchangeRate,
  movementDate = "2026-01-31",
) {
  return {
    id,
    currency,
    amountMinor,
    rsdEquivalentMinor,
    exchangeRate,
    exchangeRateSource:
      exchangeRate === null ? "migration" : "recorded manual rate",
    movementDate,
  };
}
async function verify() {
  await setup();
  await check(
    "money strings parse precisely and safe D1 binding boundaries are enforced",
    async () => {
      for (const currency of ["RSD", "EUR", "RUB", "USD"])
        assert.equal(
          (await api("parse", { amount: "0.01", currency })).amountMinor,
          "1",
        );
      assert.equal(
        (await api("sum", { values: ["10", "20"], currency: "RSD" })).amount,
        "0.30",
      );
      for (const [amount, minor] of [
        ["90071992547409.91", max.toString()],
        ["-90071992547409.91", (-max).toString()],
        ["-0.00", "0"],
        ["+0001.2", "120"],
      ])
        assert.equal(
          (await api("parse", { amount, currency: "EUR" })).amountMinor,
          minor,
        );
      for (const amount of [
        1.23,
        "1.001",
        "1e3",
        "NaN",
        " 1.00",
        "1,000.00",
        "1.",
        ".01",
        "90071992547409.92",
        "-90071992547409.92",
        "0".repeat(81),
      ])
        await api("parse", { amount, currency: "EUR" }, 400);
      await api("parse", { amount: "1", currency: "GBP" }, 400);
      for (const value of [
        "9007199254740992",
        "-9007199254740992",
        "01",
        "-0",
        "1e2",
        "1".repeat(10000),
      ])
        await api("minor", { value }, 400);
      for (const value of [1.5, 9007199254740992, "123", null])
        await api("d1-number", { value }, 400);
      assert.equal(
        (await api("d1-number", { value: Number(max) })).minor,
        max.toString(),
      );
    },
  );
  await check(
    "FX uses decimal ratios and signed half-up rounding without floating drift",
    async () => {
      for (const [amount, rate, expected] of [
        ["0.01", "0.5", "1"],
        ["-0.01", "0.5", "-1"],
        ["0.03", "2.5", "8"],
        ["-0.03", "2.5", "-8"],
        ["0.01", "0.499999999999", "0"],
        ["100.01", "117.2", "1172117"],
      ]) {
        const result = await api("conversion", {
          amount,
          currency: "EUR",
          rate,
          source: " manual snapshot ",
        });
        assert.equal(result.rsdEquivalentMinor, expected);
        assert.equal(result.rate, rate);
        assert.equal(result.source, " manual snapshot ");
      }
      for (const rate of [1.2, "0", "-1", "1e2", "1.2.3", "1".repeat(81)])
        await api("conversion", { amount: "1", currency: "EUR", rate }, 400);
      await api(
        "conversion",
        { amount: "90071992547409.91", currency: "EUR", rate: "2" },
        400,
      );
      await api("conversion", { amount: "1", currency: "RSD", rate: "2" }, 400);
      await api(
        "conversion",
        { amount: "1", currency: "EUR", rate: "1", source: 123 },
        400,
      );
      assert.equal(
        (
          await api("conversion", {
            amount: "1.23",
            currency: "RSD",
            rate: null,
          })
        ).rsdEquivalentMinor,
        "123",
      );
      const missing = await api("conversion", {
        amount: "12.34",
        currency: "USD",
        rate: null,
        source: "legacy",
      });
      assert.equal(missing.amountMinor, "1234");
      assert.equal(missing.currency, "USD");
      assert.equal(missing.rsdEquivalentMinor, null);
    },
  );
  await check(
    "cumulative partial refunds offset the recorded purchase exactly",
    async () => {
      const result = await api("refunds", {
        originalMinor: "3",
        originalRsdMinor: "2",
        currency: "EUR",
        rate: "0.5",
        refunds: ["1", "1", "1"],
      });
      assert.deepEqual(result, { deltas: ["1", "0", "1"], totalMinor: "2" });
      assert.deepEqual(
        await api("refunds", {
          originalMinor: "3",
          originalRsdMinor: "2",
          currency: "EUR",
          rate: "0.8",
          refunds: ["2", "1"],
        }),
        { deltas: ["2", "0"], totalMinor: "2" },
      );
      await api(
        "refunds",
        {
          originalMinor: "3",
          originalRsdMinor: "3",
          currency: "EUR",
          rate: "0.8",
          refunds: ["1"],
        },
        400,
      );
      await api(
        "refunds",
        {
          originalMinor: "3",
          originalRsdMinor: "2",
          currency: "EUR",
          rate: null,
          refunds: ["1"],
        },
        400,
      );
      await api(
        "refunds",
        {
          originalMinor: "3",
          originalRsdMinor: "2",
          currency: "EUR",
          rate: "0.5",
          refunds: ["4"],
        },
        400,
      );
    },
  );
  await check(
    "calendar validation and household months respect real zone/DST boundaries",
    async () => {
      for (const date of [
        "2026-02-29",
        "1900-02-29",
        "2026-04-31",
        "0000-01-01",
        "2026-1-01",
      ])
        await api("civil", { date }, 400);
      assert.equal(
        (await api("civil", { date: "2000-02-29" })).month,
        "2000-02",
      );
      assert.equal(
        (await api("civil", { date: "2026-01-31" })).date,
        "2026-01-31",
      );
      assert.deepEqual(await api("month", { month: "2024-02" }), {
        startDate: "2024-02-01",
        endDate: "2024-02-29",
      });
      assert.deepEqual(await api("month", { month: "9999-12" }), {
        startDate: "9999-12-01",
        endDate: "9999-12-31",
      });
      for (const [instant, timeZone, date, month] of [
        ["2026-01-31T23:30:00Z", undefined, "2026-02-01", "2026-02"],
        ["2026-03-31T21:30:00Z", "Europe/Belgrade", "2026-03-31", "2026-03"],
        ["2026-03-31T22:30:00Z", "Europe/Belgrade", "2026-04-01", "2026-04"],
        ["2026-03-01T00:30:00Z", "America/New_York", "2026-02-28", "2026-02"],
      ])
        assert.deepEqual(await api("calendar", { instant, timeZone }), {
          date,
          month,
        });
      for (const instant of [
        "2026-02-30T12:00:00Z",
        "2026-03-01T24:00:00Z",
        "2026-03-01T00:00:00",
        "2026-03-01T00:00:00+25:00",
      ])
        await api("calendar", { instant }, 400);
      await api(
        "calendar",
        { instant: "2026-01-01T00:00:00Z", timeZone: "+01:00" },
        400,
      );
    },
  );
  await api("setup");
  const rows = [
    row("eur-known", "EUR", "10000", "1165000", "117.2000"),
    row("rub-negative", "RUB", "-20000", "-22000", "1.10"),
    row("usd-missing", "USD", "12345", null, null),
    row("rsd-identity", "RSD", "5000", null, null),
    row("eur-no-rate", "EUR", "100", "11800", null),
    row("eur-no-equivalent", "EUR", "200", null, "117.2"),
    row("usd-zero-known", "USD", "0", "0", "0.004"),
    row("usd-zero-missing", "USD", "0", null, null),
  ];
  await api("seed", { householdId: "house-a", records: rows });
  let recorded;
  await check(
    "recorded values and originals survive missing conversion metadata without revaluation",
    async () => {
      recorded = await api("read", {
        householdId: "house-a",
        month: "2026-01",
      });
      assert.equal(recorded.records.length, 8);
      assert.deepEqual(recorded.summary, {
        totalsByCurrency: {
          RSD: "50.00",
          EUR: "103.00",
          RUB: "-200.00",
          USD: "123.45",
        },
        rsdKnownSubtotal: "11598.00",
        incompleteConversion: true,
        missingConversionCount: 3,
        missingRateCount: 3,
        affectedRecordCount: 4,
      });
      const eur = recorded.records.find((r) => r.id === "eur-known");
      assert.equal(eur.exchangeRate, "117.2000");
      assert.equal(eur.rsdEquivalentMinor, "1165000");
      assert.equal(eur.amountMinor, "10000");
      const missing = recorded.records.find((r) => r.id === "usd-missing");
      assert.equal(missing.amountMinor, "12345");
      assert.equal(missing.currency, "USD");
      assert.equal(missing.rsdEquivalentMinor, null);
      await api("seed", {
        householdId: "house-a",
        records: [
          row("feb-new-rate", "EUR", "100", "20000", "200", "2026-02-01"),
        ],
      });
      assert.deepEqual(
        await api("read", { householdId: "house-a", month: "2026-01" }),
        recorded,
      );
      const feb = await api("read", {
        householdId: "house-a",
        month: "2026-02",
      });
      assert.equal(feb.records.length, 1);
      assert.equal(feb.summary.rsdKnownSubtotal, "200.00");
    },
  );
  await check(
    "D1 returns exact text aggregates beyond JavaScript safe integers",
    async () => {
      await api("seed", {
        householdId: "house-a",
        records: [
          row("april-max", "RSD", max.toString(), null, null, "2026-04-01"),
          row("april-two", "RSD", "2", null, null, "2026-04-01"),
        ],
      });
      assert.deepEqual(
        await api("sql-sum", { householdId: "house-a", month: "2026-04" }),
        { totalMinor: "9007199254740993" },
      );
      const result = await api("read", {
        householdId: "house-a",
        month: "2026-04",
      });
      assert.equal(result.summary.totalsByCurrency.RSD, "90071992547409.93");
      await api(
        "seed",
        {
          householdId: "house-a",
          records: [row("unsafe", "RSD", "9007199254740992", null, null)],
        },
        400,
      );
      await api(
        "summary-input",
        { records: [{ ...rows[0], amountMinor: "9007199254740992" }] },
        500,
      );
    },
  );
  await check(
    "row-text BigInt aggregation remains exact beyond SQLite SUM range",
    async () => {
      const many = Array.from({ length: 1025 }, (_, i) =>
        row("large-" + i, "RSD", max.toString(), null, null, "2026-05-15"),
      );
      await api("seed", { householdId: "house-a", records: many });
      const expected = max * 1025n;
      assert.ok(expected > 9223372036854775807n);
      const failed = await api(
        "sql-sum",
        { householdId: "house-a", month: "2026-05" },
        500,
      );
      assert.match(failed.error.message, /integer overflow/i);
      const result = await api("read", {
        householdId: "house-a",
        month: "2026-05",
      });
      assert.equal(result.records.length, 1025);
      assert.equal(
        result.summary.rsdKnownSubtotal,
        `${expected / 100n}.${(expected % 100n).toString().padStart(2, "0")}`,
      );
    },
  );
  await check(
    "month reads use financial dates, remain household scoped and recheck membership",
    async () => {
      assert.equal(
        (
          await api("current-month", {
            householdId: "house-a",
            instant: "2026-01-31T23:30:00Z",
          })
        ).month,
        "2026-02",
      );
      assert.equal(
        (
          await api(
            "current-month",
            { householdId: "house-b", instant: "2026-01-31T23:30:00Z" },
            200,
            "owner-b",
          )
        ).month,
        "2026-01",
      );
      assert.deepEqual(
        await api(
          "read",
          { householdId: "house-a", month: "2026-01" },
          200,
          "member-a",
        ),
        recorded,
      );
      const other = await api(
        "read",
        { householdId: "house-b", month: "2026-01" },
        200,
        "owner-b",
      );
      assert.equal(other.records.length, 0);
      assert.equal(other.summary.incompleteConversion, false);
      await api(
        "read",
        { householdId: "house-a", month: "2026-01" },
        404,
        "owner-b",
      );
      await api("read", { householdId: "house-a", month: "2026-13" }, 400);
      await api("revoke");
      await api(
        "read",
        { householdId: "house-a", month: "2026-01" },
        404,
        "member-a",
      );
    },
  );
  await check(
    "inconsistent stored RSD data fails explicitly rather than producing a false total",
    async () => {
      await api("seed", {
        householdId: "house-a",
        records: [row("bad-rsd", "RSD", "100", "200", null, "2026-06-01")],
      });
      const result = await api(
        "read",
        { householdId: "house-a", month: "2026-06" },
        500,
      );
      assert.equal(result.error.code, "RECORDED_MONEY_INVALID");
    },
  );
  console.log(`Monetary Worker/D1 verification passed (${groups} groups).`);
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
} catch (e) {
  console.error(e.stack ?? e);
  if (server) console.error(server.output());
  process.exitCode = 1;
} finally {
  await cleanup();
}
