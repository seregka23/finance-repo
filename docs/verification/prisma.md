# Prisma D1 adoption acceptance record

The change adds Prisma ORM/client/D1 adapter 7.10.1 to the existing NestJS Worker.
No remote database, migration, deployment or schema reset was performed.

## Change and preserved boundaries

Typed Prisma handles user/session lookups, session revocation, active household
access and household session lists, health checks and local probe CRUD. The
schema maps all 19 application tables from the five existing migrations.

Native D1 batches remain for compound writes and assertion-dependent category,
workspace and monetary operations. They preserve live membership checks,
rollback, invitation capacity/races and exact text-encoded financial values.
Both explicit Prisma transaction APIs are rejected; implicit nested Prisma
mutations must not be used as an atomic substitute. This is a hybrid migration,
not a replacement of every SQL statement. See [the setup guide](../database/prisma.md).

Generated ESM uses the Workerd WASM query compiler. Nest asset rules copy its JS
and WASM files to dist. A type-only D1 binding alias avoids emitting a reference
to the nonexistent JavaScript global `D1Database` in Nest decorator metadata.
Vitest executes the same generated WASM compiler with an in-memory SQLite D1
adapter for auth tests; it does not mock the ORM or change the production client.

## Verification observed on 2026-11-17

- Backend unit suite: 34 tests across 11 files passed, including both explicit
  transaction rejection forms and actual Prisma-backed authentication tests.
- Backend TypeScript compilation and lint passed.
- `node scripts/verify-prisma-schema.mjs`: all 19 model/table mappings, complete
  columns, nullable fields, stored text and BigInt minor units matched the
  existing migrations executed by Node SQLite.
- `node scripts/verify-access.mjs`: ten groups passed against the compiled
  application in native Workerd and disposable D1, including registration,
  session lookup/logout/expiry, scoped household reads, invitations, live
  revocation, concurrent capacity checks and guarded-write rollback.
- `node scripts/verify-money.mjs`: nine groups passed, including recorded FX,
  household dates, totals beyond JS-safe integers and SQLite SUM's range,
  unchanged originals and missing-conversion metadata.
- `node scripts/verify-local-d1.mjs`: migration replay, actual Prisma probe
  create/read/delete through the Worker, restart persistence and cleanup passed.
- Wrangler dry-run packaging included the 3,304,603-byte query compiler WASM.
  This proves packaging, not a production deployment.
- Independent backend/security review found no actionable issue in the inspected
  ORM/DI/auth/schema/batch scope. The reviewer also ran the mapping verifier.

## Environment limitation and CI

The workspace proxy returns HTTP 403 for Prisma's schema-engine binary host;
direct DNS access is unavailable as well. The initial client generation and
schema parsing used Prisma's WASM parser with an environment-only
`PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` presence-check bypass. This is **not**
verification of the real schema engine or a normal clean installation. No such
override is committed, and the standard install/build scripts do not set it.

The runtime proofs above execute actual generated Prisma queries and WASM
against SQLite/native D1 independently of that binary. Normal postinstall and
build generation still need the real Prisma CLI environment. Cloudflare is configured to build only `main`. The added GitHub Actions
`Prisma and D1` pull-request workflow performs a normal clean install, standard
Prisma validation/generation, full build, unit/lint checks and native disposable
D1 verifiers without deployments or secrets.

[GitHub Actions run 44107664083](https://github.com/seregka23/finance-repo/actions/runs/44107664083)
completed successfully for runtime/CI commit `4bb5bdb`: normal `npm ci`,
`prisma:validate`, full build/generation, mapping verification, 34 unit tests,
lint and all three native D1 verifiers passed. It used no engine-path override.
This supplies the normal clean-install/CLI validation missing locally; the
workspace network restriction remains an environment limitation, not an
unresolved build failure.

## Skills and execution reporting

The backend/database specialists and independent reviewer read
`.agents/skills/nestjs-best-practices/SKILL.md` and applicable transaction,
migration, constructor-injection/token and security-guard rules. Their applied
adaptation is to retain D1 batches instead of applying the skill's TypeORM
transaction examples. Cloudflare Workers runtime/configuration guidance and
current Prisma D1/generator documentation informed the ESM, WASM and adapter setup.
No PostgreSQL-only advice was applied to D1. No frontend code changed.

Requested launch settings were `gpt-6.1-terra`/`medium` for database and backend,
and `gpt-6-luna`/`high` for review. Effective model metadata and token usage were
not exposed. Reported measured intervals (UTC, including tools/waiting):

- Database: 14:30:06–14:34:06, then 14:35:15–14:36:22 (separate runs).
- Backend: 14:30:35–14:33:55, excluding initial guidance reading.
- Independent reviewer: 14:40:04–14:41:07.

Parallel durations must not be summed as total task elapsed time. The main
orchestrator reports its measured task interval in the final response.
