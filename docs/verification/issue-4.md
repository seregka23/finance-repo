# Issue #4: household-scoped D1 schema

Source: [GitHub issue #4](https://github.com/seregka23/finance-repo/issues/4),
technical specification v0.5 sections 4.2 and 13.
Verified locally on November 16, 2026 with Node.js 24.22.1, npm 11.9.0,
Wrangler 4.163.0 and Miniflare 5.20261116.0-beta (the version used by that
Wrangler release, now also pinned explicitly for the verifier).

## Delivered scope

Additive migration `0002_household_finance_schema.sql` defines all 14 requested
tables. It uses household-scoped foreign keys, integer minor units with safe
binding ranges, text exchange rates, separate business dates and audit
timestamps, transaction versions and parent links, and typed import references.
It supplies the descending household/date/ID transaction index and unique keys
for monthly budgets, member requests and source hashes.

The existing infrastructure migration is unchanged. The schema is initially
empty: no household, financial record or external-source import is seeded.
See the [schema and future repository contract](../database/schema.md) and
[migration/recovery guidance](../database/migrations.md).

## Executed validation

```sh
npm run verify:schema
npm run verify:local
node --check scripts/verify-schema.mjs
git diff --check
```

All passed. The managed workspace used
`XDG_CONFIG_HOME=/tmp/finance-cloudflare-config WRANGLER_SEND_METRICS=false`
for the Worker check; these are workspace log/config settings, not credentials.
The schema verifier isolates its CLI configuration itself.

| Acceptance check | Observed result |
| --- | --- |
| Native clean migration and upgrade | Wrangler applied `0001` to a fresh disposable local D1 store, then applied `0002` while retaining an existing probe and its exact migration history. All 14 finance tables started empty. |
| Tables and list index | All requested tables and descending transaction date/ID index columns were present. Valid fixtures populated every table. |
| Household isolation | 21 cross-household relationship attempts failed with foreign-key errors. Every typed audit/import-reference target was also checked. |
| Related-record consistency | Wrong movement currency, reserve/account mismatch and receipt/draft transaction mismatch failed. Optional owners, conversion values and independent opening/allocation movements remained valid. |
| Monetary and structural checks | Fractional/unsafe money, invalid enums, month/version values, malformed JSON and invalid rate strings failed. A rate retained its text representation and an aggregate above the JavaScript safe range was returned exactly as text. |
| Uniqueness and concurrency | Two simultaneous inserts for each budget, member request key and draft source produced exactly one success and one unique-constraint failure. Separate member/household/source-type scopes were accepted. |
| Atomic failure and retained history | An invalid D1 batch rolled back its preceding transaction insert. Deleting a referenced account failed. `PRAGMA foreign_key_check` returned no violations. |
| Migration replay | Re-running native migrations preserved all fixture counts, the legacy probe and exact migration history. |
| Existing application regression | `verify:local` rebuilt NestJS and Angular, applied both migrations in another disposable store, and passed real Worker health/greeting, SPA/API routing, probe CRUD, restart persistence, migration replay and cleanup checks. |

The schema verifier reported **13 passing groups**. It uses actual local
Workerd/D1 through Miniflare, not a mocked database, and runs native Wrangler
migrations against the same persisted store. Both verification commands clean
up only their own temporary data. No remote migration, resource creation or
deployment was executed; normal local database state was not touched.

## Specialist handoff and boundaries

The database specialist owned the SQL migration; the backend specialist reviewed
the storage/repository contract and documented it. An independent reviewer
found no actionable structural or validation defects, including in the recovery
guide. Shared verification, package scripts and README changes were integrated
by the lead agent.

Membership authorization, calendar validation, state transitions, optimistic
updates, idempotency replay responses, transaction posting, funds/reserve checks,
refund limits and extraction privacy rules remain later API/workflow work.
Database constraints alone do not implement those rules. No financial HTTP
endpoints or Angular pages are introduced by this schema issue.

Production D1 identity/configuration and real recovery rehearsal remain open
release decisions. The additive schema can remain in place after a code rollback;
populated financial tables must not be dropped as an automatic down migration.
