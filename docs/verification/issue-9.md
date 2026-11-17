# Issue #9 verification

## Scope and environment

Atomic expense/income posting, household API, idempotency snapshots, versioned
edits and voids. NestJS 12, Prisma 7.10.1 with its D1 adapter, Wrangler 4.163.0,
Node 24.22.1, compatibility date 2026-11-16. Prisma does not support atomic
transactions on D1; financial writes intentionally use the D1 binding's batch.

All mutation tests use synthetic records in disposable local D1. The verification
Worker wraps the production Worker and native email/password authentication.
Its SQL diagnostics and permission-race route are generated in a temporary local
fixture, never registered in the production application. Remote credentials are
removed from test child processes; every migration command specifies `--local`.
Temporary state and child processes are cleaned up after success or failure.

## Executed checks

| Check | Observed result |
| --- | --- |
| `npm --prefix backend test` | 53 tests passed in 12 files, including 19 new API input tests. |
| `npm --prefix backend run lint` | Passed. |
| `npm run verify:prisma` | 21 persistent table models match migrated SQLite columns, types and nullability. |
| `cd backend && ./node_modules/.bin/nest build` | Compiled backend using the installed generated Prisma client. |
| `node scripts/verify-transactions.mjs` | 14 native Workerd/D1 scenario groups passed. |
| `node scripts/verify-schema.mjs` | 13 groups and 21 scoped relationship rejection cases passed, including upgrade preservation and migration replay. |
| `git diff --check` | Passed. |

The native transaction suite verifies:

- Missing sessions, invalid origins, inaccessible households, invalid dates,
  invalid/unsafe amounts, unknown input fields and missing keys retain no writes.
- Eight concurrent identical requests produce one transaction, one movement,
  one audit record and one saved key/result. Changed-payload reuse conflicts.
  Replays return the original snapshot after account archival, edits and voids.
- Edits and voids preserve the original author and advance versions. Balances
  and expense/income contributions reflect current state. Concurrent versioned
  edits have one winner and one conflict.
- Two concurrent expenses competing for funds have one winner. Currency/account
  mismatch, wrong-household references, archived accounts/categories, ineligible
  categories and unavailable reserved funds fail without financial writes.
- Moving an expense between accounts restores the source balance. A spent
  income cannot be reduced or voided if that would overdraw its account.
- Equivalent FX rates normalize to one idempotent request. Signed half-up
  movement snapshots preserve exact original and RSD amounts.
- Errors injected at audit/key writes roll back transaction, movement, audit,
  original-result snapshot and idempotency state; the failed key can be retried.
- Failed edits/voids restore old versions and movements. Suppressed required
  updates, including unchanged-value updates, fail inside SQL and roll back.
- A revocation injected after the permission preflight but inside the write
  batch fails the live membership assertion and retains no financial changes.
- Incoming/outgoing parent links are protected until linked workflows exist.
  Cursor pages are bounded/scoped without duplicate records; revoked members
  cannot subsequently read or write. Foreign key checks remain clean.

The GitHub Prisma/D1 workflow runs clean installation, Prisma validation and
client generation, both application builds, tests/lint and native integration.
Locally Prisma's engine download returned HTTP 403, so the local backend build
used the already installed generated client. New financial tables are written
through D1 batches; a clean generated-client build is checked separately in CI.
The full test TypeScript configuration also reports pre-existing D1 mock typing
errors in two unrelated e2e specs; the production build and lint pass.

## Review and implementation reports

The database and API specialists worked on separate files in parallel. The
orchestrator integrated them, wrote the native verification suite, ran checks
and addressed review findings. Independent review identified an incoming parent
link edge; the SQL guard and native regression case cover both link directions.

All three implementation participants read and applied
`.agents/skills/nestjs-best-practices/SKILL.md`. Relevant rules actually read:

- Orchestrator: `arch-use-repository-pattern.md`,
  `di-prefer-constructor-injection.md`, `security-validate-all-input.md`,
  `db-use-transactions.md`, `test-mock-external-services.md`.
- Database: `arch-use-repository-pattern.md`,
  `di-prefer-constructor-injection.md`, `db-use-transactions.md`,
  `db-use-migrations.md`.
- API: `arch-single-responsibility.md`, `arch-use-repository-pattern.md`,
  `di-prefer-constructor-injection.md`, `security-validate-all-input.md`,
  `security-use-guards.md`, `error-throw-http-exceptions.md`,
  `api-use-pipes.md`, `db-use-transactions.md`.
- Reviewer: `db-use-transactions.md`, `db-use-migrations.md`,
  `security-validate-all-input.md`, `security-use-guards.md`,
  `error-throw-http-exceptions.md`, `perf-optimize-database.md`,
  `devops-use-logging.md`.

All rule paths above are under
`.agents/skills/nestjs-best-practices/rules/`. Guidance applied: injected
repository, thin controllers, strict validation, current membership guards,
parameterized queries, migrations and database-side atomic rollback. Existing
Worker validation and D1 batch replace class-validator and TypeORM examples.

The orchestrator also read/applied `c3/workers-best-practices`, its
`references/runtime-patterns.md`, and `c3/wrangler`: preserve installed versions,
use bindings, await financial writes, isolate local resources and verify in
native Workerd. Existing Wrangler-based integration replaces the skill's
Vitest pool example without adding dependencies. Official
[D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
was retrieved through Cloudflare docs and confirms sequential transactional
rollback. The reviewer also read the Workers runtime skill and Cloudflare D1
reference materials; direct documentation retrieval in its environment failed.

Requested specialist models: database/API `gpt-6.1-terra`, medium reasoning;
reviewer `gpt-6-luna`, high reasoning. Effective model/reasoning and per-agent
input/output/cached token telemetry are unavailable. The orchestrator's exact
model and reasoning metadata are unavailable. Configurations are requested
labels, not proof of effective runtime settings.

Measured initial specialist intervals (including tools/waits): database
15:37:29–15:41:21 UTC (3m52s), API 15:37:39–15:41:14 UTC (3m35s), on
2026-11-17. These are partial intervals; initial dispatch and subsequent fixes
are not fully covered. Reviewer start/elapsed telemetry is unavailable; initial
review ended at 15:46:59 UTC. Overall task starts at 15:35:59 UTC; final elapsed
time is reported with delivery and includes tools and waits.

## Handoff

No production deployment, production migration, account data migration or new
UI is part of this issue. Migration 0006 is additive. Accounts/opening balances
follow in #10; transfer/refund/reserve/import workflows must extend the shared
atomic engine. Manual-entry screens and advanced filters follow in #13. The
API currently accepts only expense/income and rejects changes with linked data.
