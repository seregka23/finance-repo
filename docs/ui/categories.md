# Household categories

Issue #7 adds an Operate-mode category management surface within the existing
Family Finance design. The palette, navigation, typography and panel geometry
remain governed by [DESIGN.md](../../DESIGN.md) and the saved reference. Open the
lazy `/categories` route through Profile or household settings. The six primary
financial destinations remain unchanged.

## Behavior and history policy

Both active household roles can create, rename, archive and restore categories.
Types are `expense` or `income` and cannot change after creation. When a different
type is needed, create a new category and archive the old one. Names are trimmed
and contain 1–80 characters. Duplicate names are permitted as distinct IDs.

Archiving keeps the same category ID and all historical references. History
reads resolve archived categories and display their **current name** after a
rename; this feature does not snapshot former category labels. There is no
hard-delete API. Referenced records retain existing foreign-key protection.

Expense categories can be selected for expenses, fees, refunds and budgets.
Income categories can be selected for income. Transfers have no category. New
selections must use only active categories in the same household. An archived
category can be restored without changing its type or ID.

Optional names such as Groceries and Salary are reference suggestions, not
financial data. Clicking a suggestion fills the draft name/type; it does not
save anything. Household creation and migration do not seed categories or
financial records automatically.

The page provides real search/status filters, an empty state, no-match reset,
loading, errors and retry. Mutation controls prevent repeat submission while
pending. Household changes and page destruction invalidate older responses.
Inline rename moves focus to its input and restores row focus after save/cancel.
Mobile filters/rows fit the existing 390px and narrow 320px layouts.

## Layout and incumbent design

This is an ordinary extension of the existing UI reference, not a new visual
exercise. Desktop places the category list and filters in the wider left panel
and creation form in the right panel. At the incumbent 680px breakpoint they
stack in that order above the existing bottom navigation. At 390px the search
and status controls share a row; at 320px they wrap into separate rows. Local
field sizing (`width: 100%; min-width: 0`) keeps controls inside their assigned
space. Category names, row actions and suggested-name buttons wrap as needed.
The shell retains its extra clearance for the two-row narrow navigation.

The inspected desktop, mobile and narrow captures retain the navy shell, pale
background, indigo primary action, bordered white panels, established type scale
and rounded controls. Type and status are conveyed in text. Inline rename uses
the existing form/button treatment rather than a new modal pattern. This surface
uses the incumbent tokens and introduces no new identity, product document or
design-system JSON sidecar. DESIGN.md and the saved template remain unchanged.

## API contract

All resources are under `/api/v1/households/:householdId/categories`, with signed
authentication, live membership assertions, scoped bound queries and `no-store`.
Mutation Origin rules are unchanged from [authentication](../authentication.md).
`Category` is `{id,name,type,status,createdAt,updatedAt}`; timestamps are ISO text.

| Method/resource | Contract |
| --- | --- |
| GET base | `{categories:[Category]}`; default includes all statuses; optional `status=active`, `archived` or `all` |
| GET `/options?usage=...` | `{usage,categories:[Category]}` with active eligible categories only; usage is required and transfer returns an empty list |
| GET `/reference-names` | `{expense:[name],income:[name]}`; suggestions only, no writes |
| GET `/:id` | Category in this household, including archived categories for historical reads |
| POST base | `{name,type}` → 201 active Category |
| PATCH `/:id` | Nonempty `{name?,status?}` → saved Category; no type, identity or household reassignment |

`usage` is one of `expense`, `income`, `fee`, `refund`, `budget`, `transfer`.
Unknown fields/values, missing usage and invalid names return 400 `INVALID_INPUT`.
Unknown/cross-household category IDs return 404 `CATEGORY_NOT_FOUND` when the
household itself is accessible; unavailable households return 404
`HOUSEHOLD_NOT_FOUND`. Category assertion conflicts return 409
`CATEGORY_NOT_ELIGIBLE`; the database's immutable-type protection maps to 409
`CATEGORY_TYPE_IMMUTABLE`. Public type mutation attempts are rejected as invalid
input before database access. Other auth/database errors retain existing codes.

## Future selection consumers

Use `CategoryService.listEligible` or the `/options` endpoint for transaction,
budget and decision-adapter candidates. The Angular `CategoriesService` exposes
the typed eligible-list method. Management lists intentionally include archived
records and must not be reused unfiltered as a new-selection picker.

Options can become stale between loading and confirmation. Include
`CategoryService.selectionStatement(householdId,categoryId,usage)` **inside the
same authorized D1 batch** as the dependent write. The SQL assertion rejects
archived, missing, wrong-type and cross-household categories. Assert only when
assigning a new selection, not when simply reading historical references. Every
dependent statement must still scope its own data to the household. See the
[database contract](../database/categories.md).

The category assertion does not replace membership, available-funds checks,
idempotency, version checks or later transaction posting rules. Those workflows
are not implemented by this issue. Independent edits to separate category fields
are applied atomically; competing changes to the same field use the last
successful write, without a category version/conflict protocol.

## Verification

`npm run verify:categories` builds the apps and runs API, D1 assertion/history and
Chromium checks using signed synthetic identities in a disposable local store.
Chromium setup matches `verify:navigation`. The fixture-only history/assertion
routes exist only in its generated temporary entrypoint, never the production
Worker. See [issue #7 evidence](../verification/issue-7.md) for observed results,
captures, independent review and remaining deployment boundaries.

The integration team reported six native category groups, eight baseline access
groups and thirteen schema checks passing. Chromium verification reported two
groups covering create/rename/archive/restore, keyboard use, search, status,
no-match reset, loading and retry, plus three zero-violation WCAG A/AA scans and
no horizontal overflow. The API integrity review reported no actionable findings.
These are reported results; this documentation pass inspected the source and
the three captures in `.cloudflare/categories-verification/` and did not rerun
the checks.

The UI review identified overlapping search/status fields at 390px. The locally
constrained fields and updated captures show separate controls within their
columns. The reviewer confirmed the reported filter-overlap finding resolved.
That verdict covers the targeted correction; see the acceptance record for
broader verification evidence and durable captures. Real-provider/deployment
verification is not claimed.
