# Money, recorded FX and household months

Issue #8 provides reusable backend primitives. It adds no public financial HTTP
routes or page and does not register the monetary repository in the production
Worker module. Future account, transaction and report features consume these
contracts. Existing D1 migrations remain unchanged.

## Money contract

`backend/src/finance/money.ts` supports RSD, EUR, RUB and USD, each with 100
minor units per major unit. JSON money values are strings:

| Field | Encoding | Example |
| --- | --- | --- |
| `amount` | Major-unit decimal string | `"123.45"` |
| `amountMinor` | Canonical integer string | `"12345"` |
| `rsdEquivalentMinor` | Canonical integer string or null | `"1446834"` |
| `exchangeRate` | Positive decimal string or null | `"117.2000"` |
| `exchangeRateSource` | Original nonblank string, up to 200 characters, or null | `"manual"` |

These are reusable field contracts, not a newly exposed request endpoint.
`parseAmount(value, currency)` accepts whole digits with an optional sign and
one or two fractional digits. Leading zeros and a leading plus are accepted;
`formatAmount` normalizes to two fractional digits and removes negative zero.
Numbers, exponent notation, whitespace, commas, missing whole digits, trailing
decimal points and excess precision are rejected. Input is bounded to 80
characters before BigInt parsing. `parseMinor` accepts canonical integer text
only (maximum 17 characters), rejecting plus signs, leading zeros and negative
zero.

Individual amounts and recorded equivalents must be within
±9,007,199,254,740,991 minor units. Arithmetic uses BigInt internally. Only
`toD1Minor` converts to Number, after checking this bound; `fromD1Minor` rejects
unsafe or non-integer numeric results. BigInts never cross JSON boundaries.
`sumMinor` and `formatAmount` allow aggregate values beyond individual bounds.
`parseIntegerText` is an unbounded parser for trusted aggregate text, not an
external amount validator.

## FX and refunds

`fx.ts` treats rates as **RSD major units per foreign major unit**. A rate is a
positive, unsigned plain decimal string of at most 80 characters. Zero,
exponents and numeric inputs are rejected. Exact rational arithmetic rounds
half up on magnitude: signed ties round away from zero. Both the original and
converted individual amounts must fit the safe storage bounds. RSD is identity;
an optional RSD rate must equal one.

`recordConversion` returns original minor units, currency, recorded RSD minor
units and the original rate/source strings. A missing foreign rate gives a null
equivalent; it never invents a provider, rate or zero valuation. Callers must
persist this snapshot with the financial event. The helper names its returned
metadata `rate` and `source`; persistence/read DTOs use `exchangeRate` and
`exchangeRateSource`.

`cumulativeRefundRsd` uses the purchase's original rate and recorded equivalent.
It computes the difference between rounded cumulative refunds before and after
the current refund. This makes partial refunds add up exactly to the recorded
purchase valuation when fully refunded. Missing or inconsistent snapshots and
refunds exceeding the original amount are rejected. Posting, positive refund
validation, idempotency and concurrency rules belong to future workflows.

## Recorded reads and incomplete conversions

`MonetaryRepository.readRecordedMonth(identity, householdId, month)` reads raw
account movements under an atomic active-membership check. It returns `records`
with the fields above, `id` and `movementDate`, plus a `summary`:

```json
{
  "totalsByCurrency": { "RSD": "50.00", "EUR": "103.00", "RUB": "-200.00", "USD": "123.45" },
  "rsdKnownSubtotal": "11598.00",
  "incompleteConversion": true,
  "missingConversionCount": 3,
  "missingRateCount": 3,
  "affectedRecordCount": 4
}
```

`summarizeRecordedMoney` uses recorded foreign equivalents without recomputing
from their rate or a later rate. A known equivalent with a missing rate still
contributes to the known subtotal, but flags incomplete provenance. A known
rate with a missing equivalent does not trigger a recalculation. Counts cover
foreign rows missing equivalents, rates, or either (the union), including zero
amount rows. A null source alone does not increase these counts. Explicit zero
equivalents count as known. RSD uses its original value when its equivalent is
null; a conflicting recorded RSD equivalent fails instead of producing a total.
Malformed or individually unsafe persisted amounts also fail.

This is a **raw movement valuation**, including transfers, openings and other
movement kinds. It is not an income, expense or net report. Future reports must
select their eligible records and apply their workflow rules before summing.

D1 returns numbers as JavaScript Numbers. A SQL aggregate that exceeds the safe
JavaScript range must be returned as text, e.g.
`SELECT CAST(SUM(amount_minor) AS TEXT) ...`. However, SQLite still overflows
past its signed 64-bit accumulator limit; casting the result cannot fix that.
The repository instead selects each integer as text and sums with BigInt. The
native check demonstrates both the cast path above the JS limit and exact
repository totals after SQLite SUM itself overflows. Monthly reads currently
buffer their rows; pagination or streaming is a future scaling concern.

## Financial dates and household months

`calendar.ts` validates Gregorian `YYYY-MM-DD` dates (years 0001–9999) and
`YYYY-MM` months, including actual leap-day rules. A financial date is already
a household-local civil date: `monthForFinancialDate` does not shift it.
`monthDateRange` returns inclusive `startDate` and `endDate`, including 9999-12.
Repository filtering uses `movement_date`, not audit `created_at` timestamps.

`householdDateForInstant` and `householdMonthForInstant` require an explicit
`Z` or numeric offset on a timestamp, with seconds and at most three fractional
digits. They derive the civil date in the supplied household time zone, default
`Europe/Belgrade`. Callers with an existing household pass its stored zone.
Named zones supported by Intl (including UTC) are accepted; numeric offset zone
names are rejected. Household settings now use the same validator, retaining
existing HTTP 400 `INVALID_INPUT` behavior for invalid zones.

Future writers/importers must call these validators before persistence. Existing
SQL date constraints check shape only; this change does not repair legacy data
or add a migration.

## Verification

Run `npm run verify:money` for the compiled helpers and repository against native
Workerd and disposable local D1. The private fixture Worker uses trusted
synthetic identities and diagnostic routes solely for testing; these are not
production authentication or financial APIs. See the
[acceptance record](../verification/issue-8.md) for runtime evidence.
