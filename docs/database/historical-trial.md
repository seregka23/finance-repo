# Historical finance migration trial

The trial reads one locally supplied, approved snapshot. It creates a temporary Cloudflare D1 database through the local Worker runtime, applies the repository migrations, imports the snapshot twice into that database, and compares the results. The trial disposes of its database when it finishes. Keep a real snapshot and its report in approved private storage.

```sh
node scripts/historical-trial.mjs
node scripts/historical-trial.mjs --snapshot /path/to/approved-snapshot.json
npm run verify:historical-trial
```

The first command reports the inputs needed for reconciliation. The second prints a JSON report for the supplied snapshot. The last runs the repository's synthetic acceptance checks.

## Snapshot contract

Use the [synthetic snapshot](../../scripts/historical-trial/fixtures/synthetic.json) as a format reference. Provide `version: 1`, a stable `snapshotId`, the snapshot timestamp in `asOf`, sources under `datasets.notion` and `datasets.supabase`, and an authoritative source per dataset in `authority`. Use `[]` for a dataset known to be empty. An omitted dataset represents missing coverage. Import references preserve external record IDs and qualify them by source and dataset.

| Dataset | Required source data |
| --- | --- |
| Accounts | Stable ID, name, account type, currency, opening date and opening balance in minor units. Opening balances describe the point immediately before the imported history. Supply any later account adjustments as `adjustments` with an ID, date and signed `amountMinor`. |
| Categories | Stable ID, name and expense or income type. |
| Transactions | Stable ID, business date, type, posting status, original amount and currency, account and applicable category. Preserve recorded RSD equivalent, rate and source where available. |
| Transfers | One normalized transfer with stable ID, debit and credit legs, account IDs, original amounts and currencies. Provide each leg's source ID and any linked fee, including its own ID, amount and expense category. Use a leg or fee `date` when it differs from the transfer's date. |
| Refunds | The original expense ID and account, amount and business date. Supply a positive integer `allocationSequence` per purchase from the source or an agreed historical allocation order. Preserve the original conversion data where available. |
| Plans | Stable ID, calendar month, expense category ID and RSD minor-unit limit. |
| Reserves | Stable ID, linked account, name and dated movements with signed original minor amounts. Supply the transaction ID for any movement linked to a posting. |

All amounts use exact decimal integer strings in minor units. Resolve cross-source references to IDs from the selected authoritative datasets during export preparation. Capture Notion and Supabase at a common cutoff or record an agreed equivalent watermark for each source. Resolve collisions, account matches and known transfer pairing before providing the normalized snapshot. Keep historical attachments and receipt lines in the source systems.

Refund allocation uses the supplied sequence for historical FX rounding and the actual credit date for monthly reporting. A purchase with missing or duplicate posted refund sequences is flagged for reconciliation. Sequence gaps can represent voided refunds.

## Reconciliation

Provide independent source control totals under `controls`. Include counts for `accounts`, `categories`, `transactions`, `plans`, and `reserves`, plus `accountBalances`, `monthly`, and `reserveBalances`. The transaction count uses the target representation, with a linked fee as a separate expense and both principal legs as movements of one transaction. Balance entries use the external account or reserve ID, original currency and decimal `balanceMinor`. Monthly entries use a `YYYY-MM` month, `incomeRsdMinor`, `expensesRsdMinor`, and `missingFxCount`. Monthly expenses include fees and subtract refunds. Principal transfers affect account balances.

Review expected and actual controls, discrepancies, and counts and totals from both passes. The report lists unconfirmed transactions, transfers with missing legs, missing historical FX and other unresolved records. Keep original amounts and currencies when an FX equivalent is missing. Confirm the excluded records and remaining discrepancies with the household before relying on the trial totals.

The synthetic trial matched both import passes and all independent controls. It produced 2 accounts, 7 posted transactions, 11 account movements, 3 reserve movements and 20 import references. The account balances were `555900` RSD minor units and `10850` EUR minor units. The RSD reserve balance was `13000` minor units. The report isolated one unconfirmed transaction, one transfer with a missing leg and one expense with missing historical FX. The expense kept its EUR debit, and the RSD report counted its missing conversion separately.

## Real-data inputs still needed

- Approved, cutoff-aligned export files or normalized snapshots for both source systems in scope.
- Coverage and an authoritative source for each account, category, transaction, plan and reserve dataset.
- Cross-source ID mappings, opening balances and their dates, linked transfer sides and fee records, plus links for refunds and reserve spending.
- Recorded FX values and their provenance, plus decisions on unconfirmed operations and unmatched transfers.
- Independent control totals in the original account currencies and by reporting month.

## Delta and cutover plan

1. Agree on the destination household, cutover time, approved environment, backups and an owner for each discrepancy. Confirm which application will accept new entries after the switch.
2. Lock the trial snapshot's source IDs and record each source watermark. Run the trial with the agreed exports, review exceptions and approve the expected and actual controls.
3. At the agreed cutoff, take a final delta export since each watermark. Identify creates, edits, reversals and deletions by stable source ID and version, and resolve conflicts before applying the delta. Repeat the full reconciliation in a separate test D1 with the final dataset.
4. Document who approves the production operation, the backup and rollback criteria, and the entry system to switch to. Record the final counts and balances for the household before and after cutover.

The household still needs to decide whether Notion remains an archive, remains a place for entry, or participates in synchronization. Any synchronization decision needs a direction, record ownership and conflict rules for edits and deletions. Production execution and source access require the household's agreed scope.
