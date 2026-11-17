# Frontend architecture

The Angular application is organized by feature and responsibility. Standalone
components, routes, API contracts, form behavior and the existing design are
preserved; this structure introduces no additional state framework.

```text
frontend/src/app/
├── app.ts / app.html          # Shell, navigation, invitation entry and titles
├── app.config.ts
├── app.routes.ts              # Existing URLs and lazy feature imports
├── core/
│   ├── api.ts                 # Shared Api facade and type/error exports
│   ├── api-transport.ts       # Same-origin fetch, JSON and error decoding
│   ├── api-types.ts           # Session/household/member contracts
│   ├── session-state.ts       # Session state and access-loss recovery
│   ├── api-error-messages.ts  # Canonical safe display messages by error code
│   ├── workspace.ts           # Shared household workspace state
│   └── i18n/
│       ├── localization.ts    # Language state, persistence and interpolation
│       ├── ru-catalog.ts      # Russian messages and message-key type
│       └── sr-catalog.ts      # Serbian Latin messages with matching keys
├── features/
│   ├── accounts/              # Page/template/style, HTTP client, models, forms
│   ├── categories/            # Page/template/style and HTTP client
│   ├── finance/               # Dashboard and pending finance routes
│   ├── settings/              # Household settings and member management
│   └── auth/auth-panel/       # Registration/login form
└── shared/
    ├── formatters/            # Pure exact money and calendar-date functions
    └── ui/                    # Reusable results-state component
```

Tests are colocated with their features or helpers. App/bootstrap tests remain
at the root. The former flat forwarding files are not retained; imports point
to one canonical implementation so singleton service and error-class identities
remain consistent.

## Dependency boundaries

- The shell loads feature pages lazily. Features consume core API/state and
  shared helpers; core does not import feature components or feature models.
- `Api` composes `ApiTransport` and `SessionState`. `SessionState` uses the
  transport directly, preserving the existing dependency direction and avoiding
  an Api/session cycle. Authentication and household-recovery side effects stay
  in session state; the extracted error map contains only display messages.
- Pure formatters have no Angular, HTTP or feature-state dependencies. Exact
  minor-unit and date-only behavior is shared without importing an account HTTP
  client. Shared UI may consume core localization but not account/category state.
- Account models define data contracts independently of HTTP operations.
  `account-forms.ts` constructs fresh typed forms; submission, confirmation,
  household time-zone defaults and stale-response/destroy guards remain in the
  page component. Existing reactive forms are retained.
- Translation catalogs contain data and matching message keys. The localization
  service manages language behavior; existing English source keys and the
  financial-account label alias remain unchanged. See the
  [localization guide](frontend-localization.md).

## Validation

```sh
npm --prefix frontend run build
npm --prefix frontend test -- --watch=false
node scripts/verify-localization-ui.mjs
node scripts/verify-accounts-ui.mjs
```

Build the backend first when its generated output is absent; the browser suites
reuse the existing native Worker/disposable local D1 fixture. They require
Chromium (`CHROMIUM_EXECUTABLE_PATH` can override its executable) and perform axe
checks. No backend or database change is required for this frontend structure.
See the [refactor verification](verification/frontend-refactor.md) for evidence
and execution metadata.
