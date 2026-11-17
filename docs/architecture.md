# Application code boundaries

The backend runs NestJS in a Cloudflare Worker; Angular is served from the same
origin. This refactor separates responsibilities without changing routes, JSON
contracts, native authentication, accounting rules or the visual design.

## Backend

Auth and household features now keep HTTP concerns, business operations, access
policy and contracts in separate files:

| Area | Responsibility |
| --- | --- |
| `backend/src/auth/auth.controller.ts` | Registration/login/logout/config routes and cookies. |
| `backend/src/auth/auth.service.ts` | Credential, session and throttle operations. |
| `backend/src/auth/api-auth.guard.ts` | Request authentication and origin policy. |
| `backend/src/auth/auth.crypto.ts`, `auth.http.ts` | Existing hashing/token and HTTP parsing helpers. |
| `backend/src/auth/auth.types.ts`, `auth.errors.ts` | Identity/request contracts and error factories. |
| `backend/src/households/households.controller.ts` | Household, member and invitation HTTP routes. |
| `backend/src/households/households.service.ts` | Household and invitation operations. |
| `backend/src/households/household-access.service.ts`, `household.guard.ts` | Membership lookup, live batch assertions and route policy. |
| `backend/src/households/households.types.ts`, `households.errors.ts`, `households.validation.ts`, `households.tokens.ts` | Contracts and existing focused helper functions. |
| `backend/src/database/database.types.ts`, `database.tokens.ts` | Shared D1 interface and dependency token, independent of controllers. |

`auth/auth.ts` and `households/households.ts` remain compatibility entry points
for existing consumers and verification fixtures. New internal dependencies use
canonical leaf files rather than importing these entry points, preventing
circular dependencies and keeping Nest DI class identity stable.

WorkerModule still registers the same controllers, providers and global guards.
SQL, migrations, Prisma mappings, transaction posting and atomic D1 batches are
unchanged. The Prisma adapter's transaction limitation still requires financial
compound writes to use the D1 binding's batch API.

## Frontend

| File | Responsibility |
| --- | --- |
| `frontend/src/app/api.ts` | Stable public `Api` facade and compatibility type/error exports. |
| `frontend/src/app/api-transport.ts` | Same-origin HTTP requests, JSON/error decoding and 204 handling. |
| `frontend/src/app/api-types.ts` | Session, household, member and auth configuration contracts. |
| `frontend/src/app/session-state.ts` | Shared session/household signals, refresh and access-loss recovery. |
| `frontend/src/app/auth-panel/` | Sign-in/registration choice, form state, validation, submission and focus. |
| `frontend/src/app/app.ts` | Shell, navigation, initial loading, logout and invitation handling. |

Api and AuthPanel share the same injected state through the facade. SessionState
uses ApiTransport directly so transport does not depend on application state and
there is no Api ↔ SessionState cycle. Existing callers retain `request`,
`refreshSession`, `handleError`, `session` and `selectedId`.

The refactor retains native fetch/cookie handling and existing form semantics.
A transport migration or form redesign is a separate change. AuthPanel preserves
the original labels, IDs, validation, focus behavior and global stylesheet
classes; it receives the pending invitation as a signal input.

## Verification

Build applications before executing the native/browser suites:

```sh
npm run build
npm --prefix backend test
npm --prefix backend run lint
npm --prefix frontend test -- --watch=false
node scripts/verify-transactions.mjs
node scripts/verify-auth.mjs
node scripts/verify-navigation.mjs
```

The existing Prisma/D1 CI workflow now also triggers on frontend changes and
runs Angular unit tests. Native API tests continue to use disposable local D1;
browser suites check authentication, invitations, navigation, responsive
layouts and accessibility against that local fixture.
