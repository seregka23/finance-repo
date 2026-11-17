# Frontend localization verification

The existing Angular application now switches at runtime between English,
Russian and Serbian Latin. The selector is available before and after sign-in;
browser storage retains the choice when available. Supported browser languages
are used on first visit, with English fallback. No backend API, database schema
or saved financial values are changed. See the [guide](../frontend-localization.md).

## Scope and evidence

Navigation, authentication, forms, empty/loading/error/success states, account
metadata, category suggestions, invitations, accessibility labels and document
titles use the active language. Named interpolation preserves saved user data;
auth account creation and financial account creation have distinct translations.
Known API error codes map to localized actionable messages; unknown provider
text is replaced with a safe generic message. Existing errors translate again
when the language changes.

Money is formatted using string minor units, BigInt and Intl grouping/decimal
parts. RU/SR amount input accepts one decimal dot or comma, rejects grouping or
mixed separators, and sends unchanged canonical minor-unit strings to the API.
English input keeps its dot-only contract. Calendar dates retain their day;
timestamps/months preserve the household time zone. The app owns localized
document titles; competing static Router titles were removed.

The final frontend production build and all 29 unit tests passed. The orchestrator
ran `node scripts/verify-localization-ui.mjs`: all 13 Chromium groups
passed, with WCAG A/AA axe checks and no page errors. The production app and API
were served through the existing disposable native Workerd/local D1 fixture.
No production data was written. Checks covered:

- Pre-authentication switching, live registration validation translation and
  language/title persistence after reload; unknown API error text never appears.
  Real invalid credentials return a specific translated error rather than a
  misleading session-expired message.
- Each language's account heading/title, exact max-safe monetary balance and
  localized date-only history in an America/Los_Angeles browser context.
- Saved Unicode account name containing literal `<cash>` remains unchanged.
- Russian and Serbian comma inputs post exactly `-5` minor units for `-0,05`,
  verified through the actual API and saved account balance.
- Route title changes without URL changes, RU/SR 320px reflow and accessibility,
  invalid preferences, blocked local storage and unsupported-language fallback.

Screenshots/report are generated under ignored
`.cloudflare/localization-verification/`. The orchestrator inspected Russian
mobile settings and Serbian desktop accounts against the project reference.
A stray literal `>` beside an account-form hint was found visually and removed.

## Independent review and follow-up

Read-only review scanned 266 matching RU/SR message keys and their placeholders,
checked literal translation calls and found no other translation/financial
issue. It confirmed no backend diff. One P2 was reproduced: `Date.UTC` remaps
years 0001–0099 into 1901–1999 although the API accepts those early years.
The frontend specialist corrected this with validated ISO midnight-UTC parsing
and a pure calendar-date helper. Early-year and modern-date regression tests
passed; the final frontend build and all 29 unit tests passed. Static diff and
browser-script syntax checks also passed.
The reviewer confirmed resolution by executing the actual helper through 18
cases covering early/modern dates, three locales and two host time zones.

## Agents, skills and telemetry

Frontend implementation → independent reviewer → frontend correction ran
sequentially. The orchestrator handled scope, integration, browser/API/axe tests,
visual inspection, documentation and PR. Times below are Europe/Belgrade (CET),
2026-11-17; elapsed intervals include tools and waits and are not model compute.

| Agent | Requested model / reasoning | Contribution | Measured interval |
| --- | --- | --- | --- |
| `/root` | Unavailable | Integration, browser checks and PR | Task starts 20:27:34; final elapsed at delivery. |
| `/root/localization_frontend` | `gpt-6.1-terra` / medium | Three-language frontend implementation and unit tests | Initial 20:29:16–20:39:06, 9m50s (partial); correction 20:42:33–20:44:08, 1m35s. |
| `/root/localization_review` | Profile `gpt-6-luna` / high unavailable; launch inherited settings | Read-only review, early-year reproduction and fix verification | Initial 20:40:04–20:41:41, 1m37s; targeted recheck 20:44:47–20:45:00, 13s. |

Effective model/reasoning and input/output/cached token telemetry are unavailable
for all participants. Requested profile settings do not prove effective runtime
settings; no token estimates substitute for missing telemetry.

Skills were read/applied as instructions; no bundled skill script was run:

- Orchestrator: `.agents/skills/angular-developer/SKILL.md` and its
  `references/signals-overview.md`, `references/pipes.md`,
  `references/http-client.md`, `references/testing-fundamentals.md`,
  `references/cli.md`, `references/e2e-testing.md` (previously read references
  remained in use). Preserved the existing Playwright/axe fixture, checked
  reactive updates, exact money and native API behavior. Existing Cloudflare
  guidance informed isolated local-only verification:
  `skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3/wrangler/SKILL.md`,
  `skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3/workers-best-practices/SKILL.md`
  and the latter's `references/runtime-patterns.md` (read earlier in this session).
- Frontend: `.agents/skills/angular-developer/SKILL.md` and its
  `references/signals-overview.md`, `references/pipes.md`,
  `references/http-client.md`, `references/reactive-forms.md`,
  `references/template-driven-forms.md`, `references/testing-fundamentals.md`,
  `references/router-testing.md`, `references/define-routes.md`,
  `references/router-lifecycle.md`. Applied injected signal state, existing form
  integration, localized title ownership and zoneless `whenStable()` tests.
  Read `DESIGN.md` and `docs/design/family-finance-design.html` for visual rules.
- Reviewer: `.agents/skills/angular-developer/SKILL.md` and its
  `references/signals-overview.md`, `references/pipes.md`,
  `references/reactive-forms.md`, `references/http-client.md`,
  `references/testing-fundamentals.md`, `references/define-routes.md`,
  `references/router-testing.md`. Also read
  `skill://plugins_6a5028ae047081918e3dfde753112690/impeccable/SKILL.md`
  and its `reference/audit.md` for focused accessibility/responsive review.
  The skill launcher fallback was unavailable; it read the repository design
  references directly. Its review did not rerun browser/axe/build checks; those
  were executed separately by the orchestrator/frontend specialist.
