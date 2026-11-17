# Household transactions

All routes require the existing authenticated household membership and origin protections. Amounts are positive canonical integer strings in minor units (for example, `"1234"` means 12.34). Supported currencies are RSD, EUR, RUB and USD. Only expense and income are supported.

`POST /api/v1/households/:householdId/transactions` requires an `Idempotency-Key` header of 1–128 visible ASCII characters without spaces. Keys are scoped to the household and actor. Repeating a key with the same normalized input returns the original result; using it with different input returns 409. Send a JSON object:

```json
{"type":"expense","transactionDate":"2026-11-17","accountId":"account-id","categoryId":"category-id","amountMinor":"1234","currency":"RSD","exchangeRate":null,"exchangeRateSource":null,"merchant":null,"note":null}
```

`transactionDate` is a real Gregorian date in YYYY-MM-DD format. The account must belong to the household, be eligible for posting and match `currency`; the category must be active and match the transaction type. Foreign currency requires a positive decimal `exchangeRate` (RSD per unit of foreign currency) and a nonblank `exchangeRateSource`. RSD requires null or omitted rate and source. Optional merchant, note, rate and source may be omitted on create; blank merchant/note normalize to null. Text is trimmed and equivalent decimal rates are normalized before idempotency comparison. The recorded RSD conversion is a snapshot, not a live exchange rate.

`GET /api/v1/households/:householdId/transactions` returns `{ "transactions": [...], "nextCursor": null }`, sorted by transaction date and ID descending. Optional `limit` is 1–100 (default 50); pass a returned `nextCursor` as `cursor` for the next page. No other filters are supported. `GET /api/v1/households/:householdId/transactions/:id` returns one record.

`PATCH /api/v1/households/:householdId/transactions/:id` replaces all input fields and requires a positive safe integer `version`. All fields including nullable fields must be present. `POST /api/v1/households/:householdId/transactions/:id/void` requires `{ "version": 1 }`. A stale version or an ineligible/void transaction returns 409. These operations preserve history and atomically update ledger movements and audit records.

Create, read, edit and void return a transaction record directly: the input fields plus `id`, `householdId`, `authorMemberId`, `status` (`posted` or `void`), `version`, `rsdEquivalentMinor`, `createdAt` and `updatedAt`. Money fields remain strings. Invalid input returns 400 using the standard API error envelope; inaccessible households and missing transactions return 404. Conflicts return 409. Unknown fields are rejected.

Creation, including replay, returns HTTP 201; reads, edits and voids return 200.
Domain conflicts use `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`,
`ACCOUNT_NOT_ELIGIBLE`, `CATEGORY_NOT_ELIGIBLE`, `INSUFFICIENT_FUNDS` or
`TRANSACTION_LINKED`. Unexpected database failures or failed required-write
assertions return 503 without SQL details. Archived accounts must be reactivated
before edits or voids can change their ledger; replaying an existing key is not
a new financial write and still returns the original result.
