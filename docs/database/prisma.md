# Prisma with Cloudflare D1

The backend uses Prisma ORM 7.10.1 with `@prisma/adapter-d1` and the generated
Workerd client. `PrismaService` is injected through Nest's Worker module. It
uses the existing `env.DB` binding; there is no new database, connection string,
service credential or external database server.

## Scope and transaction boundary

Typed Prisma queries now handle authentication user/session lookups, logout,
active household/member lookups and session household lists. The local
infrastructure probe uses Prisma create/find/delete operations, and the health
route checks the database through Prisma. HTTP response shapes are unchanged.

Category lists and details, workspace counts, member and invitation lists,
account balances and movements, monthly plans, monthly reports, the dashboard,
and recorded monthly movements use parameterized `PrismaService.$queryRaw`
calls. Each query checks live household membership in the same statement that
returns the data. The queries distinguish an authorized empty collection from a
denied request. The member and invitation lists share a database snapshot, as
do the financial rows used to assemble each report and dashboard response.

The schema maps application tables and their scalar columns. It includes
the relations used by current typed queries, maps snake_case storage names to
camelCase fields, uses `BigInt` for minor-unit amounts and preserves stored text
for financial dates, rates and audit timestamps. API money remains string
encoded. The schema verifier compares models against the actual SQL migrations.

Prisma's D1 adapter does not provide atomic transaction semantics. Therefore:

- `PrismaService.$transaction` rejects both explicit transaction forms before
  they can execute queries. Do not use nested Prisma mutations as a substitute:
  they can also request implicit transactions that D1's adapter cannot provide.
- Registration's user/session write, throttle reservations, household creation,
  invitation acceptance and guarded updates retain their native D1 batches.
- Category mutations retain native D1 authorization assertions in the write
  batch. Keep any required live authorization, write-result and accounting
  assertions in the same batch as their dependent writes. This includes reads
  used to validate a mutation or construct its result before the batch commits.
- Financial reads retain integer-to-text casts and BigInt accumulation to
  preserve exact values beyond JS-safe and SQLite SUM aggregate ranges.

The shared `DATABASE` token lives in `database/database.tokens.ts` and is
re-exported by the health module for services that use native atomic batches.

## Build and local development

```sh
npm ci
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
npm run build
npm run verify:prisma
npm run verify:access
npm run verify:money
npm run verify:local
```

Backend postinstall generates the client for fresh checkouts. Backend build also
regenerates it before Nest compilation. Generated files under
`backend/src/generated/prisma` are ignored by Git. Nest copies the generated
query-compiler JavaScript and WASM into `dist`; Wrangler bundles the WASM module.
Vitest loads that same WASM compiler in Node, rather than replacing Prisma with
a mock or a different production client.

Generation uses the installed pinned Prisma CLI. The standard CLI needs access
to Prisma's binary host during installation. The acceptance record describes a local HTTP 403
restriction on that host and distinguishes it from the PR workflow checks. Do not add a dummy engine path to project settings.

## Existing data and migrations

The versioned SQL files in `backend/migrations` remain authoritative. No new SQL
migration, data rewrite, seed, remote change or destructive reset is required
for this adoption. The existing automatic deploy command still applies pending
Wrangler migrations and deploys the Worker.

Checks, partial indexes, composite foreign keys, triggers and assertion views
remain enforced by those SQL migrations; not all are representable in Prisma's
schema. Update the SQL migration and Prisma mapping together when storage
changes, and review the SQL against these constraints. Do not use `prisma db
push`, `prisma migrate dev`, or an unreviewed schema diff to replace this existing
D1 schema.

References: [Prisma D1 guide](https://www.prisma.io/docs/guides/v7/deployment/cloudflare-d1)
and [SQLite/D1 connector limitations](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite#cloudflare-d1).
See [the acceptance record](../verification/prisma.md) for observed results.
