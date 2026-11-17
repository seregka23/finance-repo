# Issue #10 — accounts verification

Implemented account creation/list/detail/full metadata update, archive/restore,
opening balances, signed reconciliation adjustments and movement history.
[API](../api/accounts.md), [database](../database/accounts.md) and
[UI](../ui/accounts.md) describe the contracts. Manual transaction entry remains
issue #13; its selectors must request active accounts only.

## Environment and executed checks

Node 24.22.1, NestJS 12, Angular 22, Prisma 7.10.1, Wrangler 4.163.0,
compatibility date 2026-11-16. All mutation tests used synthetic data in
**disposable local D1**, with native production authentication and API handling.
No production data migration or deployment was run.

| Command | Observed result |
| --- | --- |
| `npm --prefix backend test` | 88 tests across 13 files passed. |
| `npm --prefix backend run lint` | Passed. |
| `cd backend && ./node_modules/.bin/nest build` | Production compilation passed with the installed generated client. |
| `npm --prefix frontend run build` | Passed; accounts is a lazy route. |
| `npm --prefix frontend test -- --watch=false` | 22 tests across 6 files passed. |
| `npm run verify:prisma` | All 21 models match migrated columns, nullability and money types. |
| `node scripts/verify-schema.mjs` | 13 groups and 21 relationship rejection cases passed, including upgrade/replay preservation. |
| `node scripts/verify-transactions.mjs` | All 14 existing native transaction scenario groups passed with migration 0007. |
| `node scripts/verify-accounts.mjs` | 13 native Workerd/D1 scenario groups passed. |
| `node scripts/verify-accounts-ui.mjs` | 6 Chromium desktop/mobile scenario groups, axe and 320px reflow passed. |
| `git diff --check` | Passed. |

The local Prisma generation command encountered a 403 from its engine-checksum
host. Backend compilation used the installed generated client; clean CI runs
normal Prisma validation/generation before both application builds and tests.
The accounts repository uses exact D1 batch queries, not generated Account-model
writes or unsupported Prisma transactions.

## Acceptance evidence

- A new household creates its first account with zero or positive opening funds,
  currency, cash/bank/card type, owner label and personal/business designation.
  Both members can read and edit the account regardless of its display owner.
- Opening and signed adjustment movements change balances without creating
  income/expense transactions. Positive/negative deltas, zero opening, exact
  large values and safe-storage boundaries are exercised.
- Two adjustment requests sharing a version produce one winner. Stale metadata
  and archive versions conflict. Competing expense and adjustment batches check
  the latest balance; reserved money cannot be consumed by an adjustment.
- Currency correction before the first transaction changes opening/adjustment
  currency in the same parent statement and leaves foreign keys valid. It keeps
  nominal values and is not FX conversion. The first transaction locks currency
  even after void/move; simultaneous currency edit/posting has one safe winner.
- The migration backfill is exercised against representative voided/moved legacy
  audit history, including original, intermediate and final account references.
- Archived accounts disappear from the active query but retain balances/history;
  restoration works. Financial writes and metadata edits on archived accounts
  are rejected. The existing transaction engine independently rejects them.
- Missing sessions, cross-household IDs/owners, invalid types/dates/amounts and
  inaccessible owners fail without partial state. Membership revoked after
  preflight is checked again inside the financial batch.
- Injected movement/audit errors roll back account, balance, version and audit
  writes. Suppressed required updates trigger a SQL error. No after-the-fact
  JavaScript check is relied on for rollback.
- Cursor history is scoped/bounded and contains no duplicates. Foreign-key
  checks remain clean after edits, races and reconciliation.
- Angular tests reject old household list and save responses after switching
  households. Default financial dates use household time zone around UTC
  midnight. Exact decimal conversion avoids Number rounding.
- Browser checks use real API responses for create, reviewed negative adjustment,
  rename, first transaction/currency lock, archive/filter/restore and refresh.
  They cover desktop/mobile accessibility, large amounts, and 320px reflow.

Browser screenshots and the JSON report are generated under ignored
`.cloudflare/accounts-verification/`. Desktop/mobile captures were inspected
against the existing navy/indigo/pale-background template; no production/demo
records are introduced. Independent review identified outdated dashboard copy;
it now points users to Accounts for account balances/history. Review found no
other actionable backend/API/data-isolation defects.

## Delivery and implementation decisions

Migration 0007 adds account version/currency-lock columns, assertion views,
currency triggers and a movement-history index. Existing money and movement
values are not rewritten by the upgrade. Current balance, reserves, owner and
version checks occur in the same batch as each write and audit. Currency lock
backfill reads available movement, posting and audit references. Existing
transactions continue through the shared posting engine.

The UI uses an inline detail/form layout and existing Reactive Forms conventions.
Signed changes have a review/confirm step, clearly distinguishing a delta from
a target balance. The reactive currency control is disabled after locking and
enabled for new accounts; dates and pending state are reset on household change.
The workspace advertises account support; existing verification expectations and
navigation checks now assert the enabled account workflow.

## Agents, skills and runtime metadata

The orchestrator implemented API/validation/wiring, integration and browser
checks, migration upgrade expectations, documentation, UI integration fixes and
CI. Database and frontend work ran in parallel; a reviewer independently checked
the combined financial/access/form/routing changes. Initial specialist intervals
below include tools/waits and exclude dispatch before their clock readings.
Times are **Europe/Belgrade (CET)** on 2026-11-17.

| Agent | Requested model / reasoning | Contribution | Measured interval |
| --- | --- | --- | --- |
| `/root` | Unavailable | API, integration, validation and PR | Starts 18:33:48; final elapsed at delivery. |
| `/root/accounts_database` | `gpt-6.1-terra` / medium | Repository, migration, Prisma mapping | 18:35:47–18:38:14, 2m27s. |
| `/root/accounts_frontend` | `gpt-6.1-terra` / medium | Angular account flows and exact amount helpers | 18:36:24–18:40:12, 3m48s; later skills review not fully timed. |
| `/root/accounts_review` | `gpt-6-luna` / high | Independent read-only review | 18:41:34–18:44:03, 2m29s. |

Effective models/reasoning and per-agent input/output/cached token telemetry are
unavailable. Requested labels come from profiles/launch settings and do not
confirm effective runtime settings. Wall time includes waits and tools, not
active model compute.

Skills were read and applied, rather than executed as tools:

- Orchestrator: `.agents/skills/nestjs-best-practices/SKILL.md`, relevant cached
  `rules/security-validate-all-input.md`, `rules/db-use-transactions.md`,
  `rules/arch-use-repository-pattern.md`, `rules/di-prefer-constructor-injection.md`;
  `.agents/skills/angular-developer/SKILL.md` and cached
  `references/http-client.md`, `references/reactive-forms.md`,
  `references/testing-fundamentals.md`, `references/router-testing.md`.
  Applied strict contracts, injection boundaries, atomic financial writes,
  scoped state, actual runtime checks and async-first Angular tests.
- Database: NestJS skill above and `rules/arch-use-repository-pattern.md`,
  `rules/di-prefer-constructor-injection.md`, `rules/db-use-transactions.md`,
  `rules/db-use-migrations.md`, `rules/security-validate-all-input.md`;
  `c3/workers-best-practices` and `references/platform-apis.md`. Applied exact
  binding serialization, additive migrations and atomic D1 assertions; adapted
  TypeORM examples because D1's Prisma adapter has no atomic transactions.
- Frontend: Angular skill above and `references/signal-forms.md`,
  `references/reactive-forms.md`, `references/http-client.md`,
  `references/define-routes.md`, `references/loading-strategies.md`,
  `references/navigate-to-routes.md`, `references/signals-overview.md`,
  `references/testing-fundamentals.md`. Applied lazy routing, typed form models,
  signal state, household generations, real API and exact string amounts.
  Reactive Forms were retained for consistent create/edit control handling.
- Reviewer: NestJS skill and `rules/arch-feature-modules.md`,
  `rules/security-validate-all-input.md`, `rules/security-use-guards.md`,
  `rules/db-use-transactions.md`, `rules/error-throw-http-exceptions.md`;
  Angular skill and `references/reactive-forms.md`, `references/http-client.md`,
  `references/define-routes.md`, `references/loading-strategies.md`,
  `references/navigate-to-routes.md`, `references/router-testing.md`,
  `references/testing-fundamentals.md`. Checked access, money, migration,
  versioning and client state contracts without repeating broad suites.
- UI direction: `DESIGN.md` and `docs/design/family-finance-design.html`;
  frontend read `c12/impeccable`, `reference/new-work.md`,
  `reference/craft-floor.md`; orchestrator also read its main skill and
  `reference/craft-floor.md` for UI review. Its local launcher was absent, so
  existing project design context was read directly. The pinned visual brief
  was preserved; desktop/mobile inspection was batched and bounded.

All NestJS rule paths are relative to
`.agents/skills/nestjs-best-practices/`; Angular references to
`.agents/skills/angular-developer/`. Cloud skill aliases are provider package
identifiers. No package/framework upgrades or production settings were invented.
