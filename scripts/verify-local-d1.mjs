import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every command targets the same disposable local simulator; never the default state.
const persist = await mkdtemp(join(tmpdir(), 'finance-d1-verify-'));
const wrangler = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const common = ['--local', '--env', 'local', '--persist-to', persist];
const logs = [];
const children = new Set();
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
let server;

function launch(args) {
  const child = spawn(process.execPath, [wrangler, ...args], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('close', () => children.delete(child));
  let output = '';
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const capture = (data) => { output = (output + data.toString()).slice(-100000); };
  let stdout = '';
  child.stdout.on('data', (data) => { stdout += data.toString(); capture(data); });
  child.stderr.on('data', capture);
  return { child, output: () => output, stdout: () => stdout, error: () => spawnError, args };
}
function signal(child, name) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function stop(proc) {
  if (!proc || (proc.child.exitCode !== null || proc.child.signalCode !== null)) return;
  const done = new Promise((resolve) => proc.child.once('close', resolve));
  signal(proc.child, 'SIGTERM');
  const timer = setTimeout(() => signal(proc.child, 'SIGKILL'), 3000);
  await done;
  clearTimeout(timer);
}
async function command(args) {
  const proc = launch(args);
  const timeout = setTimeout(() => signal(proc.child, 'SIGKILL'), 60000);
  try {
    const result = await new Promise((resolve, reject) => {
      proc.child.once('error', reject);
      proc.child.once('close', (code, sig) => resolve({ code, sig }));
    });
    logs.push(`$ wrangler ${args.join(' ')}\n${proc.output()}`);
    assert.equal(result.code, 0, `Wrangler command failed (${result.sig ?? result.code}): ${args.join(' ')}`);
    return proc.stdout();
  } finally { clearTimeout(timeout); }
}
async function query(sql) {
  const output = await command(['d1', 'execute', 'DB', ...common, '--command', sql, '--json']);
  const result = JSON.parse(output);
  assert.ok(Array.isArray(result) && result[0]?.success, 'Unexpected D1 JSON result');
  return result[0].results;
}
async function start() {
  const proc = launch(['dev', ...common, '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0']);
  server = proc;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const match = proc.output().match(/Ready on https?:\/\/127\.0\.0\.1:(\d+)/i);
    if (match) return `http://127.0.0.1:${match[1]}`;
    if (proc.error()) throw proc.error();
    if (proc.child.exitCode !== null || proc.child.signalCode !== null) throw new Error('Wrangler dev exited before becoming ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Wrangler dev');
}
async function request(base, path, options, status) {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, status, `${options?.method ?? 'GET'} ${path}: unexpected HTTP status`);
  return response;
}
async function cleanup() {
  await Promise.all([...children].map((child) => stop({ child })));
  await rm(persist, { recursive: true, force: true });
}
for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(name, () => { void cleanup().finally(() => process.exit(code)); });
}

async function verify() {
  await command(['d1', 'migrations', 'apply', 'DB', ...common]);
  const initialHistory = await query('SELECT id, name, applied_at FROM d1_migrations ORDER BY id');
  assert.ok(initialHistory.some((row) => row.name === '0001_infrastructure_probe.sql'), 'Probe migration is missing');
  assert.deepEqual(await query('SELECT id, value FROM infrastructure_probe ORDER BY id'), []);

  let base = await start();
  assert.deepEqual(await (await request(base, '/api/health', {}, 200)).json(), { status: 'ok', database: 'ok' });
  assert.ok((await (await request(base, '/api/hello', {}, 200)).json()).message);
  await request(base, '/api/not-a-real-route', {}, 404);
  assert.match(await (await request(base, '/a-client-route', {}, 200)).text(), /<html/i);
  await request(base, '/api/infrastructure/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: '' }) }, 400);
  const value = "D1 quote ' and Unicode: Živeli ☕";
  const created = await (await request(base, '/api/infrastructure/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }, 201)).json();
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(created.value, value);
  assert.deepEqual(await (await request(base, `/api/infrastructure/probe/${created.id}`, {}, 200)).json(), created);
  await stop(server);
  logs.push(`$ wrangler ${server.args.join(' ')}\n${server.output()}`);
  server = undefined;

  const rowsBefore = await query('SELECT id, value FROM infrastructure_probe ORDER BY id');
  assert.deepEqual(rowsBefore, [created]);
  await command(['d1', 'migrations', 'apply', 'DB', ...common]);
  assert.deepEqual(await query('SELECT id, name, applied_at FROM d1_migrations ORDER BY id'), initialHistory);
  assert.deepEqual(await query('SELECT id, value FROM infrastructure_probe ORDER BY id'), rowsBefore);

  base = await start();
  assert.deepEqual(await (await request(base, `/api/infrastructure/probe/${created.id}`, {}, 200)).json(), created);
  await request(base, `/api/infrastructure/probe/${created.id}`, { method: 'DELETE' }, 204);
  await request(base, `/api/infrastructure/probe/${created.id}`, {}, 404);
  await stop(server);
  logs.push(`$ wrangler ${server.args.join(' ')}\n${server.output()}`);
  server = undefined;
  assert.deepEqual(await query('SELECT id, value FROM infrastructure_probe ORDER BY id'), []);
  console.log('Local D1 migration, replay, Worker API, and cleanup verified.');
}

try {
  await verify();
} catch (error) {
  console.error(`Local D1 verification failed: ${error.stack ?? error}`);
  if (server) logs.push(`$ wrangler ${server.args.join(' ')}\n${server.output()}`);
  console.error(logs.join('\n'));
  process.exitCode = 1;
} finally {
  await cleanup();
}
