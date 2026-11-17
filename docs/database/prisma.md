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

The schema maps all 19 application tables and their scalar columns. It includes
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
- Category, workspace and monetary queries retain same-batch live authorization
  assertions. Splitting these checks and queries would change isolation and
  rollback guarantees.
- Monetary repository reads retain integer-to-text casts and BigInt accumulation
  to preserve exact values beyond JS-safe and SQLite SUM aggregate ranges.

These native operations are deliberate parts of the database layer. This is a
hybrid Prisma/D1 migration, not a claim that every SQL statement became an ORM
call. The shared `DATABASE` token lives in `database/database.tokens.ts` and is
re-exported by the health module for existing batch consumers.

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
to Prisma's binary host during installation. This workspace currently receives
HTTP 403 from that host; see the acceptance record for the exact local
validation limitation. Do not add a dummy engine path to project settings.

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
