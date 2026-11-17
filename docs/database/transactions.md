# Atomic transaction posting

Expense and income posting use one D1 `batch` per write. The first statement asserts active household membership; subsequent statements claim the member-scoped idempotency key, assert current account/category eligibility and projected available balances, write the transaction and signed account movement, and create an audit event. Trigger assertions use `RAISE(ABORT)` so any failure rolls the entire batch back. Prisma's D1 adapter does not provide interactive transactions and is not used for this operation.

`posting_requests` stores the normalized request and original response snapshot. A replay by an active member with the same key and payload returns that snapshot even if the transaction was subsequently changed or voided; a different payload conflicts. `posting_details` preserves the current transaction representation, including for a void after its movement is removed. Amounts are bound as decimal text and cast to SQLite integers; reads cast them back to text. The prospective available amount is the sum of account movements less reserve movements. Both affected accounts are checked on edit; SQLite integer overflow aborts the batch.

Edits and voids require the current posted version and increment it. The original author remains unchanged; the acting member is recorded on the audit event. Audit events contain before and after snapshots for edits and voids. Existing transactions with linked refunds, reserve movements, import drafts, receipt items or import references are rejected until those workflows have their own atomic posting support. Transfer, refund, reserve and import implementations must extend and reuse the same atomic assertion and write approach, including all affected accounts and relationships.

The SQL migration is authoritative for D1 views, triggers, checks and indexes; Prisma models map its persistent tables only. Apply migrations in numeric order. No deployment or existing data migration is performed by this feature.

Required updates and deletes are followed immediately by a write-only assertion
receiving SQLite `changes()`. A zero-row write raises an error before commit,
even when a trigger silently suppresses the write and the expected field values
already match. Final assertions additionally verify the transaction version,
current details, signed movement, audit snapshots and original replay response.

The existing `idempotency_keys` table records the normalized payload SHA-256 hash
and transaction link. `posting_requests` supplements it with a claim and saved
response. Its key namespace is the same household/member/request-key scope.
Neither posting claims nor diagnostic assertion rows are intentionally left by
failed batches (assertion views never retain rows).

The current engine rejects projected account totals outside 0 through
9,007,199,254,740,991 minor units and available funds below zero. An SQLite SUM
accumulator overflow also aborts safely; it cannot silently post rounded values.
The ledger stores current movements, with pre-edit and post-edit transaction
snapshots in the audit history. A void removes its effective ledger movement
and retains transaction details and its original idempotency response.

Migration 0006 adds two tables and write-only views/triggers without altering or
backfilling existing rows. Transactions created outside this engine have no
`posting_details` and are not exposed or editable through these endpoints;
historical import must use/extend the engine when implemented. There is no
production backfill or remote migration in this change. Normal deployment
applies migrations before code using the existing deployment workflow.
