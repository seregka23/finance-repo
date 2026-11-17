# Frontend refactor verification

The frontend now has explicit core, feature and shared boundaries. See the
[architecture guide](../frontend-architecture.md). No routes, API payloads,
database schema, dependencies or user workflows were changed.

## Changes and preservation checks

- The app root retains shell/bootstrap/routes. Core holds transport, session,
  workspace, API contracts and localization. Feature folders own their pages,
  templates, styles and data clients; shared modules own pure formatters and
  reusable UI.
- The localization service is 42 lines instead of 686; RU/SR catalogs now live
  in dedicated typed data files. A TypeScript-AST comparison against base commit
  `d21c589` confirmed all 266 keys and exact values in each language are unchanged.
- The account HTTP client is 52 lines instead of 111. Account contracts, pure
  money/calendar helpers and typed form factories have separate modules.
  AST comparisons confirmed the three formatter implementations are unchanged;
  their existing tests were relocated beside the helpers without changing
  assertions.
- The static API error-message table is separate from session recovery. Its
  keys/values match the original; 401 handling, household recovery and state
  side effects retain their original precedence.
- Independent read-only review confirmed moved HTML/CSS and core API/transport/
  contracts/workspace byte-for-byte against the base. Account HTTP methods and
  page methods from `today()` onward are unchanged, including request generation,
  household switching, cleanup and balance-change review.
- All 30 production TypeScript files resolve relative imports, including lazy
  imports, with no cycles. Core has no feature imports, and pure formatters have
  no API dependency. Singleton decorators and class/error identity are preserved.
- Removed unused starter `app.css`; no consumer of its `api-status` styles exists.

## Executed validation

| Check | Observed result |
| --- | --- |
| `npm --prefix frontend run build` | Frontend specialist observed production build passing. |
| `npm --prefix frontend test -- --watch=false` | All 29 tests across 7 files passed; root reran after helper-test relocation. |
| One-time AST comparisons against base `d21c589` | RU/SR catalogs, error table and three pure formatters unchanged. |
| `node scripts/verify-localization-ui.mjs` | All 13 Chromium/native Worker/local D1 groups passed, including axe, three languages, storage, titles, exact amounts and comma-input API writes. |
| `node scripts/verify-accounts-ui.mjs` | Frontend specialist observed all 6 desktop/mobile groups passing after the responsive correction, including axe and 320px reflow. |
| `git diff --check` | Passed. |

The accounts browser script initially expected pre-localization ISO movement
dates. Its English fixture now explicitly uses `en-US` and asserts the current
localized date and existing movement labels. Production templates were not
changed to satisfy the stale test. The expanded account run then exposed an
inherited narrow-screen header issue when more than one household is available:
the native selector extended to x=331.86 at a 320px viewport. The frontend
specialist corrected the mobile label/select flex sizing and gave the household
group a full row at <=600px. History styling was left unchanged; no overflow was
hidden. The final build and all 6 account-browser groups passed. The orchestrator
inspected the narrow screenshot: selector, large amounts, history and actions
remain visible. All browser writes use synthetic data in disposable local D1.
No production migration, deployment or financial-data mutation was performed.

Review found no actionable production-code defect. It did not independently run
the full test/browser suites; its static checks and the frontend/root execution
results are distinguished above.

## Agents, skills and runtime metadata

Frontend implementation → independent reviewer → responsive correction ran sequentially. The orchestrator
handled contract verification, test integration, native browser regression tests,
documentation and PR delivery. Times are Europe/Belgrade (CET) on 2026-11-17 and
include tools/waits, not active model compute.

| Agent | Requested settings | Contribution | Measured interval |
| --- | --- | --- | --- |
| `/root` | Model/reasoning unavailable | Coordination, verification and PR | Task starts 20:58:19; elapsed reported at delivery. |
| `/root/frontend_refactor` | `gpt-6.1-terra` / medium | Frontend separation, tests and responsive correction | Initial 20:59:46–21:02:24, 2m38s; measured correction 21:08:28–21:13:28, 5m. Cleanup and another successful browser rerun after that interval were not fully timed. |
| `/root/frontend_refactor_review` | Profile `gpt-6-luna` / high unavailable; launch inherited settings | Read-only preservation/dependency review | 21:03:18–21:04:34, 1m16s; excludes time before first clock. |

Effective models/reasoning and input/output/cached token telemetry are unavailable.
Requested profile/launch settings do not confirm effective runtime settings.
Missing metrics are not estimated.

Skills were read and applied as instructions; no bundled skill script was run:

- Root: `.agents/skills/angular-developer/SKILL.md` and its
  `references/naming-conventions.md`, `references/creating-services.md`, plus
  previously read `signals-overview.md`, `pipes.md`, `http-client.md`,
  `testing-fundamentals.md`, `cli.md`, `e2e-testing.md` under `references/`.
  Applied feature/core/shared organization, singleton preservation and existing
  native Playwright/axe regression fixtures. Previously read Cloudflare
  `skill://plugin_asdk_app_6abc2a9552748191b465859a06e90da3/wrangler/SKILL.md`,
  `workers-best-practices/SKILL.md` and its `references/runtime-patterns.md`
  (same provider root) informed isolated local runtime verification.
- Frontend: `.agents/skills/angular-developer/SKILL.md` and its
  `references/naming-conventions.md`, `references/creating-services.md`,
  `references/signals-overview.md`, `references/pipes.md`,
  `references/http-client.md`, `references/reactive-forms.md`,
  `references/testing-fundamentals.md`, `references/define-routes.md`,
  `references/loading-strategies.md`. Applied coherent boundaries, existing
  reactive forms, stable singleton identities and lazy routes. The responsive
  follow-up also read `references/component-styling.md`; fixed measured flex
  overflow and validated the actual browser instead of relaxing assertions.
- Reviewer: `.agents/skills/angular-developer/SKILL.md` and its
  `references/naming-conventions.md`, `references/di-fundamentals.md`,
  `references/creating-services.md`, `references/defining-providers.md`,
  `references/hierarchical-injectors.md`, `references/signals-overview.md`,
  `references/reactive-forms.md`, `references/http-client.md`,
  `references/define-routes.md`, `references/loading-strategies.md`,
  `references/testing-fundamentals.md`, `references/router-testing.md`,
  `references/component-styling.md`. Applied Angular 22 DI, state, form,
  lazy-routing and template/style compatibility review. Read root/frontend
  `AGENTS.md` and the configured reviewer profile.
