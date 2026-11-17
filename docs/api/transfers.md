# Transfers

`POST /api/v1/households/:householdId/transactions` accepts `type: "transfer"`, `transactionDate`, `fromAccountId`, `toAccountId`, `debitAmountMinor`, `creditAmountMinor`, `debitCurrency`, `creditCurrency`, and optional `fee`, `merchant`, and `note`. The `Idempotency-Key` header follows the same rules and scope as other transaction posts. Amounts are positive canonical safe-integer strings in minor units. Accounts must differ and be active household accounts with the stated currencies. When currencies match, amounts must match. When currencies differ, both amounts are actual amounts; no principal exchange rate is calculated.

An optional fee is `{ "amountMinor": "...", "categoryId": "...", "exchangeRate": null, "exchangeRateSource": null }`. It is charged to the source account and requires an active expense category. RSD fees have null rate and source; foreign fees require a positive decimal rate and a nonblank source. The normalized rate and exact rounded RSD snapshot are recorded. The response contains the parent transfer and fee metadata, including the fee transaction ID. A fee is also independently readable with `type: "fee"` and `parentTransactionId`, but may only be changed through its parent.

For example, a 12,000 RSD transfer with a 100 RSD fee uses minor units:

```http
POST /api/v1/households/:householdId/transactions
Idempotency-Key: transfer-2026-11-17-001
Content-Type: application/json
```

```json
{
  "type": "transfer",
  "transactionDate": "2026-11-17",
  "fromAccountId": "source-account-id",
  "toAccountId": "destination-account-id",
  "debitAmountMinor": "1200000",
  "creditAmountMinor": "1200000",
  "debitCurrency": "RSD",
  "creditCurrency": "RSD",
  "fee": {
    "amountMinor": "10000",
    "categoryId": "expense-category-id",
    "exchangeRate": null,
    "exchangeRateSource": null
  }
}
```

The authenticated request returns `201` with a `TransferRecord` (see
`backend/src/transactions/contracts.ts`), including ID, version, status,
timestamps and nested fee metadata. A replay also returns `201` and the original
record. For 650 EUR → 78,000 RSD, use `"65000"` debit and `"7800000"` credit,
with `"EUR"` / `"RSD"` currencies and `"fee": null`.

`PATCH /api/v1/households/:householdId/transactions/:id` replaces the complete transfer representation and requires its current numeric `version`. Include `fee`, `merchant`, and `note` explicitly, using null when absent. `POST /api/v1/households/:householdId/transactions/:id/void` accepts `{ "version": 1 }`. Both operations atomically remove the old movements and apply the replacement or void; already spent destination funds, reserves, archived old accounts, or concurrent edits can prevent the operation. Fee history is retained.

Malformed bodies, unknown fields, invalid versions, or invalid amounts return `400 INVALID_INPUT`. Ineligible accounts or categories, insufficient available funds, linked records, stale versions, and a reused key with a different canonical payload return their corresponding `409` error. Missing or inaccessible resources return `404`; unexpected database failures are sanitized as `503`. Replaying an identical post returns its original response, even after edits or voids, while membership remains active.

`transaction_reporting_movements` is the authoritative signed reporting view: it excludes transfer principal and includes the fee once as a separate expense movement. Nested fee metadata is not an additional contribution.
