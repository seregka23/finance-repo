# Monthly category budgets

The following routes are relative to `/api/v1/households/:householdId`. They require an active household membership. Amounts are exact integer strings in RSD minor units.

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /plans` | Optional `month=YYYY-MM`. Omission selects the current month in the household's time zone. | `200 {month, plans}` |
| `POST /plans` | `{month, categoryId, limitMinor}` | `201` with the created plan |
| `PATCH /plans/:id` | `{limitMinor}` | `200` with the updated plan |
| `DELETE /plans/:id` | No body | `204` |

The limit is nonnegative. Each expense category can have one plan in each household and month. A plan's month and category are fixed at creation. New plans require an active expense category. Existing plans remain visible and editable after their category is archived. Duplicate plans return `409 PLAN_EXISTS`. Referenced plans cannot be deleted and return `409 PLAN_LINKED`.

A plan includes `id`, `month`, `categoryId`, `categoryName`, `categoryStatus`, `limitMinor`, `actualMinor`, `remainingMinor`, `overspentMinor`, `utilizationBasisPoints`, and `missingFxCount`.

Actual spending uses the signed reporting movements for posted expenses, fees, and refunds in the selected category. A refund lowers spending in the month it was credited. Transfer principal, opening balances, and adjustments are excluded. Edits and voids affect the next read. Transactions use their stored RSD equivalents. RSD movements can use their original amounts directly.

Remaining is the limit minus actual spending. Overspent is the positive magnitude of any excess. Utilization is a signed integer string in basis points, rounded to the nearest basis point. `"2000"` represents 20%. A zero limit has `null` utilization. Net spending may be negative when refunds exceed expenses in a month.

When reporting records lack a required FX rate or equivalent, `missingFxCount` gives the number of affected records and `actualMinor` represents the known subtotal. Remaining, overspent, and utilization are `null`. Consumers should label the subtotal as incomplete and suppress definitive progress and overspend figures.
