import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from '../backend/node_modules/typescript/lib/typescript.js';

const root = new URL('../', import.meta.url);
function readConfig(path) {
  const { config, error } = ts.parseConfigFileTextToJson(
    path,
    readFileSync(new URL(path, root), 'utf8'),
  );
  assert(!error, `Invalid JSONC in ${path}`);
  return config;
}

export function verifyPreviewConfig(worker, migrations) {
  const preview = worker.previews?.d1_databases?.find(db => db.binding === 'DB');
  const target = migrations.d1_databases?.find(db => db.binding === 'PREVIEW_DB');
  assert(preview && target, 'Both preview D1 bindings must be configured');
  assert.match(preview.database_id ?? '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.equal(migrations.account_id, worker.account_id, 'Preview accounts must match');
  assert.equal(target.database_id, preview.database_id, 'Preview database IDs must match');
  assert.equal(target.database_name, preview.database_name, 'Preview database names must match');
  assert.equal(target.migrations_dir, 'backend/migrations');
  const normalBindings = [worker, ...Object.values(worker.env ?? {})]
    .flatMap(env => env.d1_databases ?? []);
  assert(!normalBindings.some(db => db.database_id?.toLowerCase() === preview.database_id.toLowerCase()),
    'Preview migrations must never target a normal deployment database');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyPreviewConfig(readConfig('wrangler.jsonc'), readConfig('wrangler.preview-migrations.jsonc'));
  console.log('Preview deployment and migrations use the same isolated D1 database.');
}
