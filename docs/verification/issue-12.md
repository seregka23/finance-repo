# Issue #12 — linked partial refunds

Refunds use the shared transaction API and link to an expense purchase. The
server inherits category, currency, rate and conversion source, and credits an
active same-currency account. Refunds reduce spending at their credit date;
purchase-month figures are not moved to another month. Reserve allocations are
not automatically restored. See the [API](../api/refunds.md) and
[database protocol](../database/refunds.md).

## Implementation and integrity

Migration 0009 adds scoped refund details and permanent allocation order,
purchase protection and pre/post/bulk-count SQL assertions. Normal reads use
Prisma with current household membership scope. Financial writes, their
assertions and result snapshots use one D1 batch because the Prisma D1 adapter
does not support transactions.

The existing `cumulativeRefundRsd` helper allocates original-rate half-up
rounding by cumulative refunded amounts. A full refund offsets the recorded
purchase RSD exactly; a partial allocation may be zero. Editing or voiding an
earlier refund reallocates later posted refunds and versions/audits changed
siblings. Each refund operation increments the purchase version using a
guarded update, serializing it with purchase edits and other refunds.

Posted refunds prevent purchase void, reduction below their sum, or changes to
purchase type/category/currency/rate/source. Compatible amount and metadata
edits remain possible. Once all refunds are voided, their retained history does
not block purchase void. Refund links are immutable. Credit removal must respect
current balances and reserves. Historical archived expense categories may be
inherited; an archived purchase account does not block a refund into a different
active account in that currency.

Missing/inconsistent legacy conversion snapshots return a documented 409;
the application does not invent a rate. No separate frontend entry form is
introduced: manual transaction entry remains issue #13.

## Observed checks

| Command/check | Observed result |
| --- | --- |
| Database migration/guard smoke | Native SQLite applied migrations 0001–0009, preserved a legacy purchase and passed foreign-key checks and ceiling/eligibility/purchase guards. |
| Complete result-guard fixture | Successful refund, movement, purchase, audit and key fixture passed; wrong expected currency/audit contents aborted. |
| `npm run verify:prisma` | All 23 models match migrated columns, nullability and monetary types. |
| `node scripts/verify-schema.mjs` | 13 native migration groups and 21 scoped relationship rejection cases passed. |
| `npm --prefix backend test` | Backend specialist observed 110 tests passing. |
| `npm --prefix backend run lint` | Backend specialist observed passing. |
| Production build / Nest compile | Full build passed with local engine-download workaround; final Nest build passed after the batch snapshot SELECT. |
| Native refund smoke | Backend specialist observed post, zero allocation, edit/sibling reallocation, void, original replay and list passing in Workerd/D1. |
| `node scripts/verify-transactions.mjs` | All 14 existing native transaction groups passed. |
| `node scripts/verify-transfers.mjs` | All 10 existing native transfer groups passed. |
| `node scripts/verify-accounts.mjs` | All 13 existing native account groups passed. |
| `node scripts/verify-refunds.mjs` | Independent tester observed all 13 native Workerd/D1 groups passing; syntax, formatting and cleanup checks passed. |

Normal local Prisma client generation returned HTTP 403 from the engine checksum
host. An environment-only `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` enabled the
Workerd generator's bundled WASM path and produced the fresh client. No override,
fake binary or dependency change is committed. Clean CI uses normal validation
and generation. Direct Cloudflare documentation retrieval also failed for the
backend specialist; it used the repository's D1 contract and native runtime
verification. The orchestrator had already retrieved the D1 batch documentation
through the Cloudflare connector.

All mutation verification uses synthetic data in disposable local D1. No
production migration, deployment or financial-data mutation was performed.

The independent refund verifier covers January/February spending and balances,
unchanged purchase-linked reserves, exact `1/0/1` FX allocations, early edit/void
reallocation with sibling versions/full audits, permanent sequences, large exact
rates and safe bounds, inherited/immutable fields, archival and household scope,
purchase ceilings/protected fields/compatible edits, spent/reserved credit removal,
and historical voids. Six concurrent same-key full refunds all return one
original snapshot with one child/key/claim/purchase bump. Different-key overrefund
and purchase edit/void races enforce the current state.

Eight post and five late edit/void ABORT/IGNORE injections compare complete
persisted rows and balances before/after failures, followed by successful retries.
Real Prisma GET/list pagination and an actual D1 batch membership-revocation
injection pass. Foreign keys remain clean and temporary fixture directories are
removed. Remaining dedicated-verifier gaps: under-ceiling independent-post retry
behavior and exhaustive import/receipt/reserve-link permutations.

Independent read-only review found no actionable correctness, security or
accounting issue. It checked migration/helper/result guards, replay before
mutable state, parent serialization, sibling audits, historical void context,
archive/reserve behavior and actual D1 batch/limit documentation. Direct diff
and verifier-syntax checks passed. It inspected the verifier and execution
reports without rerunning the full suites; its coverage limits are separate
from the executed tester/root results above.

## Sequential agents, skills and metrics

Database → backend → independent tester → independent reviewer are scheduled
one at a time. The orchestrator owns integration, CI wiring, legacy regression
checks, documentation and PR delivery. Measured intervals include tool execution
and waits, not active model compute. Times are Europe/Belgrade (CET) on
2026-11-17; subagent intervals start at their first available clock reading.

| Agent | Requested model / reasoning | Contribution | Measured interval |
| --- | --- | --- | --- |
| `/root` | Unavailable | Coordination, integration, checks and PR | Starts 21:23:50; final elapsed at delivery. |
| `/root/refunds_database` | `gpt-6.1-terra` / medium | Migration, guards, Prisma and contracts | 21:27:11–21:31:42, 4m31s; guard correction 21:32:30–21:33:17, 47s. |
| `/root/refunds_backend` | `gpt-6.1-terra` / medium | Shared API, lifecycle, allocation, audit and replay | 21:34:41–21:41:58, 7m17s. |
| `/root/refunds_tester` | Profile `gpt-6-luna` unavailable; inherited model / medium requested | Independent native acceptance, race and rollback verifier | 21:43:09–21:49:22, 6m13s; instruction reading slightly precedes first clock. |
| `/root/refunds_review` | Profile `gpt-6-luna` unavailable; inherited model / high requested | Independent read-only financial/access review | 21:50:37–21:53:24, 2m47s. |

Effective model/reasoning and input/output/cached token usage are unavailable.
Requested settings do not prove effective runtime settings. No token estimates
substitute for missing telemetry.

Skills were read/applied as documents, not invoked as executable scripts:

- Root: `.agents/skills/nestjs-best-practices/SKILL.md`, its
  `rules/db-use-migrations.md` and previously read `rules/db-use-transactions.md`,
  `rules/security-validate-all-input.md`. Applied versioned migrations, strict
  boundaries and in-batch assertions. Previously read cloud
  `skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3/wrangler/SKILL.md`,
  `workers-best-practices/SKILL.md` and its `references/runtime-patterns.md`
  (same provider root) informed local runtime/isolated preview verification.
  Retrieved `https://developers.cloudflare.com/d1/worker-api/d1-database/`.
- Database: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/db-use-transactions.md`, `rules/db-use-migrations.md`,
  `rules/db-avoid-n-plus-one.md`, `rules/security-validate-all-input.md`.
  Applied additive migration, scoped relations and SQL guards; adapted TypeORM
  examples to D1 batch semantics. Checked Cloudflare D1 batch documentation.
- Backend: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/arch-use-repository-pattern.md`, `rules/di-prefer-constructor-injection.md`,
  `rules/security-validate-all-input.md`, `rules/security-use-guards.md`,
  `rules/db-use-transactions.md`, `rules/error-throw-http-exceptions.md`,
  `rules/test-mock-external-services.md`. Applied shared repository/DI, validated
  inputs, scoped Prisma reads, atomic writes and sanitized errors.
- Tester: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/test-e2e-supertest.md`, `rules/test-mock-external-services.md`,
  `rules/security-validate-all-input.md`, `rules/security-use-guards.md`,
  `rules/db-use-transactions.md`; cloud `c3/workers-best-practices`
  (the same provider root listed above) and its `references/runtime-patterns.md`.
  Applied real request-cycle tests, isolated fixtures, input/access checks and
  full-row atomic rollback. Adapted Supertest/Jest/TypeORM examples to native
  fetch, Workerd, Prisma reads and actual D1 batches.
- Reviewer: `.agents/skills/nestjs-best-practices/SKILL.md` and its
  `rules/arch-use-repository-pattern.md`, `rules/di-prefer-constructor-injection.md`,
  `rules/db-use-transactions.md`, `rules/db-use-migrations.md`,
  `rules/error-handle-async-errors.md`, `rules/error-use-exception-filters.md`,
  `rules/security-use-guards.md`, `rules/security-validate-all-input.md`,
  `rules/test-e2e-supertest.md`, `rules/test-mock-external-services.md`;
  `skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3/workers-best-practices/SKILL.md`
  and its `references/runtime-patterns.md`. Retrieved Cloudflare docs at
  `https://developers.cloudflare.com/d1/worker-api/d1-database/`,
  `/d1/platform/limits/`, `/d1/observability/debug-d1/`, `/d1/worker-api/` on the
  same host. Applied validated/scoped boundaries, explicit dependencies,
  transactional assertions, awaited writes and sanitized errors; adapted the
  example libraries to NestJS 12, Prisma D1, Vitest and native Workerd/fetch.
