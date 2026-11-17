# Household accounts API

All paths below are under `/api/v1/households/:householdId/accounts`. Native
session, same-origin mutation checks and active household membership are required.
Ownership is display metadata: both members may read and change every account.
Money is always canonical integer **strings in minor units**, never JSON numbers.

| Method/path | Request/query | Result |
| --- | --- | --- |
| GET `/` | `status=all` (default), `active` or `archived` | 200 `{accounts:[Account]}` |
| POST `/` | AccountInput plus `openingBalanceMinor`, `openingDate` | 201 Account |
| GET `/:id` | None | 200 Account, including archived accounts |
| PATCH `/:id` | Full AccountInput plus current `version` | 200 Account |
| POST `/:id/archive` | `{version}` | 200 Account |
| POST `/:id/restore` | `{version}` | 200 Account |
| POST `/:id/adjustments` | `{amountMinor,movementDate,version}` | 201 Account |
| GET `/:id/movements` | `limit=1..100` (default 50), returned `cursor` | 200 `{movements,nextCursor}` |

AccountInput is `{name,type,currency,ownerMemberId,designation}`. Name is trimmed,
1–100 characters; type is `cash`, `bank` or `card`; currency is RSD/EUR/RUB/USD;
designation is `personal` or `business`; ownerMemberId is null for the household
or an active member of this household. Unknown fields are rejected. PATCH is
full replacement of metadata and cannot rewrite the opening movement.

Example creation:

```json
{"name":"Household cash","type":"cash","currency":"RSD","ownerMemberId":null,"designation":"personal","openingBalanceMinor":"50000","openingDate":"2026-11-17"}
```

The opening is zero or positive. Reconciliation is a **signed nonzero delta**,
not a desired target balance: `"-1000"` decreases it by 10.00; `"1000"` increases
it by 10.00. A positive API amount has no leading plus sign. Dates must be real
Gregorian YYYY-MM-DD dates. Individual amounts and resulting balances must fit
0 through 9,007,199,254,740,991 minor units; negative adjustments are accepted
only if the current balance less reserves remains nonnegative.

Account adds id, status, version, currencyLocked, balanceMinor, reservedMinor,
availableMinor, createdAt and updatedAt to AccountInput. Three balance fields
are exact strings. Version is a positive safe JSON integer, starting at one and
incrementing on metadata/status/reconciliation writes. Financial transactions
update the ledger and persistent currency lock; reconciliation always checks
the current balance inside its batch even when an expense has not changed this
account's metadata version. Replaying a stale adjustment version conflicts.

Opening and adjustment movements have no transaction ID and do not contribute
to income/expense totals. History includes signed amountMinor, currency,
movementDate, type, id, transactionId (or null), and createdAt; it sorts by
movement date then ID descending. Use the opaque nextCursor without changing it.

Currency may be corrected before the first transaction, provided no reserves
exist. Existing opening/adjustment movements keep the same nominal amounts and
adopt the corrected currency; this is not FX conversion. After the first
transaction the currency lock persists, including after edits, moves and voids.
Other metadata remains editable. Archived accounts retain balances/history;
restore them before financial or metadata changes. `status=active` is the source
for future manual-entry account selectors, and the transaction engine rejects
archived accounts independently. Advanced manual entry remains issue #13.

Errors use the standard envelope: 400 INVALID_INPUT; 404 HOUSEHOLD_NOT_FOUND or
ACCOUNT_NOT_FOUND; 409 VERSION_CONFLICT, OWNER_NOT_ELIGIBLE, CURRENCY_LOCKED,
ACCOUNT_NOT_ELIGIBLE or INSUFFICIENT_FUNDS. Unexpected database errors and failed
required-write assertions return sanitized 503 DATABASE_UNAVAILABLE. Writes
include the live access/version/balance/owner assertions and audit/movement
changes in one D1 batch. Financial writes must not use Prisma transactions.
