# Issue #8 acceptance record

Verified on 2026-11-17 using Node 24.22.1, Wrangler 4.163.0, the repository's
compiled NestJS backend and native Workerd with disposable local D1. No remote
migrations, deployment, credentials or FX provider were used.

## Commands and results

- `npm run verify:money`: backend build and nine Worker/D1 groups passed.
- `npm test --prefix backend`: nine files, 28 tests passed.
- `npm run lint --prefix backend`: passed.
- `npm run build --prefix backend` followed by
  `node scripts/verify-access.mjs`: eight actual Worker/D1 groups passed,
  including invalid/numeric-offset household time-zone rejection.

`verify:money` creates its own private fixture Worker, generated configuration
and isolated local D1 state, applies all four existing migrations and removes
its own state on completion. Fixture identities are trusted synthetic test
inputs; this harness does not claim to test public authentication. The separate
access verifier exercises the real signed-session API and live membership
checks. Diagnostic routes exist only in the generated fixture, not the app.

## Observed money and persistence behavior

1. String parsing, all four currencies, minor-unit conversion, safe positive
   and negative boundaries, precision errors, oversized input and unsafe D1
   Number bindings were exercised in the Worker runtime.
2. Exact signed half-up FX, decimal-string rates, source preservation, null
   foreign conversions and converted-value overflow were checked.
3. Cumulative partial refunds matched the recorded full purchase value,
   including rounding distributions of `1,0,1` and `2,0` RSD minor units.
   Over-refunds and missing/inconsistent snapshots failed.
4. Invalid dates, leap years, inclusive December 9999, explicit timestamp
   offsets and household months at Belgrade/New York boundaries were checked.
   Belgrade's seasonal offset was exercised around the March month boundary.
5. Eight persisted January movements retained original money/rate/source
   strings and returned `11598.00` known RSD subtotal, three missing equivalent
   rows, three missing rate rows and four affected rows. A deliberately
   different recorded equivalent was preserved rather than recomputed from its
   rate. Adding a later-rate February record left January unchanged. Zero and
   negative values and incomplete legacy metadata were included.
6. SQL `CAST(SUM(...) AS TEXT)` returned `9007199254740993`, above the JS safe
   integer range, exactly. The repository returned `90071992547409.93` major
   units. Individually unsafe persisted strings were rejected by the summary.
7. With 1,025 rows each containing the maximum safe minor amount, SQLite's
   SUM raised `integer overflow`. The repository's per-row text reads and
   BigInt accumulation returned the exact total `92323792361095157.75` instead.
8. The same instant selected different months in two stored household zones.
   Reads used financial dates despite later audit timestamps. Shared-member
   reads succeeded; cross-household access, invalid months and access after
   revocation were rejected.
9. A persisted RSD value conflicting with its recorded RSD equivalent failed
   with a typed consistency error instead of returning a misleading total.

## Review and scope

Backend and database specialists implemented their respective modules. An
independent financial review identified unbounded external amount parsing and
unsafe individual values entering summary arithmetic. Both were fixed, tested
and confirmed resolved by the reviewer.

See [the contract](../finance/primitives.md) for encodings, rounding, missing-data
semantics and calendar rules. No migration or public financial endpoint was
added. The repository reads raw movements, not classified financial reports;
future features still supply posting rules, eligible report records, API error
mapping and UI. Monthly reads currently buffer rows. Existing date-shape SQL
constraints are unchanged; future writers must use the new calendar validator.
