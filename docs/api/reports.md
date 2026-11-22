# Dashboard and monthly reports

Both routes are under `/api/v1/households/:householdId` and require active household membership. Amounts are integer strings in minor units.

| Route | Query | Result |
| --- | --- | --- |
| `GET /dashboard` | — | `{month, totals, balances, recentTransactions}` |
| `GET /reports/monthly` | Optional `month=YYYY-MM`, `categoryId`, `merchant` | `{month, monthTransactionCount, matchedTransactionCount, totals, balances, byCategory, byMerchant}` |

When the month is omitted, the server uses the current calendar month in the household time zone. The dashboard uses that month for cash flow and includes the 15 most recent posted transactions across all months, sorted by transaction date then ID, both descending. Each entry includes `id`, `transactionDate`, `type`, `merchant`, `categoryName`, `amountMinor`, `currency`, and `accountName`. Transfer entries also include `toAccountName`, `creditAmountMinor`, and `creditCurrency`. The primary amount is the transfer debit or the positive magnitude of the recorded posting. Legacy headers may lack amount, currency, or account information.

## Totals and filters

`totals` contains `incomeMinor`, `expenseMinor`, and `netMinor` in recorded RSD, plus `missingFxCount` and `originalCurrencies`. Each original-currency entry contains `currency`, `incomeMinor`, `expenseMinor`, and `netMinor` without conversion. Category rows contain `categoryId`, `name`, `expenseMinor`, and `missingFxCount`. Merchant rows contain `name`, `expenseMinor`, and `missingFxCount`. Where the source has no category or merchant name, the corresponding value may be `null`.

Budgets and reports use the same posted reporting movements and recorded FX valuation. Fees count as expenses. A refund subtracts from expenses in the month it was credited. An unlabelled refund uses its purchase merchant for merchant grouping and filtering. Net cash flow equals income minus expenses. Transfer principal, opening balances, and account adjustments are excluded from cash flow.

`monthTransactionCount` counts all posted transactions in the selected month, including transfers and their separately posted fees. `matchedTransactionCount` applies the category and merchant filters. The merchant filter matches a case-insensitive literal substring. Filters affect cash flow and breakdowns. Balance rows show the household ledger through the last day of the selected month, or all current recorded movements on the dashboard. Each row includes `currency`, `balanceMinor`, `reservedMinor`, and `availableMinor` in the original currency.

Missing foreign rates or equivalents increment `missingFxCount`. When nonzero, the RSD numbers are known subtotals and the original-currency rows remain available. A stored foreign equivalent contributes even if the rate metadata is missing. No exchange rate is inferred. Invalid month or query values return `400`, and inaccessible households return `404`.
