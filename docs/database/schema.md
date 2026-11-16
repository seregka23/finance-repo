# Household finance schema

The household finance schema is introduced by the additive `backend/migrations/0002_household_finance_schema.sql`; the existing `0001_infrastructure_probe.sql` and its migration history remain unchanged. This migration defines data structures and integrity constraints, not financial workflows or HTTP endpoints. No production data migration is performed by it.

## Storage conventions

IDs are application-provided `TEXT`. Financial amounts and RSD equivalents are SQLite `INTEGER` values in the relevant currency's minor units, with signed changes for movement amounts. HTTP money values will be strings; future server code must validate individual values against JavaScript's safe integer range before binding or reading them as numbers. An aggregate can exceed that range even when each row does not: return it from D1 as text, for example `CAST(SUM(amount_minor) AS TEXT)`, and handle it with exact arithmetic rather than a JavaScript number. SQLite's own integer aggregate range still applies.

Exchange rates are decimal strings, not floating-point values. Dates use `YYYY-MM-DD` text and budget months use `YYYY-MM` text; creation/update timestamps are application-supplied text. The SQL checks date shape, not full calendar validity; future code must interpret reporting months in the household time zone. Missing foreign-currency conversion data is allowed for historical records and must not be silently treated as zero. Receipt quantities can be fractional and are represented as decimal text; receipt prices and totals use minor units.

All household-owned records carry `household_id`. Relationships between household-owned entities use composite foreign keys including `household_id`, so an identifier from another household cannot be linked. These constraints do not replace membership and role checks on reads or writes. Deletion is restricted where records are referenced; preserve history rather than relying on cascading deletion.

## Entities

- `households` stores the household, its base currency, time zone, and status. `household_members` stores identity subjects, roles, and access status within a household.
- `accounts` stores type, currency, optional member owner, personal/business designation, and status. `categories` stores household categories and their type and status. `monthly_plans` links a category to a month and its RSD limit, with at most one plan per household, month, and category.
- `transactions` stores transaction type and date, category, merchant and note, author, status, version, and optional parent transaction. The parent link supports fees and refunds; its presence alone does not validate their business rules.
- `account_movements` records signed changes on an account, optionally tied to a transaction, with currency and any recorded RSD equivalent, rate, and rate source. Opening balances and adjustments can exist independently of a transaction. Transfers require two account movements when implemented.
- `reserves` belongs to an account; `reserve_movements` records allocation, release, and spending history, optionally linked to a transaction. Currency follows the reserve's account.
- `audit_events` records an actor and timestamp for changes. `import_references` records source type and external record identifiers and links each imported record to exactly one account, category, monthly plan, transaction, or reserve. The household, source type, and source record ID are unique together for safe reprocessing.
- `idempotency_keys` stores a member, request key, normalized payload hash, and result transaction. Household, member, and key are unique together. `import_drafts` stores structured extraction, author, source type/hash, status, suggested category, provider, and resulting transaction. Its source hash is unique within household and source type. `receipt_items` links confirmed receipt lines to the draft and transaction, retaining available item names, quantities, unit prices, and totals.

`import_drafts.extracted_fields_json` must be valid JSON; `audit_events.details_json` may be null but must be valid JSON when present. These checks do not constrain the JSON shape or contents.

Raw images and full SMS text are processed during a request and must not be retained in drafts, import references, logs, or unrestricted provider-response payloads. Structured extracted fields should contain only what the review flow needs.

## Future repository contract

No financial repository or API is implemented by this migration. A future NestJS repository should accept the household scope for every operation, use parameterized D1 queries, and expose typed records without losing integer or decimal precision. Transaction listing should use the household/date/identifier index and a descending `(transaction_date, id)` cursor. A write operation should accept the actor and expected transaction version, and return enough information to distinguish a stale version, an idempotent replay, and a conflicting payload. A draft confirmation should link its receipt items and transaction and update the draft in the same atomic batch. The receipt item foreign key requires its transaction to match the draft’s linked transaction, so the draft must be linked before inserting its items within the batch.

The schema supplies scoped foreign keys and uniqueness, but later issues must implement authorization and revocation checks, validation of inputs and state transitions, version-checked writes, idempotency replay behavior, available-funds and reserve checks, refund limits and conversion rounding, and transaction posting and audit semantics. Related transaction, movement, fee, reserve, idempotency, and draft changes must be atomic; any failed required check must abort the D1 batch. An index or foreign key alone does not establish those business guarantees.

## Migration operation and recovery

See [migration and recovery guidance](migrations.md) for local validation, explicit
target selection, replay compatibility, and forward-fix/recovery steps. Do not
use table drops as a rollback once financial records exist.
