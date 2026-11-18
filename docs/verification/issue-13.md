# Issue #13 manual transactions

The Transactions screen supports manual expense, income, transfer and refund
entry, transaction details, versioned edits and voiding. The backend filters
results before applying the date-and-ID cursor. See the [API contract](../api/transactions.md).

The account, currency and owner filters match the same leg of a transfer.
Account ownership is display metadata. The backend uses Prisma for filtering
and hydration. Literal merchant and note search uses a bounded, parameterized
Prisma SQL query for IDs because SQLite `LIKE` treats `%` and `_` as wildcards.
Hydration uses small groups to stay within the D1 bind parameter limit.
Case folding is ASCII-only, as provided by SQLite `lower()`.

Manual entry uses existing atomic posting operations. The new Prisma relations
map existing foreign keys and require no D1 migration. Reserve-funded expenses
and import workflows have separate backlog issues.

| Check | Result |
| --- | --- |
| Backend build, lint and unit suite | Backend specialist observed all 110 tests passing. |
| Frontend build and `npm --prefix frontend test -- --watch=false` | Final build and all 32 tests passed. Added regressions for applied pagination, idempotency header transport and a late detail response arriving after draft creation. |
| `node scripts/verify-transactions.mjs` | All 17 native groups passed, including same-date pagination, literal search, transfer leg filtering, household isolation and a full 100-row search page. |
| `npm run verify:prisma` | All 23 models match the migrated database columns. |
| `node scripts/verify-access.mjs` | All 10 native access groups passed with the enabled transactions capability. |
| `node scripts/verify-transfers.mjs` and `node scripts/verify-refunds.mjs` | All 10 and 13 native groups passed. |
| `node scripts/verify-navigation.mjs` | All 10 Chromium groups passed against isolated local Workerd/D1, including WCAG A/AA axe scans and 320 px reflow. |

The mobile workflow confirmed the household date and selected account defaults,
an insufficient-funds error with the original input, an edit after explicit
review of a newer version, voiding and literal search. It checked account balances
through the API after each change. The desktop workflow verified EUR income
conversion, both sides of a cross-currency transfer with a fee, and the purchase
link and category on a partial refund. Screenshot and axe artifacts are written
to `.cloudflare/navigation-verification/`.

The Dashboard chooser uses the total account count to link to manual entry.
With archived accounts only, the Transactions screen offers account guidance
and requires an active account before the form opens.

## Execution record

Specialists run in sequence per `AGENTS.md`. The orchestrator owns integration,
browser verification and delivery. Timings include tools and waits and are
measured from the first available clock reading.

| Agent | Requested configuration | Contribution | Measured time |
| --- | --- | --- | --- |
| `/root` | `gpt-6.2-sol`, effort unavailable | Coordination, integration, browser tests and PR | Started 10:20:28 CET on 2026-11-18. |
| `/root/manual_backend` | `gpt-6.1-terra`, medium | Typed filters, Prisma relations and native API coverage | 10:21:17–10:27:11 CET, 5m54s. |
| `/root/manual_frontend` | `gpt-6.1-terra`, medium | Angular list, filters, forms, translations and frontend tests | Initial dispatch after 10:27 CET and handoff around 10:38 CET. Exact specialist start unavailable. Follow-up 10:41:37–10:43:10 CET, 1m33s. |
| `/root/manual_review` | `gpt-6-luna`, high | Read-only review and diagnosis of late detail responses | 10:39:30–10:41:09 CET, 1m39s. |

Effective specialist model and reasoning data were unavailable. The environment
did not expose input, output or cached token usage for these agents.

- Orchestrator read `.agents/skills/nestjs-best-practices/SKILL.md` and
  `.agents/skills/angular-developer/SKILL.md` with its
  `references/e2e-testing.md` and `references/testing-fundamentals.md`.
  Applied bounded database reads and the existing Playwright/axe harness.
- Backend specialist read `.agents/skills/nestjs-best-practices/SKILL.md` and
  `rules/security-validate-all-input.md`, `rules/security-use-guards.md`,
  `rules/perf-optimize-database.md`, `rules/db-avoid-n-plus-one.md` and
  `rules/api-use-pipes.md` in its directory. Applied boundary validation,
  scoped membership and pre-pagination database filters with bounded
  hydration, using the repository's Worker validation approach.
- Frontend specialist read `.agents/skills/angular-developer/SKILL.md` and its
  `references/reactive-forms.md`, `signal-forms.md`, `signals-overview.md`,
  `http-client.md`, `define-routes.md`, `loading-strategies.md`,
  `navigate-to-routes.md`, `testing-fundamentals.md` and `component-styling.md`.
  Applied existing reactive forms, signal state, lazy loading and tests. Read
  `skill://plugins_6a5028ae047081918e3dfde753112690/impeccable/SKILL.md` and
  its `reference/new-work.md` and `reference/craft-floor.md`. The Impeccable
  launcher was unavailable. The specialist used `DESIGN.md` and
  `docs/design/family-finance-design.html` directly for established styles and
  native controls.
- Reviewer read `.agents/skills/angular-developer/SKILL.md` and its
  `references/reactive-forms.md`, `http-client.md`, `define-routes.md`,
  `linked-signal.md`, `signals-overview.md`, `testing-fundamentals.md` and
  `angular-aria.md`. Also read `.agents/skills/nestjs-best-practices/SKILL.md`
  and its `rules/security-validate-all-input.md`, `db-use-transactions.md` and
  `perf-optimize-database.md`. Applied form state, async request scoping,
  authorization and accessibility guidance. The review found a late detail
  response could close a new draft. The follow-up invalidates those responses
  and blocks selecting another row or starting another draft during edits.
