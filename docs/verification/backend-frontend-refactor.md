# Backend/frontend refactor verification

The refactor separates application responsibilities while preserving public API
contracts and visual behavior. See [architecture](../architecture.md) for the
new file boundaries. SQL migrations, financial posting logic, dependencies,
Wrangler configuration and production data are unchanged.

## Validation observed

| Command | Result |
| --- | --- |
| `npm --prefix backend test` | 53 tests passed across 12 files. |
| `npm --prefix backend run lint` | Passed. |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | Passed. |
| `cd backend && npx nest build` | Passed. |
| `npm --prefix frontend test -- --watch=false` | 16 tests passed across 4 files. |
| `cd frontend && npx ng build` | Passed. |
| `node scripts/verify-transactions.mjs` | 14 native Workerd/D1 scenario groups passed. |
| `node scripts/verify-auth.mjs` | 4 browser groups passed, desktop/mobile. |
| `node scripts/verify-navigation.mjs` | 8 browser groups passed. |
| `git diff --check` | Passed. |

All mutation checks used synthetic accounts and disposable local D1. Browser
checks also run native household access verification first. They cover real
registration/sign-in, wrong-password rejection, persistence, logout, invitation
flows, first-use household creation, six routes, active links/titles/history,
loading/failure/retry, keyboard dialogs and focus restoration, 320px reflow, and
household switching. Their axe checks cover desktop and mobile accessibility.
Generated screenshots/reports remain ignored local verification artifacts.

Added tests cover cookie credentials and 204 responses through the extracted
transport, plus household/session recovery through the preserved Api facade.
Existing registration tests exercise the extracted AuthPanel. The existing
GitHub workflow now includes frontend paths and Angular unit tests, in addition
to clean builds and its native D1/backend suites.

Independent review found no actionable regressions after comparing the original
and extracted code, public exports, DI identity, import graph, crypto/constants,
origin/cookie policy, membership/batch ordering, routes/status codes, frontend
signals, auth handlers/markup and global stylesheet application.

## Applied skills

Skills were read and their instructions applied; they are not executable tools.

- Orchestrator: `.agents/skills/nestjs-best-practices/SKILL.md`, its
  `rules/arch-single-responsibility.md` and `rules/arch-module-sharing.md`;
  `.agents/skills/angular-developer/SKILL.md`, its
  `references/di-fundamentals.md`, `references/testing-fundamentals.md`,
  `references/http-client.md`, `references/components.md`,
  `references/reactive-forms.md`, `references/router-testing.md`.
  Applied focused responsibilities, shared provider identity, existing HTTP
  contracts and regression checks against real routing/runtime behavior.
- Backend specialist: `.agents/skills/nestjs-best-practices/SKILL.md`, its
  `rules/arch-avoid-circular-deps.md`, `rules/arch-single-responsibility.md`,
  `rules/di-prefer-constructor-injection.md`,
  `rules/error-throw-http-exceptions.md`, `rules/security-use-guards.md`,
  `rules/security-validate-all-input.md`, `rules/db-use-transactions.md`.
  Applied leaf imports, constructor DI, focused files and preserved existing
  validation/errors/guards/atomic batches. DTO/TypeORM examples were adapted
  to the existing no-dependency validation and D1 runtime.
- Frontend specialist: `.agents/skills/angular-developer/SKILL.md`, its
  `references/cli.md`, `references/http-client.md`,
  `references/di-fundamentals.md`, `references/creating-services.md`,
  `references/signals-overview.md`, `references/components.md`,
  `references/inputs.md`, `references/outputs.md`,
  `references/component-styling.md`, `references/template-driven-forms.md`,
  `references/define-routes.md`, `references/testing-fundamentals.md`;
  `DESIGN.md` and `docs/design/family-finance-design.html` visual conventions.
  Used CLI scaffolding, signal input/state, singleton DI and focused services.
  Preserved native fetch and existing forms instead of changing transport or
  form behavior during extraction.
- Reviewer: both skills above; Nest rules `arch-module-sharing.md`,
  `arch-avoid-circular-deps.md`, `di-use-interfaces-tokens.md`,
  `security-use-guards.md`, `security-auth-jwt.md`,
  `error-throw-http-exceptions.md`, `test-use-testing-module.md`; Angular
  references `components.md`, `creating-services.md`, `defining-providers.md`,
  `reactive-forms.md`, `http-client.md`, `testing-fundamentals.md`,
  `component-styling.md`, `signals-overview.md`, `di-fundamentals.md`.
  Reviewed provider/cycle/access/error boundaries and Angular 22 signal/UI
  behavior. No new JWT authentication was introduced by reading that rule.

Backend remains NestJS 12 and frontend Angular 22. No framework upgrades or
new packages were needed. Existing tests were reused; no implementation-mirroring
backend tests were added for file extraction alone.

## Execution metadata

| Agent | Contribution | Requested model / reasoning | Measured UTC interval on 2026-11-17 |
| --- | --- | --- | --- |
| `/root` | Scope, integration, CI, dependency-token cleanup, native/browser checks and PR | Unavailable | Start 16:12:58; final elapsed reported on delivery. |
| `/root/refactor_backend` | Backend auth/household boundaries | `gpt-6.1-terra` / medium | 16:14:01–16:16:38, 2m37s. |
| `/root/refactor_frontend` | Transport/session/auth-panel boundaries | `gpt-6.1-terra` / medium | 16:14:20–16:17:13, 2m53s. |
| `/root/refactor_review` | Independent read-only review | `gpt-6-luna` / high | 16:17:40–16:18:53, 1m13s. |

Times include tools/waits and are elapsed wall time, not active compute time.
Specialist measured intervals exclude initial dispatch before their clock reads.
Effective runtime models/reasoning and all per-agent input/output/cached token
telemetry are unavailable. Requested labels above come from the configured
profiles and launch requests, not inferred effective settings.
