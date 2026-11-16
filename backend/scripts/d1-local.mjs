import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Simulator-only identifier, shared with the development binding in the config.
// This helper never forwards arbitrary CLI arguments or targets a remote database.
const databaseId = '00000000-0000-4000-8000-000000000001';
const backend = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/cf/bin/cf', import.meta.url));
const persistence = fileURLToPath(new URL('../.cloudflare/state', import.meta.url));

function run(args) {
  const result = spawnSync(process.execPath, [
    cli, ...args, '--local', '--mode', 'development', '--persist-to', persistence,
  ], {
    cwd: backend,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `cf exited with status ${result.status}`);
  }
  return result.stdout;
}

function migrate() {
  process.stdout.write(run(['d1', 'migrations', 'apply', databaseId, '--dir', 'migrations']));
}

function query(sql, params = []) {
  const output = run(['d1', 'raw', databaseId, '--body', JSON.stringify({ sql, params })]);
  const payload = JSON.parse(output);
  const results = Array.isArray(payload) ? payload : payload.result;
  assert.ok(Array.isArray(results), 'Expected D1 raw query results');
  assert.equal(results[0]?.success, true, 'D1 query failed');
  return results[0].results;
}

const command = process.argv[2];
if (process.argv.length !== 3 || !['migrate', 'smoke'].includes(command)) {
  throw new Error('Usage: node scripts/d1-local.mjs migrate|smoke (local simulation only)');
}

migrate();
if (command === 'smoke') {
  // Run the native migration command twice to exercise its recorded history.
  migrate();
  const id = randomUUID();
  const value = "local probe: quote ' and Unicode č";
  try {
    query('INSERT INTO infrastructure_probe (id, value) VALUES (?, ?)', [id, value]);
    const result = query('SELECT value FROM infrastructure_probe WHERE id = ?', [id]);
    assert.deepEqual(result.rows, [[value]], 'D1 did not return the parameterized value');
  } finally {
    query('DELETE FROM infrastructure_probe WHERE id = ?', [id]);
  }
  assert.deepEqual(query('SELECT id FROM infrastructure_probe WHERE id = ?', [id]).rows, []);
  console.log('Local D1 migration replay, parameterized write/read, and cleanup passed.');
}
