# Refunds

Refunds use the shared household transactions API. Create with `POST /api/v1/households/{householdId}/transactions` and an `Idempotency-Key` header:

```json
{"type":"refund","transactionDate":"2026-02-01","purchaseTransactionId":"purchase-id","accountId":"account-id","amountMinor":"100","merchant":null,"note":null}
```

`merchant` and `note` may be omitted on creation. Amounts are positive canonical minor-unit strings. The purchase must be a posted expense; the destination must be an active account in its currency. Category, currency and conversion fields are inherited from the purchase and cannot be supplied by clients. The posted refund total cannot exceed the purchase amount.

Responses include the refund's ID, household and author, status, numeric version, timestamps, purchase link, inherited category and conversion snapshot, and `rsdEquivalentMinor`. The RSD allocation may be `"0"`. A repeated identical creation using the same key returns its original response even after later edits or voids; a different request using that key returns 409.

Read refunds through the existing transaction GET and list endpoints. Replace a refund with `PATCH /api/v1/households/{householdId}/transactions/{id}` using every field shown above plus the current numeric `version`. The purchase link cannot change. Void it with `POST .../transactions/{id}/void` and `{"version":1}`. Edits and voids recalculate later posted refunds in their original allocation order; changed siblings receive a new version. Each operation also advances the purchase version. Conflicts, unavailable or changed purchases, invalid conversion snapshots, account eligibility, and insufficient funds return 409. Invalid request shapes return 400.

For a 5,000 RSD purchase, a 1,000 RSD partial refund uses `"amountMinor":"100000"`
(purchase amount `"500000"`). A January purchase and February refund contribute
5,000 expense in January and −1,000 expense in February, with zero refund income.
No reserve is automatically refilled. Full FX refunds offset the original
recorded RSD using cumulative original-rate rounding; a zero-RSD increment is valid.

While posted refunds exist, purchase amount edits must remain at least their
total, and purchase type, category, currency, rate and source cannot change.
Compatible amount/metadata edits remain available under existing eligibility
rules. Purchase void becomes available after all refunds are voided. Archived
historical categories can be inherited, and an archived purchase account does
not prevent crediting a different active same-currency account. A missing or
inconsistent original conversion snapshot returns 409 rather than guessing a rate.
