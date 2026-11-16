# D1 migration and recovery guidance

## Scope

`0002_household_finance_schema.sql` is additive. It creates the 14 household
finance tables and their constraints/indexes without changing the existing
infrastructure table, migration `0001`, or stored records. It seeds no household
or financial data and imports nothing from Notion or Supabase.

Use native Wrangler migrations so D1 records which files have been applied.
Do not run an applied SQL file manually, edit it in place after release, erase
migration history, or use automatic schema synchronization.

## Local verification

From the repository root after `npm ci`:

```sh
npm run verify:schema
```

This creates a disposable local database, applies the original migration, saves
an existing probe record, and upgrades using the real migration files. It checks
all tables, scoped relationships, numeric and source constraints, simultaneous
duplicate requests, and migration replay. Only owned temporary data is removed;
it never runs a remote D1 command or touches your normal local store.

The existing Worker check remains available:

```sh
npm run verify:local
```

It applies all current migrations to its own disposable local database before
verifying the NestJS-to-D1 round trip.

For your regular local database:

```sh
npm run db:migrate:local
```

The database target is explicitly `--env local --local`. To preserve a local
backup, stop all processes using that store and copy its complete persistence
directory, including SQLite sidecar files; do not copy a live SQLite file alone.

## Before a remote migration

No remote migration or production deployment is part of issue #4. The separate
production target still needs a real database UUID and an agreed recovery plan.
When a later task authorizes a remote migration:

1. Review the exact migration and target account/database/environment. Bindings
   are explicit per Wrangler environment; default/test do not mean production.
2. Inspect existing migration history and schema for unexpected manual changes.
   Resolve drift first rather than deleting history or hiding it with `IF NOT EXISTS`.
3. Rehearse the upgrade and relevant queries on a separate local or test database
   with representative data, and run `PRAGMA foreign_key_check` afterwards.
4. Record a recoverable D1 Time Travel bookmark or a suitable backup under the
   target's retention policy, and have a tested recovery plan for that database.
5. Apply migrations only with the intended explicit target, for example
   `npx wrangler d1 migrations apply DB --env test --remote` for the test tier.
   Production commands require separate authorization and real production config.
6. Check migration history, scoped queries, record counts and relevant totals.
   Code deployment does not itself apply database migrations.

## Failure and recovery

Keep readers/writers on a compatible application version while investigating a
migration or application failure. Inspect the actual D1 migration history and
schema before retrying; do not assume a failed command advanced the history.
An unchanged native migration replay should have no pending files after success.

Prefer a reviewed **forward migration** to correct a schema defect. For this
additive migration, reverting application code can leave the unused tables in
place; it does not require deleting them. Once records exist, dropping tables,
recreating them, or deleting history as a casual rollback risks financial data.
No destructive down migration is provided.

If forward correction cannot preserve integrity, follow the agreed backup/Time
Travel recovery procedure for the exact database. Reconcile subsequent writes
and external-source references before reopening writes. Worker code rollback
does not roll back D1 data. Recovery on a real database must be authorized and
verified separately; this document does not claim production recovery was tested.

## Compatibility boundaries

Money columns hold integer minor units within the JavaScript safe range; exact
aggregates can be returned with `CAST(SUM(amount_minor) AS TEXT)`, still within
SQLite's aggregate range. Rates and quantities use text. Dates and months are
separate from audit timestamps; API code must validate calendar dates and zones.

Foreign keys and unique constraints supply structural integrity, not membership
authorization, current-balance checks, optimistic writes, refund limits, posting
classification, or idempotency replay semantics. Later feature issues must add
those workflow rules and atomic D1 batches, and may add focused migrations.
