# Transaction CSV export

`GET /api/v1/households/:householdId/transactions/export` uses the [transaction list filters](transactions.md), including the same literal search, date range, category, status, and account filters. The export covers all matching pages in transaction date and ID order, both descending. `limit` and `cursor` are list controls and are rejected on the export route.

The response requires an active household membership. It is served as `text/csv; charset=utf-8` with the attachment filename `transactions.csv` and `Cache-Control: no-store`. The encoding includes a UTF‑8 byte order mark for spreadsheet import. CSV records use CRLF. Fields containing commas, quotes, or line breaks are quoted and any embedded quotes are doubled. Embedded line breaks are preserved. A query with zero matches returns the header.

The header order is stable:

```csv
transaction_id,date,type,status,account,amount_minor,currency,category,merchant,note,rsd_equivalent_minor,to_account,received_amount_minor,received_currency,transfer_id
```

Amounts use integer minor units and keep the posted currency. A transfer occupies one row with the debit in `account`, `amount_minor`, and `currency` and the credit in `to_account`, `received_amount_minor`, and `received_currency`. A matching fee is a separate row with the parent transaction ID in `transfer_id`. Missing or inapplicable values are empty. `rsd_equivalent_minor` uses the recorded conversion when available. For spreadsheet workflows that need exact identifiers and large integers, import those columns as text.

Untrusted text that a spreadsheet could treat as a formula gets a leading apostrophe before CSV escaping. This intentionally changes the parsed text of those cells. Numeric columns are unaffected.

Exports over 8 MiB return `413 EXPORT_TOO_LARGE` before a file is sent. Use narrower filters for a smaller export. Each page is authorized and read using the list's cursors. Concurrent edits can change matching rows during a long export.
