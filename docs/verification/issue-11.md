# Issue #11 — atomic transfers

The shared transaction API accepts actual debit/credit amounts for distinct
same-currency or FX accounts, with an optional source-account fee expense.
Transfers support idempotent creation, versioned full replacement and void.
See the [API](../api/transfers.md) and [database protocol](../database/transfers.md).
Manual Angular entry remains issue #13.

## Implementation and validation

Migration 0008 adds transfer details, scoped foreign keys, in-batch assertions
and a reporting view. Principal is excluded from income/expense/budget reporting;
the fee contributes once. Ordinary transaction list/detail reads use Prisma with
live household membership in their scoped queries and eager relation includes.
Financial writes and their snapshots use the shared posting repository's D1
batch protocol because the Prisma D1 adapter does not support transactions.
Assertions, movements, fee lifecycle, audit and idempotency state commit together.
Money uses integer minor units and exact decimal conversion; JSON amounts are
strings. Existing expense/income contracts and cursor ordering are preserved.

All mutation checks use synthetic data in disposable local D1 with native
Workerd, production authentication and API handlers. No production migration,
deployment or financial-data mutation was performed for this task.

| Command | Observed result |
| --- | --- |
| `npm --prefix backend test` | 100 tests across 13 files passed. |
| `npm --prefix backend run lint` | Passed. |
| `cd backend && ./node_modules/.bin/nest build` | Backend specialist observed production compilation passing. |
| `npm --prefix frontend run build` | Passed. |
| `npm --prefix frontend test -- --watch=false` | 22 tests across 6 files passed. |
| `npm run verify:prisma` | All 22 Prisma models match migrated columns, nullability and monetary types. |
| `node scripts/verify-schema.mjs` | 13 migration groups and 21 scoped relationship rejection cases passed. |
| `node scripts/verify-transactions.mjs` | Backend specialist observed all 14 existing native transaction groups passing. |
| `node scripts/verify-accounts.mjs` | All 13 existing native account groups passed. |
| `node scripts/verify-transfers.mjs` | Tester observed all 10 native Workerd/D1 groups passing, including the strengthened late edit/void rollback check. |
| `node scripts/verify-access.mjs` | All 10 native authentication/household access groups passed. |
| `XDG_CONFIG_HOME=/tmp/finance-cloudflare-config WRANGLER_SEND_METRICS=false node scripts/verify-local-d1.mjs` | Migration, replay, Worker API and cleanup passed; initial run required writable CLI log configuration. |

Normal local Prisma engine validation/download returned HTTP 403 from the engine
host. An environment-only `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` override allowed
the Workerd generator to use its bundled WASM path and produce the fresh client;
no fake binary, dependency or override is committed. Native D1 checks use this
actual generated client. Clean GitHub CI runs normal Prisma validation and client
generation without the override. A plain all-files TypeScript check also reported
two pre-existing D1 mock type mismatches; the production tsconfig compiled.

## Acceptance evidence

- 12,000 RSD principal plus a 100 RSD fee debits 12,100, credits 12,000 and
  contributes 100 expense through the fee child only. The test uses 1,200,000
  and 10,000 minor units. FX 650 EUR → 78,000 RSD uses 65,000 and 7,800,000
  actual minor units and contributes zero income/expense.
- Distinct accounts, same-currency equality, safe positive minor amounts,
  account currencies, household/category isolation and active expense fee
  eligibility are checked through the actual API. Fee plus reserves cannot
  exceed available funds; destination balance cannot exceed safe storage.
- Six simultaneous identical-key posts return one original snapshot and create
  one parent, two principal movements, one fee, one fee movement and one key.
  A different posting kind conflicts in the same key namespace. Replay keeps
  the original response after an edit or void.
- Adding, editing and removing a fee changes balances atomically, reuses the
  current fee when appropriate, voids removed fees and rejects stale versions.
  Direct fee void is rejected. Scoped Prisma detail/list reads preserve string
  amounts and reject inaccessible households or revoked memberships.
- Injected failures at the second principal leg, fee child, audit, idempotency
  key and response snapshot leave all transaction/detail/fee/movement/audit/key/
  request counts and balances unchanged. The same key succeeds after removing
  each injected failure. An ignored movement insert also aborts the batch.
- Edit/void rollback is injected at the final audit update, after financial
  mutations. Counts, balances and complete parent/fee API reads (including
  status/version) equal their pre-failure snapshots. Foreign-key checks are clean.

The dedicated transfer verifier does not yet exercise concurrent edits,
recipient-spent-funds void rejection, archived old-account edits/voids, foreign
fee rounding, or membership revocation injected between preflight and its batch.
The shared legacy verifiers cover related batch-access, amount-conversion and
version behavior; they do not substitute for those transfer-specific cases.
Independent read-only review found no actionable defect. It traced concurrent
edit, spent-recipient void, archived old-account and foreign-fee rounding paths
to the SQL/version/conversion assertions; it did not rerun the verifier.

## Sequential specialist handoffs and telemetry

Database → backend → tester → reviewer run one at a time, following the merged
agent instructions. The orchestrator owns contract alignment, CI wiring, regression
checks, documentation and PR delivery. No frontend specialist is needed for this
API/ledger issue. Intervals below include tools and waits, measured from each
agent's first clock reading; they do not measure active model compute time.
Times are Europe/Belgrade (CET) on 2026-11-17.

| Agent | Requested model / reasoning | Contribution | Measured interval |
| --- | --- | --- | --- |
| `/root` | Unavailable | Coordination, integration, verification and PR | Task starts 19:48:18; elapsed reported at delivery. |
| `/root/transfers_database` | `gpt-6.1-terra` / medium | Migration, assertion protocol, contracts and Prisma relations | 19:51:48–19:55:34; 3m46s. |
| `/root/transfers_backend` | `gpt-6.1-terra` / medium | Validation, posting/edit/void, Prisma reads, unit tests and API docs | 19:57:21–20:05:11; 7m50s. |
| `/root/transfers_tester` | `gpt-6-luna` / medium | Independent native API/D1 acceptance and rollback verifier | Partial interval 20:11:43–20:16:47; 5m04s. Earlier work and successful late-rollback follow-up were not fully timed. |
| `/root/transfers_review` | `gpt-6-luna` / high | Independent read-only financial/access review; no actionable findings | 20:18:58–20:21:05; 2m07s. |

Effective model/reasoning and per-agent input/output/cached token telemetry are
unavailable. Profile/launch settings above are requested settings, not proof of
effective runtime settings. Missing telemetry is not estimated.

## Skills and references actually read and applied

All skill instructions were read as documents; no bundled skill script was run.
NestJS TypeORM examples were adapted to this project's D1 batch and Prisma
constraints. Repository paths below are relative to the repository root.
The cloud package alias `c3` resolves to
`skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3`;
each listed package/reference suffix identifies its complete provider resource.

- Orchestrator: `.agents/skills/nestjs-best-practices/SKILL.md`,
  `rules/db-use-transactions.md` and `rules/security-validate-all-input.md` under
  that skill; checked atomic boundaries and strict validation. Cloud packages
  `c3/wrangler` and `c3/workers-best-practices`, including
  `workers-best-practices/references/runtime-patterns.md`; used pinned tools,
  isolated local bindings, actual Workers runtime tests and awaited writes.
  Cloudflare docs retrieved: `https://developers.cloudflare.com/d1/worker-api/d1-database/`,
  `https://developers.cloudflare.com/d1/best-practices/local-development/` and
  `https://developers.cloudflare.com/workers/wrangler/commands/d1/`.
  Also read `.agents/skills/angular-developer/SKILL.md` and its
  `references/testing-fundamentals.md` and `references/cli.md` while checking the
  existing Angular CLI regression checks; no Angular source or tests changed.
- Database: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/db-use-transactions.md`, `rules/db-use-migrations.md`,
  `rules/db-avoid-n-plus-one.md`, `rules/security-validate-all-input.md`,
  `rules/security-use-guards.md`; cloud package `c3/cloudflare` and its
  `references/d1/README.md`, `api.md`, `patterns.md`, `gotchas.md`,
  `configuration.md` (all five under `references/d1/`). Applied D1 transactions,
  forward migrations, scoped integrity and eager Prisma relations.
- Backend: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/arch-use-repository-pattern.md`, `rules/di-prefer-constructor-injection.md`,
  `rules/security-validate-all-input.md`, `rules/security-use-guards.md`,
  `rules/error-throw-http-exceptions.md`, `rules/db-use-transactions.md`,
  `rules/db-avoid-n-plus-one.md`, `rules/test-mock-external-services.md`,
  `rules/api-use-pipes.md`. Applied repository separation, constructor injection,
  validated boundaries, scoped access, sanitized errors and atomic writes.
- Tester: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/test-e2e-supertest.md`, `rules/security-use-guards.md`,
  `rules/security-validate-all-input.md`, `rules/db-use-transactions.md`.
  Applied observable HTTP tests, access/validation boundaries and rollback with
  disposable D1. Used the existing native Workerd harness instead of Node
  Supertest to exercise real bindings. Its cloud skill discovery exposed no
  D1/Workers skills; the orchestrator/database specialist independently read
  the Cloudflare references listed above.
- Reviewer: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/db-use-transactions.md`, `rules/db-use-migrations.md`,
  `rules/arch-use-repository-pattern.md`, `rules/security-validate-all-input.md`,
  `rules/security-use-guards.md`, `rules/error-throw-http-exceptions.md`,
  `rules/error-handle-async-errors.md`; cloud `c3/workers-best-practices` and its
  `references/runtime-patterns.md`; `c3/cloudflare` and its
  `references/d1/README.md`, `references/d1/api.md`, `references/d1/patterns.md`,
  `references/d1/gotchas.md`. Applied atomic/in-batch assertions, parameterized
  queries, membership scope and runtime behavior checks.
