# Financial navigation and first-use surfaces

Issue #6 extends the approved Family Finance design in Operate mode. It retains
the palette, type, sidebar, panel geometry and mobile conventions in
[DESIGN.md](../../DESIGN.md) and the saved HTML reference. No new visual identity
or synthetic financial store is introduced.

The lazy routes are `/dashboard`, `/accounts`, `/transactions`, `/budgets`,
`/reserves`, `/reports` and `/settings`. The root and unknown paths resolve to
Dashboard. Navigation order follows the specification; the current link, page
title and focused heading identify client navigation. The Profile menu retains
household settings and sign-out. The shell's explicit Household selector appears
for people with multiple households and applies across all routes, including
settings. Profile remains available on every signed-in route.

## Responsive navigation

The incumbent sidebar is 222px wide, narrows to 185px at 1100px, and becomes a
62px icon rail at 860px. Links retain accessible names when labels are visually
hidden. At 680px the six destinations move into a fixed bottom navigation row,
content stacks into one column, and side padding becomes 15px. At 360px and below,
navigation uses a three-column, two-row layout; 150px content clearance keeps the
last controls reachable above it. The bottom bar accounts for safe-area insets.
The header keeps Household selection and Profile accessible at narrow widths.

Inactive navigation links use a transparent background and muted light text;
only the current destination receives the persistent active pill and
`aria-current="page"`. Hover and visible keyboard focus remain distinct states.
These changes extend the existing navy/indigo treatment without replacing its
tokens, identity or preserved HTML reference. No design-system JSON sidecar is
needed for this ordinary extension.

## States and delivered actions

| Surface | First-use behavior |
| --- | --- |
| No household | Working link to household creation in settings |
| Dashboard | Confirmed fresh households show zero RSD balance, income and expenses, no activity, and an account prompt |
| Accounts | Empty-account explanation and disabled Add account control with its availability reason |
| Transactions | Account prerequisite or empty transaction state; Add transaction opens a method chooser |
| Budgets | Current month in the household time zone, empty-plan state and disabled Add budget |
| Reserves | Account prerequisite or empty reserves, with disabled Create reserve |
| Reports | Explanation when the household has no transactions |

Nonempty stored data is represented honestly by saved counts while detailed
financial views await their feature issues. A count is not a balance or a
current-month report. Zero amounts appear only when accounts, transactions and
account movements are all absent; every displayed monetary amount includes its
currency. No sample transactions or charts are presented as household data.

Loading, failure and empty states are separate. Retry performs a fresh read;
household switching clears data and ignores stale responses. Membership and
session errors use the existing sign-in/access handling. The reusable
`ResultsState` component supplies an empty message or no-match message with a
Reset filters output. No live filters are exposed without a real list API;
the first detailed list feature must connect the reset to its actual filter state.

The native transaction dialog exposes manual, pasted SMS and image choices.
Those choices are disabled with an availability explanation until completed
features provide actual handlers. Its account link works today. Close and Escape
dismiss it, keyboard focus stays in the modal, and closing restores the opener
when it remains connected. Reopening an open modal is prevented; navigation and
household changes close it. Existing settings forms keep pending controls.

## API and future feature handoff

`GET /api/v1/households/:householdId/workspace` returns:

```json
{
  "counts": {
    "accounts": 0,
    "transactions": 0,
    "plans": 0,
    "reserves": 0,
    "accountMovements": 0
  },
  "capabilities": {
    "accounts": false,
    "transactions": false,
    "imports": false,
    "budgets": false,
    "reserves": false,
    "reports": false
  }
}
```

The example illustrates the response contract, not a seeded household. Counts
include all saved rows, including archived/history rows, and are scoped to the
household. One query executes with a live member assertion in the same D1 batch.
The endpoint inherits server-session authentication, 404 for unavailable households,
sanitized failures and `no-store`. No database migration or financial mutation
is added.

All capabilities are currently false. A future feature must supply its real
API, screen/action and validation before enabling its corresponding control;
changing a flag alone must never activate a placeholder. Detailed account forms,
transaction posting/import, budget/reserve operations, reporting and actual
filtering remain their feature issues.

## Verification

`npm run verify:navigation` runs actual local Worker/D1 and Chromium checks,
including the six routes at desktop/mobile sizes, modal keyboard behavior,
loading/error/retry, household creation and accessibility. See the
[acceptance record](../verification/issue-6.md) for observed results and captures.
The original issue #6 evidence used signed Access fixtures. Current verification
uses native accounts and sessions; see [authentication](../authentication.md).

The integration team reported eight browser verification groups and eight native
D1 groups passing. Accessibility checks reported zero WCAG A/AA violations across
16 scans: twelve desktop/mobile financial-route views, two dialogs, settings and
a 320px household-switching case. These are reported integration results; this
documentation pass read the implementation and did not rerun them. The reviewer
identified indistinguishable active navigation as the material finding. The
source now reserves the persistent pill for the active route. The reviewer
inspected all six updated captures and confirmed that only the current financial
route is highlighted, with none highlighted on Settings, closing that finding.
The full browser proof passed again with eight groups, sixteen zero-violation
WCAG A/AA scans and a navigation-style regression assertion. The review's SHIP
disposition is limited to the resolved navigation finding; the acceptance record
holds the broader verification evidence and boundaries.
