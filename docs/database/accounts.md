# Accounts persistence

Migration 0007 adds optimistic versions and a durable currency lock. The lock is backfilled from transaction movements, posting details, and transaction audit snapshots, and is set when a transaction movement is inserted. Voiding or moving a transaction does not clear it. Currency correction before the first transaction updates opening and adjustment movement currencies and clears their FX metadata while leaving nominal minor amounts unchanged; accounts with reserve history cannot change currency.

Reads and writes assert active household membership in the same D1 batch. Both members have equal access; an owner is display metadata and must be an active household member when selected. Writes check versions and affected row counts before commit. Adjustments are signed ledger movements, not income or expense transactions. Balances and reserve totals are aggregated as SQLite integers and returned as decimal strings; integer aggregate overflow fails rather than rounding.

SQL migrations are authoritative. Migration 0007 is additive; recovery from a failed rollout should restore a database backup or use a reviewed forward migration. Existing financial history must not be deleted to undo the lock.
