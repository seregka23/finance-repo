# Production readiness for Family Finance

Issue [#22](https://github.com/seregka23/finance-repo/issues/22) records MVP acceptance in the [scenario matrix](issue-22.md). This page covers the deployment target, recovery drill and decisions needed for launch. The app's default and named `test` environments use `family-finance-test`, while branch previews use `family-finance-preview`. The named `production` environment still has a placeholder D1 UUID and no configured hostname.

## Start and verify locally

Use the repository's supported Node 24 version and run these from the repository root:

```sh
npm ci
npm run db:migrate:local
npm run dev:cloudflare
```

The development script builds Angular and NestJS, then starts Wrangler with `--env local --local` on `http://localhost:8787`. The local `DB` binding uses the simulator and `backend/migrations`. Verify `GET /api/health` returns `{"status":"ok","database":"ok"}`. Register with a synthetic address, create a test household, and verify a saved record through a separate browser session. For a clean disposable store, `npm run verify:local` rebuilds, migrates and tests the Worker/D1 round trip. See the [database migration guide](../database/migrations.md).

## D1 Time Travel drill

On 2026-11-26, the Cloudflare API created `finance-repo-issue22-recovery-20261126-0922` as a separate disposable D1 database. Its `recovery_probe` table contained only synthetic data. The Cloudflare connection used the repository's account and the exact newly created database ID. The observed operation sequence was:

| Operation | Expected | Observed |
| --- | --- | --- |
| Create baseline through D1 Query | One `baseline` row at `12000` minor units | One row at `12000` |
| Read current Time Travel bookmark | A restorable point after the baseline write | Cloudflare returned a bookmark |
| Insert a later `after-bookmark` row at `-100` | Two rows and a sum of `11900` | Both rows read back with those values |
| Restore the baseline bookmark | Restore accepted for the disposable database | Cloudflare returned the restored and previous bookmarks |
| Read restored state and check foreign keys | Only `baseline` at `12000`, zero foreign-key violations | Expected row and zero violations |
| Clean up the disposable database | The new database is deleted | Cloudflare confirmed deletion |

The drill used the D1 `/query`, `/time_travel/bookmark` and `/time_travel/restore` API endpoints. Local Worker/D1 coverage is in the [acceptance matrix](issue-22.md). Read-only Cloudflare metadata confirmed that the default Worker's `workers.dev` route was enabled, `APP_ENVIRONMENT` was `test` and its `DB` binding pointed to `family-finance-test`. A remote Worker write/read smoke test remains blocked. Automatic approval review rejected creation of a temporary network-accessible Worker with a D1 binding, and the execution environment's proxy rejected a read-only HTTP request to the existing default Worker with a CONNECT 403. The remote recovery evidence comes from the D1 control plane.

### Repeat the recovery drill

Use `wrangler whoami` to confirm the intended account. Create a uniquely named scratch D1 database, then prepare a temporary Wrangler config containing only its `DB` binding and exact UUID. Keep the temporary config and credentials outside version control. In the commands below, `DRILL_DATABASE` is the scratch database name, `DRILL_CONFIG` is the path to that scratch config and `DRILL_BOOKMARK` is the bookmark returned after seeding.

```sh
npx wrangler d1 info "$DRILL_DATABASE" --config "$DRILL_CONFIG"
npx wrangler d1 execute DB --config "$DRILL_CONFIG" --remote \
  --command "CREATE TABLE recovery_probe (id TEXT PRIMARY KEY, amount_minor INTEGER NOT NULL); INSERT INTO recovery_probe VALUES ('baseline', 12000)"
npx wrangler d1 time-travel info DB --config "$DRILL_CONFIG" --json
```

Write a second synthetic record, read back both records and verify the UUID again. Restore changes the whole named database in place. Run it only after checking that the scratch binding points at the database created for this drill.

```sh
npx wrangler d1 execute DB --config "$DRILL_CONFIG" --remote \
  --command "INSERT INTO recovery_probe VALUES ('after-bookmark', -100); SELECT * FROM recovery_probe ORDER BY id"
npx wrangler d1 time-travel restore DB --config "$DRILL_CONFIG" --bookmark "$DRILL_BOOKMARK"
npx wrangler d1 execute DB --config "$DRILL_CONFIG" --remote \
  --command "SELECT * FROM recovery_probe ORDER BY id; PRAGMA foreign_key_check"
```

Read back the expected baseline, verify the later record is absent and run `PRAGMA foreign_key_check`. Record the old and restored bookmarks in the private operator log, then clean up the drill resources. For recovery of a real environment, first pause writes and record post-bookmark changes that would need replay. Reconcile migration history, household authorization and financial totals before reopening writes. [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

## Launch decisions

| Decision | Current behavior | Confirmation needed |
| --- | --- | --- |
| Authentication | Native email/password sign-in with D1-backed sessions and household invitations. Email ownership verification and self-service recovery are absent. | Confirm the production account enrollment and recovery policy, including how an operator verifies identity. [Authentication contract](../authentication.md) |
| Hosting and environment | Angular assets and NestJS API share a Cloudflare Worker origin. The production config disables `workers.dev` and preview URLs. | Supply a production hostname and a dedicated D1 UUID, and confirm the Cloudflare account and build/deployment target. The known default Worker URL is a test target. |
| Personal and business visibility | Active members can view the household's shared accounts. Ownership is a label. | Household members confirm shared visibility for both account types before historical data moves. |
| Notion after cutover | The historic trial accepts approved snapshot files. | Decide whether Notion is an archive, remains a place for entry or participates in sync. For sync, agree on direction, record ownership, edits and deletions. Approve source watermarks and independent totals. [Historical trial](../database/historical-trial.md) |
| Category provider | `CATEGORY_DECISION_PROVIDER` defaults to `openai`. `gemini` is also supported for category selection. Extracting text and images still requires OpenAI. Manual category selection remains available. | Select the launch provider and verify model access and data controls using synthetic SMS and receipt data. Keep API keys in the selected Worker's secrets. [Provider contract](../api/recognition.md#provider-and-privacy) |

## Prepare the approved production target

1. Agree on the decisions above and record the source, cutoff and recovery plan. Configure the approved hostname on the production Worker so Angular and `/api/*` share the same HTTPS origin.
2. Set `env.production.d1_databases` in `wrangler.jsonc` to the independently provisioned production database. Keep the binding `DB` and migrations path `backend/migrations`. Verify the UUID differs from default/test, preview and the local simulator. Keep `APP_ENVIRONMENT=production` and the infrastructure probe disabled.
3. Build and package-check that target with `npm ci`, `npm run build` and `npx wrangler deploy --env production --dry-run`. Review the exact target and use `npx wrangler d1 migrations list DB --env production --remote` to inspect migration history. Dry-run packaging and migration listing are separate checks.
4. After explicit launch approval, capture the recovery bookmark and use `npx wrangler d1 migrations apply DB --env production --remote`, then `npx wrangler deploy --env production` in the agreed deployment workflow. The root default deployment scripts target the existing test Worker.
5. Record the verified HTTPS URL and check `/api/health`, registration and login, a synthetic household write/read, cross-session persistence and selected-provider fallback. Reconcile before importing historical financial data. Confirm the write source and rollback criteria before cutover.
