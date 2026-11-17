# Registration, sign-in and household access

The site is public. Visitors can create an account with email and password,
sign in, or return to an existing session. Cloudflare hosts Angular, the NestJS
Worker and D1; Cloudflare Access is no longer the application login provider.
There is no team-domain, audience, OAuth client or application secret to set up.

## Deploying the change

Apply the additive `0005_native_auth.sql` migration to the intended D1 target
before deploying this version. It creates `auth_users`, `auth_sessions` and
`auth_throttles`; it does not alter financial data or household memberships.
Use the [migration guide](database/migrations.md) and verify the selected target.
For the existing default Worker, whose database is `family-finance-test`:

```sh
npx wrangler d1 migrations apply DB --remote --env ""
npm run deploy
```

These commands change the remote database/deployment; tests never run them.
For local development, use `npm run db:migrate:local` and
`npm run dev:cloudflare`. The existing plain Node starter does not provide D1
authentication; use the local Worker for the full application.

If Cloudflare Access was enabled in the dashboard, remove its protection from
this site's public hostname/Worker so visitors can reach registration. Existing
account-wide Access policies can also apply. Removing repository Access
variables does not modify dashboard policies. Ensure the public API and Angular
assets are served from the same HTTPS origin.

The three old `ACCESS_*` variables are no longer read. Configuration is removed
from Wrangler to prevent the old setup screen. Historical issue verification
records describe the Access implementation that existed at that time; this
document supersedes those deployment instructions.

## API contract

All application routes are under `/api/v1`. Auth/session responses use
`Cache-Control: no-store`. Money and household API contracts are unchanged.

| Method/path | Request | Success |
| --- | --- | --- |
| GET `/auth/config` | None | 200 `{configured:true,signInUrl:null,signOutUrl:null}` |
| POST `/auth/register` | `{email,password}` | 201 `{user:{email}}`, new session cookie |
| POST `/auth/login` | `{email,password}` | 200 `{user:{email}}`, new session cookie |
| POST `/auth/logout` | Cookie, no required body | 204, session revoked and cookie expired |
| GET `/session` | Session cookie | 200 `{user:{email},households:[...]}` |

Email is normalized to lowercase and is limited to 254 characters. Passwords
must contain 12–128 characters; confirmation is checked in Angular and is never
sent to the server. Unknown fields and malformed credentials are rejected with
400 `INVALID_INPUT`. Failed login and duplicate registration share 401
`INVALID_CREDENTIALS` with no database details. Missing, invalid, expired or
revoked sessions return 401 `UNAUTHENTICATED`.

Every state-changing request, including login, registration and logout, must
have an `Origin` exactly equal to its original Worker request URL's origin.
Browser requests supply this automatically. The Worker overwrites internal
origin/client-IP headers before forwarding to Nest, so callers cannot choose a
trusted origin by submitting those headers. HTTPS is required, except local
loopback HTTP development. Rejected origins return 403 `INVALID_ORIGIN`.
Cross-origin CORS is not enabled.

## Passwords and sessions

Passwords use PBKDF2-SHA256 with 600,000 iterations, a random 16-byte salt and a
versioned algorithm identifier. Plaintext passwords are never persisted.
Sessions use independent random 32-byte tokens; D1 stores only their SHA-256
hashes, user IDs and seven-day expiration timestamps. The browser receives
`finance_session` with HttpOnly, SameSite=Lax, Path=/, Max-Age and Secure on HTTPS.
Tokens and passwords are not stored in browser local/session storage or URLs.
Only pending household invitation tokens are retained in session storage.

Each login creates a new session. Logout deletes the current session server-side;
other sessions remain valid until their own logout/expiry. No session signing
secret or external identity-provider fetch is needed. Expired rows are cleaned
up in bounded batches during subsequent authentication attempts.

Registration and login share persistent throttles: ten attempts per fifteen
minutes for an email and 100 for a network address. Successful authentication
resets the email counter; the network counter includes successful requests.
Network throttling prevents varying email addresses from bypassing the limit.
The Worker uses Cloudflare's edge client-IP header, overwriting the internal
header received by Nest. Over-limit requests return 429 `RATE_LIMITED`; wait
until the window expires. This protects credential attempts, not all possible
public-endpoint abuse.

## Household identity and migration

A native account receives a stable `user:<UUID>` identity subject. Household
membership and owner/member roles are checked live in D1 for each operation,
including atomic checks before writes. New users create an empty household or
accept an invitation; signing up alone grants no access to anyone else's data.
Both members share household data; account ownership does not make it private.

Old Access identity subjects remain in the database. Registering the same email
does **not** silently claim an old identity or its household. If real old Access
households exist, migrate ownership only after verifying both identities and
reviewing a targeted data migration. No such automatic or remote migration is
part of this change.

Immediate registration reveals whether an email is already registered through
its success/failure status, despite generic error text. Throttling limits this
lookup; uniform email-based signup would require a future mail workflow.

Email ownership verification and self-service password recovery are not yet
implemented; this version does not claim to send mail. An invitation still
requires possession of its secret link and the matching account email. Do not
use an unverified email alone to recover accounts or grant historical access.

## Validation

```sh
npm run verify:access
npm run verify:auth
npm run verify:navigation
npm run verify:categories
npm run verify:schema
```

The access verifier runs the actual compiled production Worker and applies all
migrations to its disposable local D1. It uses real registration/password checks
and opaque sessions, then checks household sharing, invitation races, revocation
and rollback. Its `--serve` mode adds private fixture-only shortcut routes for
other browser regressions; those routes are never shipped in the application.
The auth browser verifier uses the actual forms on desktop/mobile, including
registration confirmation, persistence, wrong-password errors and logout.

See the [UI surface brief](ui/authentication.md) and
[acceptance record](verification/native-auth.md) for implementation evidence.
