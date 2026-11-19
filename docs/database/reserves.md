# Reserve database contract

Migration `0010_reserves.sql` adds assertion views, a managed-funding marker,
indexes, and an account archive guard. Existing rows are not rewritten. Amounts
are integer minor units (1..9007199254740991); all parameters must be bound and
all checks and writes below must run in **one D1 batch**, in the order shown.
D1 batch failure rolls back the batch. Authorize the active household/member
first, in the same batch using existing access checks. IDs and timestamps are
application generated. The existing account currency is the reserve currency.

`reserve_checks(household_id,reserve_id,account_id,transaction_id,operation,amount_minor)`
accepts `create`, `allocation`, `release`, `spend`, `reversal`. Supply positive
integer `amount_minor` (use `CAST(? AS INTEGER)` for bound decimal strings),
except on `create`, when it is ignored. The checked reserve and account must be
active and in the household; reserve and account must match. For create check
active account first, insert reserve, and check the exact new row was written.

For each movement, insert `reserve_checks`, then INSERT one `reserve_movements`
row using the same arguments, with signed amount: allocation/reversal positive,
release/spend negative. Immediately insert into `posting_write_checks(changed)`
with `changes()`, then insert into `reserve_movement_result_checks` binding
`(id,household_id,reserve_id,account_id,transaction_id,operation,amount_minor)`
with the same positive amount. This last assertion protects against ignored or
altered inserts. Allocation and release have NULL transaction_id; spend and
reversal identify a managed expense. Write audit rows and verify them before
commit. Allocation checks live account balance minus all reserves; release and
spend check the live reserve sum. None of these changes account movements.

For expense posting, create its transaction header, then insert
`reserve_funding_managed(transaction_id,household_id)` before any associated
reserve movement. The marker trigger rejects any preexisting linked reserve
history, so legacy linked expenses retain `posting_linked` protection. Check
both insertions, and do not mark transactions unless funding is used. Then run
spend precheck/insert/result, `posting_checks`, and the existing posting writes
and result checks. For editing a managed expense, append a reversal for the
entire current funding followed by an optional spend for the new funding, then
run `posting_checks` with the additional column `reserve_adjusted=1` and posting writes. Old-shaped checks omit this column and retain the linked-record rejection; this protects against an older Worker after code rollback. On void append the reversal
and no new spend. Reversals and spends need individual checks and exact row
checks. The existing posting guard sees the final reserve state and computes
final account availability, including old and new accounts. As the batch can
have temporarily negative availability during a reversal, never split it.
Keep the marker after removing funding or voiding. After every managed post,
edit or void, insert into `reserve_funding_result_checks` with
`(household_id,transaction_id,reserve_id,account_id,amount_minor)`: bind the
final funding and positive integer amount, or NULL reserve/account and integer
zero when absent. This validates one effective reserve, same account/currency,
expense amount ceiling, and final availability of every affected account.
The existing transaction result and audit checks remain mandatory. Any failure
must abort the entire batch; do not catch a check and commit partial work.
Refunds append no reserve movement and never refill a reserve.

Effective funding for a posted managed expense is found by grouping its linked
movements by `(reserve_id,account_id)` and selecting the group with
`SUM(amount_minor)<0`; its amount is `-SUM(amount_minor)`. A void has no
funding. Read the marker and funding within the authorized household scope;
all historical movements remain visible. Omitted funding on existing API
requests must preserve prior payload and response shapes.

Error markers: `reserve_account_ineligible`, `reserve_ineligible`,
`reserve_amount_invalid`, `reserve_operation_invalid`, `reserve_balance_invalid`,
`reserve_funding_invalid`, `reserve_funding_legacy_or_invalid`, and
`reserve_result_invalid`. Existing posting errors remain unchanged. Archiving
an account with a nonzero net reserve aborts with `account_reserve_nonzero`;
release it while the account is active first. This guard is active as soon as
the migration deploys, so deploy code with error mapping and archive UX in
coordination. SQLite integer aggregate overflow aborts rather than silently
allowing an unsafe result. Every reserve write must follow this protocol;
legacy raw table writes are intentionally not globally restricted for fixture
and migration compatibility. Treat direct table access as trusted internal code.

Backup before deployment. Rollback requires restoring a consistent pre-migration
backup or a forward fix; dropping the marker after new managed funding exists
would lose its distinction from historical records. No data backfill is assumed.
