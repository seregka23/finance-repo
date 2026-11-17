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
  join(root, "backend/.cloudflare/access-verify-"),
);
const configPath = join(temporary, "wrangler.json");
const persistence = join(temporary, "state");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const issuer = "https://verification.cloudflareaccess.com";
const audience = "local-verification-only";
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const appOrigin = `http://127.0.0.1:${port}`;
const serving = process.argv.includes("--serve");
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
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const publicKey = {
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid: "fixture-key",
  alg: "RS256",
  use: "sig",
};
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(user, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: "RS256", kid: "fixture-key", ...header })}.${encode({ iss: issuer, aud: [audience], sub: user, email: `${user}@example.invalid`, type: "app", iat: now - 1, exp: now + 3600, ...claims })}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data))).toString("base64url")}`;
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
  jwt,
  {
    method = "GET",
    body,
    status = 200,
    origin = appOrigin,
    cookie = false,
  } = {},
) {
  const headers = {};
  if (jwt)
    headers[cookie ? "Cookie" : "Cf-Access-Jwt-Assertion"] = cookie
      ? `CF_Authorization=${jwt}`
      : jwt;
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
  // This is an isolated verification entrypoint, never the deployed worker.
  // Only public test keys are injected. JWT validation is the production service.
  const browserTokens = serving
    ? {
        owner: await token("owner"),
        member: await token("member"),
        newcomer: await token("newcomer"),
      }
    : {};
  const fixture = `
import 'reflect-metadata';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../../dist/worker.module.js';
import { AccessAuthService } from '../../dist/auth/auth.js';
import { HouseholdAccessService } from '../../dist/households/households.js';
import { CategoryService } from '../../dist/categories/categories.js';
const settings = {teamDomain:${JSON.stringify(issuer)},audience:${JSON.stringify(audience)},appOrigin:${JSON.stringify(appOrigin)},fetch:async () => Response.json({keys:[${JSON.stringify(publicKey)}]})};
const auth = new AccessAuthService(settings);
const handler = httpServerHandler({port:3000});
let application;
export default { async fetch(request,bindings,context) {
  const url = new URL(request.url);
  const browserTokens = ${JSON.stringify(browserTokens)};
  const browserUser = url.pathname.startsWith('/_verification/sign-in/') ? url.pathname.split('/').at(-1) : '';
  if(browserTokens[browserUser]) return new Response(null,{status:302,headers:{Location:'/', 'Set-Cookie':'CF_Authorization='+browserTokens[browserUser]+'; Path=/; HttpOnly; SameSite=Strict'}});
  if(url.pathname === '/_verification/batch') {
    try {
      const identity = await auth.verify(request.headers.get('cf-access-jwt-assertion') || '');
      const body = await request.json();
      const access = new HouseholdAccessService(env.DB);
      const results = await access.batch(identity,body.householdId,body.role || 'member',[
        env.DB.prepare('INSERT INTO access_verification_records (id,household_id,value) VALUES (?,?,?)').bind(body.id,body.householdId,body.value),
        env.DB.prepare('SELECT value FROM access_verification_records WHERE household_id=? ORDER BY id').bind(body.householdId)
      ]);
      return Response.json(results[2].results);
    } catch(e) { return Response.json(e.getResponse?.() || {error:{code:'VERIFICATION_FAILED'}},{status:e.getStatus?.() || 500}); }
  }
  if(url.pathname.startsWith('/_verification/category-')) {
    try {
      const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length);
      const identity=await auth.verify(request.headers.get('cf-access-jwt-assertion')||cookie||'');
      if(request.method !== 'GET' && request.headers.get('origin') !== settings.appOrigin) return Response.json({error:{code:'INVALID_ORIGIN'}},{status:403});
      const body=request.method==='GET'?Object.fromEntries(url.searchParams):await request.json();
      const access=new HouseholdAccessService(env.DB);
      const categories=new CategoryService(env.DB,access);
      let statements=[];
      if(url.pathname==='/_verification/category-assert') {
        if(request.method==='GET') statements=[env.DB.prepare('SELECT id FROM access_verification_records WHERE household_id=? AND id=?').bind(body.householdId,body.marker)];
        else statements=[
          env.DB.prepare('INSERT INTO access_verification_records(id,household_id,value) VALUES (?,?,?)').bind(body.marker,body.householdId,'category assertion proof'),
          categories.selectionStatement(body.householdId,body.categoryId,body.usage)
        ];
      } else if(url.pathname==='/_verification/category-history') {
        if(request.method==='POST') {
          const now=new Date().toISOString();
          statements=[categories.selectionStatement(body.householdId,body.categoryId,'expense'),
            env.DB.prepare("INSERT INTO transactions(id,household_id,type,transaction_date,category_id,author_member_id,created_at,updated_at) SELECT ?,?,'expense','2026-11-17',?,id,?,? FROM household_members WHERE household_id=? AND identity_subject=? AND status='active'").bind(crypto.randomUUID(),body.householdId,body.categoryId,now,now,body.householdId,identity.subject),
            env.DB.prepare("INSERT INTO monthly_plans(id,household_id,month,category_id,limit_minor,created_at,updated_at) VALUES (?,?,'2026-11',?,10000,?,?)").bind(crypto.randomUUID(),body.householdId,body.categoryId,now,now)
          ];
        } else if(request.method==='PATCH') statements=[env.DB.prepare('UPDATE categories SET type=? WHERE household_id=? AND id=?').bind(body.type,body.householdId,body.categoryId)];
        else statements=[env.DB.prepare('SELECT c.id,c.name,c.type,c.status,(SELECT COUNT(*) FROM transactions WHERE household_id=c.household_id AND category_id=c.id) AS transactionCount,(SELECT COUNT(*) FROM monthly_plans WHERE household_id=c.household_id AND category_id=c.id) AS planCount FROM categories c WHERE c.household_id=? AND c.id=?').bind(body.householdId,body.categoryId)];
      } else return Response.json({error:{code:'NOT_FOUND'}},{status:404});
      const results=await access.batch(identity,body.householdId,'member',statements);
      return Response.json(request.method==='GET'?results[1].results:{ok:true});
    } catch(e) { return Response.json(e.getResponse?.()||{error:{code:'VERIFICATION_FAILED'}},{status:e.getStatus?.()||500}); }
  }
  application ??= NestFactory.create(WorkerModule.register(env.DB,false,settings),{logger:['error','warn'],abortOnError:false}).then(async app => {
    app.use('/api/v1',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
    await app.listen(3000); return app;
  });
  await application;
  return handler.fetch(request,bindings,context);
} };
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
      name: "finance-access-verification",
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
          database_name: "disposable-access-verification",
          database_id: randomUUID(),
          migrations_dir: join(root, "backend/migrations"),
        },
      ],
    }),
  );
  await command(["d1", "migrations", "apply", "DB", ...common]);
  await query(
    "CREATE TABLE access_verification_records (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), value TEXT NOT NULL)",
  );
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
async function verify() {
  await prepare();
  const owner = await token("owner"),
    member = await token("member"),
    stranger = await token("stranger");
  let household, other, invitation, memberId;
  await check(
    "signed Access sessions, cookie transport, claim validation and CSRF",
    async () => {
      assert.equal((await api("/api/v1/auth/config")).configured, true);
      const malformed = await fetch(base + "/api/v1/households", {
        method: "POST",
        headers: {
          Origin: appOrigin,
          "Content-Type": "application/json",
          "Cf-Access-Jwt-Assertion": owner,
        },
        body: "{",
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).error.code, "INVALID_INPUT");
      assert.equal(malformed.headers.get("cache-control"), "no-store");
      assert.deepEqual((await api("/api/v1/session", owner)).households, []);
      assert.equal(
        (await api("/api/v1/session", owner, { cookie: true })).user.email,
        "owner@example.invalid",
      );
      await api("/api/v1/session", null, { status: 401 });
      const now = Math.floor(Date.now() / 1000);
      for (const bad of [
        await token("owner", { iss: "https://evil.invalid" }),
        await token("owner", { aud: ["other"] }),
        await token("owner", { exp: now - 1 }),
        await token("owner", { nbf: now + 100 }),
        await token("owner", { iat: now + 100 }),
        await token("owner", { email: "" }),
        await token("owner", {}, { alg: "none" }),
        await token("owner", {}, { kid: "unknown" }),
        owner + "x",
      ])
        await api("/api/v1/session", bad, { status: 401 });
      for (const origin of [null, "https://evil.invalid"])
        await api("/api/v1/households", owner, {
          method: "POST",
          body: { name: "Rejected" },
          origin,
          status: 403,
        });
    },
  );
  await check(
    "new households persist settings and contain no synthetic financial data",
    async () => {
      household = await api("/api/v1/households", owner, {
        method: "POST",
        body: { name: "Our ' household" },
        status: 201,
      });
      other = await api("/api/v1/households", stranger, {
        method: "POST",
        body: { name: "Another household" },
        status: 201,
      });
      assert.equal(household.role, "owner");
      assert.equal(household.timeZone, "Europe/Belgrade");
      assert.equal(
        (await api(`/api/v1/households/${household.id}`, owner)).name,
        "Our ' household",
      );
      const counts = await query(
        "SELECT (SELECT COUNT(*) FROM accounts)+(SELECT COUNT(*) FROM categories)+(SELECT COUNT(*) FROM transactions)+(SELECT COUNT(*) FROM monthly_plans)+(SELECT COUNT(*) FROM reserves)+(SELECT COUNT(*) FROM import_drafts) AS records",
      );
      assert.equal(counts[0].records, 0);
      await api(`/api/v1/households/${household.id}`, stranger, {
        status: 404,
      });
      await api(`/api/v1/households/${other.id}/members`, owner, {
        status: 404,
      });
      await api("/api/v1/households", owner, {
        method: "POST",
        body: { name: "Bad", timeZone: "invalid-zone" },
        status: 400,
      });
    },
  );
  await check(
    "owner invitation, two-member capacity, bound email and single-use acceptance",
    async () => {
      invitation = await api(
        `/api/v1/households/${household.id}/invitations`,
        owner,
        {
          method: "POST",
          body: { email: "member@example.invalid" },
          status: 201,
        },
      );
      assert.ok(invitation.token);
      assert.equal(invitation.token.length, 43);
      await api(`/api/v1/households/${household.id}/invitations`, owner, {
        method: "POST",
        body: { email: "third@example.invalid" },
        status: 409,
      });
      await api("/api/v1/invitations/accept", stranger, {
        method: "POST",
        body: { token: invitation.token },
        status: 409,
      });
      const joined = await api("/api/v1/invitations/accept", member, {
        method: "POST",
        body: { token: invitation.token },
        status: 201,
      });
      assert.equal(joined.id, household.id);
      assert.equal(joined.role, "member");
      memberId = joined.memberId;
      await api("/api/v1/invitations/accept", member, {
        method: "POST",
        body: { token: invitation.token },
        status: 409,
      });
      const listed = await api(
        `/api/v1/households/${household.id}/members`,
        member,
      );
      assert.equal(listed.members.length, 2);
      assert.equal(listed.invitations.length, 0);
      assert.ok(!JSON.stringify(listed).includes(invitation.token));
    },
  );
  await check(
    "shared saved settings, owner-only management and scoped-ID rejection",
    async () => {
      await api(`/api/v1/households/${household.id}`, owner, {
        method: "PATCH",
        body: { name: "Shared saved name", timeZone: "Europe/Paris" },
      });
      assert.equal(
        (await api(`/api/v1/households/${household.id}`, member)).name,
        "Shared saved name",
      );
      assert.equal(
        (await api("/api/v1/session", member)).households[0].id,
        household.id,
      );
      for (const options of [
        { path: "", method: "PATCH", body: { name: "Denied" } },
        {
          path: "/invitations",
          method: "POST",
          body: { email: "third@example.invalid" },
        },
        { path: `/members/${household.memberId}`, method: "DELETE" },
      ])
        await api(`/api/v1/households/${household.id}${options.path}`, member, {
          ...options,
          status: 403,
        });
      await api(
        `/api/v1/households/${household.id}/members/${household.memberId}`,
        owner,
        { method: "DELETE", status: 403 },
      );
      await api(`/api/v1/households/${other.id}`, member, {
        method: "PATCH",
        body: { name: "Denied" },
        status: 404,
      });
      await api(
        `/api/v1/households/${household.id}/members/${other.memberId}`,
        owner,
        { method: "DELETE", status: 404 },
      );
    },
  );
  await check(
    "workspace summaries reflect saved rows and enforce live household access",
    async () => {
      const path = `/api/v1/households/${household.id}/workspace`;
      const empty = {
        accounts: 0,
        transactions: 0,
        plans: 0,
        reserves: 0,
        accountMovements: 0,
      };
      const summary = await api(path, owner);
      assert.deepEqual(summary.counts, empty);
      assert.ok(
        Object.values(summary.capabilities).every((value) => value === false),
      );
      assert.deepEqual((await api(path, member)).counts, empty);
      await api(path, stranger, { status: 404 });
      await api(path, null, { status: 401 });
      const accountId = randomUUID(),
        categoryId = randomUUID(),
        transactionId = randomUUID(),
        planId = randomUUID(),
        reserveId = randomUUID(),
        movementId = randomUUID();
      const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
      const h = quote(household.id),
        now = quote(new Date().toISOString());
      await query(`
      INSERT INTO accounts(id,household_id,name,type,currency,designation,created_at,updated_at) VALUES (${quote(accountId)},${h},'Synthetic verification account','cash','RSD','personal',${now},${now});
      INSERT INTO categories(id,household_id,name,type,created_at,updated_at) VALUES (${quote(categoryId)},${h},'Synthetic category','expense',${now},${now});
      INSERT INTO transactions(id,household_id,type,transaction_date,author_member_id,created_at,updated_at) VALUES (${quote(transactionId)},${h},'expense','2026-11-16',${quote(household.memberId)},${now},${now});
      INSERT INTO monthly_plans(id,household_id,month,category_id,limit_minor,created_at,updated_at) VALUES (${quote(planId)},${h},'2026-11',${quote(categoryId)},0,${now},${now});
      INSERT INTO reserves(id,household_id,account_id,name,created_at,updated_at) VALUES (${quote(reserveId)},${h},${quote(accountId)},'Synthetic reserve',${now},${now});
      INSERT INTO account_movements(id,household_id,account_id,type,movement_date,amount_minor,currency,created_at) VALUES (${quote(movementId)},${h},${quote(accountId)},'opening_balance','2026-11-16',0,'RSD',${now});
    `);
      assert.deepEqual((await api(path, member)).counts, {
        accounts: 1,
        transactions: 1,
        plans: 1,
        reserves: 1,
        accountMovements: 1,
      });
      assert.deepEqual(
        (await api(`/api/v1/households/${other.id}/workspace`, stranger))
          .counts,
        empty,
      );
      await query(
        `DELETE FROM account_movements WHERE id=${quote(movementId)}; DELETE FROM reserves WHERE id=${quote(reserveId)}; DELETE FROM monthly_plans WHERE id=${quote(planId)}; DELETE FROM transactions WHERE id=${quote(transactionId)}; DELETE FROM categories WHERE id=${quote(categoryId)}; DELETE FROM accounts WHERE id=${quote(accountId)};`,
      );
      assert.deepEqual((await api(path, owner)).counts, empty);
    },
  );
  await check(
    "D1 batch access checks share writes and reject other households",
    async () => {
      const write = async (jwt, id, value, hh = household.id, status = 200) =>
        api("/_verification/batch", jwt, {
          method: "POST",
          body: { householdId: hh, id, value },
          status,
        });
      await write(owner, "write-owner", "Saved by owner");
      const records = await write(member, "write-member", "Saved by member");
      assert.deepEqual(
        records.map((r) => r.value),
        ["Saved by member", "Saved by owner"],
      );
      await write(
        stranger,
        "cross-household-write",
        "Must not persist",
        household.id,
        404,
      );
    },
  );
  await check(
    "revocation rejects existing signed sessions and rolls back guarded writes",
    async () => {
      await api(
        `/api/v1/households/${household.id}/members/${memberId}`,
        owner,
        { method: "DELETE", status: 204 },
      );
      assert.deepEqual((await api("/api/v1/session", member)).households, []);
      await api(`/api/v1/households/${household.id}/workspace`, member, {
        status: 404,
      });
      await api(`/api/v1/households/${household.id}`, member, { status: 404 });
      await api(`/api/v1/households/${household.id}/members`, member, {
        status: 404,
      });
      await api(`/api/v1/households/${household.id}`, member, {
        method: "PATCH",
        body: { name: "Revoked" },
        status: 404,
      });
      await api("/_verification/batch", member, {
        method: "POST",
        body: {
          householdId: household.id,
          id: "revoked-write",
          value: "Must not persist",
        },
        status: 404,
      });
      assert.deepEqual(
        await query(
          "SELECT id FROM access_verification_records WHERE id IN ('cross-household-write','revoked-write')",
        ),
        [],
      );
    },
  );
  await check(
    "concurrent invitations reserve one slot and cancellation invalidates the token",
    async () => {
      const outcomes = await Promise.all(
        ["new-one", "new-two"].map(async (user) => {
          const response = await fetch(
            `${base}/api/v1/households/${household.id}/invitations`,
            {
              method: "POST",
              headers: {
                "Cf-Access-Jwt-Assertion": owner,
                Origin: appOrigin,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ email: `${user}@example.invalid` }),
              signal: AbortSignal.timeout(15000),
            },
          );
          return { status: response.status, body: await response.json() };
        }),
      );
      assert.deepEqual(outcomes.map((r) => r.status).sort(), [201, 409]);
      const pending = outcomes.find((r) => r.status === 201).body;
      await api(
        `/api/v1/households/${household.id}/invitations/${pending.id}`,
        owner,
        { method: "DELETE", status: 204 },
      );
      await api(
        "/api/v1/invitations/accept",
        await token(pending.email.split("@")[0]),
        { method: "POST", body: { token: pending.token }, status: 409 },
      );
      const again = await api(
        `/api/v1/households/${household.id}/invitations`,
        owner,
        {
          method: "POST",
          body: { email: "member@example.invalid" },
          status: 201,
        },
      );
      const outcomes2 = await Promise.all(
        [0, 1].map(async () => {
          const response = await fetch(base + "/api/v1/invitations/accept", {
            method: "POST",
            headers: {
              "Cf-Access-Jwt-Assertion": member,
              Origin: appOrigin,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: again.token }),
            signal: AbortSignal.timeout(15000),
          });
          return response.status;
        }),
      );
      assert.deepEqual(outcomes2.sort(), [201, 409]);
      assert.equal(
        (await api(`/api/v1/households/${household.id}/members`, owner)).members
          .length,
        2,
      );
      assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
      await api(
        `/api/v1/households/${household.id}/members/${memberId}`,
        owner,
        { method: "DELETE", status: 204 },
      );
      const expired = await api(
        `/api/v1/households/${household.id}/invitations`,
        owner,
        {
          method: "POST",
          body: { email: "member@example.invalid" },
          status: 201,
        },
      );
      await query(
        "UPDATE household_invitations SET expires_at=unixepoch()-1 WHERE status='pending'",
      );
      await api("/api/v1/invitations/accept", member, {
        method: "POST",
        body: { token: expired.token },
        status: 409,
      });
    },
  );
  console.log(
    `Household access verification passed (${groups} groups; actual Worker and disposable local D1).`,
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
  if (serving) {
    console.log(
      `Browser verification fixture ready: ${base}/_verification/sign-in/owner (also member/newcomer). Ctrl-C cleans up.`,
    );
    await new Promise(() => {});
  }
} catch (error) {
  console.error(error.stack || error);
  if (server) console.error(server.output());
  process.exitCode = 1;
} finally {
  await cleanup();
}
