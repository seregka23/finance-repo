# Household reserves

Reserve routes use the usual authenticated household membership and origin checks. A reserve belongs to one account and inherits its currency. Balances are canonical integer strings in minor units, so `"1500000"` represents 15,000.00.

| Method and household-relative path | Input | Success |
| --- | --- | --- |
| `GET /reserves` | — | `200` with `{ "reserves": [...] }` |
| `POST /reserves` | `{ "accountId": "account-id", "name": "Utilities" }` | `201` with the new reserve |
| `GET /reserves/:reserveId` | — | `200` with the reserve |
| `GET /reserves/:reserveId/movements` | Optional `limit` and returned `cursor` | `200` with `{ "movements": [...], "nextCursor": null }` |
| `POST /reserves/:reserveId/movements` | `{ "type": "allocation", "amountMinor": "1500000" }` | `201` with `{ "reserve": {...}, "movement": {...} }` |

A reserve includes `id`, `accountId`, `name`, `currency`, `status`, and `balanceMinor`. Movement records include `id`, `reserveId`, `accountId`, `transactionId`, `type`, `movementDate`, `amountMinor`, and `createdAt`. Amounts are signed in history. Allocations and reversals are positive. Releases and spending are negative.

Creation, allocation, and release require an active account. For release, use `"type": "release"` with a positive amount. An allocation uses available account funds, and a release makes funds available again. The account total stays the same for both. Release remaining reserved funds before archiving the account. Reserve balances carry forward across months.

## Expenses and refunds

On expense creation or edit, include `"reserveFunding": { "reserveId": "reserve-id", "amountMinor": "1200000" }` to use a reserve on the expense account. The funding amount must be positive and cannot exceed the expense. The rest comes from unreserved account funds. Omit funding or send `null` for an expense paid entirely from available funds. Transaction reads expose the effective reserve funding of posted expenses.

If the reserve has insufficient funds, the write returns HTTP 409 with `error.code` equal to `RESERVE_INSUFFICIENT_FUNDS` and `error.availableReserveMinor` containing the current usable amount. The client can offer a revised split for the user to confirm. Posting remains subject to the usual account, category, balance, version, and idempotency checks.

A reserve-funded expense counts as one expense. Editing it adjusts its reserve movements, and voiding restores the applied reserve deduction when the resulting balances pass validation. Refunds credit the receiving account. Allocate any returned funds back to a reserve separately.

To correct a previously posted income into a reserve-funded expense through the API, change its type to expense first, then add reserve funding in a separate edit.
