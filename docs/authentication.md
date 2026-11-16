# Sign-in and household access

## Authentication decision

Cloudflare Access authenticates household users. Its configured identity provider
and session cookie manage sign-in and sign-out; the application stores no
passwords, refresh tokens or provider client secrets. Access must protect the
**entire application hostname**, including Angular routes and `/api/*`.
The Sign in link returns to the configured application origin, where Access
performs its login redirect. Sign out uses `/cdn-cgi/access/logout`.

The API independently verifies Access application JWTs from
`Cf-Access-Jwt-Assertion` or the signed `CF_Authorization` cookie. It accepts only
RS256 signatures from the configured team's certificate endpoint, the exact
issuer and audience, unexpired valid time claims, and a human subject/email.
Unsigned identity headers and browser-supplied roles are never trusted.
Identity subjects encode the verified issuer and subject together.

Only public signing keys are cached (five-minute TTL); refreshes have a
30-second cooldown and five-second timeout. A rotation during the cooldown may
require retrying after 30 seconds. Provider/key failures fail closed. Membership
and role are never taken from the JWT or cached: they are checked live in D1.
Removing a household member blocks their subsequent household requests even if
their Access token remains valid. Sign out clears the Access browser session;
it is distinct from revoking household membership. A copied signed token remains
sensitive until expiry or provider revocation; do not log or share it.

## Configure a deployment

No Access application, identity-provider policy, credentials, remote migration or
deployment was created by this issue. These steps require the real target:

1. Choose the application hostname and protect all of it with a Cloudflare
   Access self-hosted application (including any accessible `workers.dev` alias).
   Configure the desired identity provider/login method and a suitable session
   duration. Allow the owner and intended second member through the Access
   policy. Creating a D1 invitation does not change that separate edge policy.
2. Obtain the exact team domain and application audience tag from that Access
   application. Configure the following Worker variables in **each** target:

   | Variable | Value |
   | --- | --- |
   | `ACCESS_TEAM_DOMAIN` | `https://<actual-team>.cloudflareaccess.com`, no trailing slash |
   | `ACCESS_AUDIENCE` | The real Access application's audience tag |
   | `ACCESS_APP_ORIGIN` | Exact public HTTPS origin, no path or trailing slash |

   The variables are deployment-specific identifiers, not secrets. Commit actual
   non-secret values to the intended Wrangler environment when ready, or manage
   them in Workers Builds; ensure later Wrangler deploys do not replace them
   with the intentionally blank repository values. Do not invent identifiers.
3. Review migration `0003` and [database access constraints](database/access.md).
   Audit legacy memberships for over-capacity or duplicate active owners. Apply
   reviewed migrations to the explicit test target first using the
   [migration guide](database/migrations.md); code deployment alone does not do it.
4. Deploy to the intended test target and verify real provider sign-in from two
   browser sessions, invitations opened before and after sign-in, sign-out and revocation. No such provider/edge
   integration is claimed by the local verification record.
5. Agree the production D1 identity, hostname, policy and recovery rehearsal
   before a production rollout. The existing production placeholder remains.

On local Wrangler, `.dev.vars.local` can supply actual Access identifiers and
`ACCESS_APP_ORIGIN=http://localhost:8787`. Ordinary local Wrangler has no Access
login edge. Use a properly protected test hostname/tunnel for real provider
sign-in, or the isolated signed-fixture verifier below. There is no production
development-identity bypass and no credential to paste into the Angular app.

## API contract

All application routes are under `/api/v1`; responses use `Cache-Control:
no-store`. Writes require an `Origin` exactly matching `ACCESS_APP_ORIGIN`.
Same-origin browser requests supply this automatically; CLI clients must supply
the intended Origin and a valid signed identity. Cross-origin CORS is not enabled.

Household summaries contain `{id,name,baseCurrency,timeZone,role,memberId}`.
The base currency is RSD; the default time zone is Europe/Belgrade. New households
contain only the household and active owner, with no synthetic financial records.

| Method/path | Request and response |
| --- | --- |
| GET `/auth/config` | Public `{configured,signInUrl,signOutUrl}`; URLs are null when unconfigured |
| GET `/session` | `{user:{email},households:[summary]}` for active memberships only |
| POST `/households` | `{name,timeZone?}` → 201 summary with owner role |
| GET `/households/:id` | Active member → household summary |
| PATCH `/households/:id` | Owner `{name?,timeZone?}` → saved summary; nonempty body required |
| GET `/households/:id/members` | Active member → `{members:[{id,email,role,status}],invitations:[{id,email,status,expiresAt}]}`; active members and unexpired pending invitations only; legacy email may be null |
| POST `/households/:id/invitations` | Owner `{email}` → 201 `{id,email,expiresAt,token}`; expiry is ISO text |
| DELETE `/households/:id/invitations/:invitationId` | Owner cancels a pending invitation → 204 |
| POST `/invitations/accept` | Signed-in invited email `{token}` → 201 joined household summary |
| DELETE `/households/:id/members/:memberId` | Owner revokes another active member → 204; owner cannot revoke self |

Invitation tokens use 32 cryptographically random bytes. Only SHA-256 hashes
are stored in D1; a token is returned once, expires after 48 hours, is bound to
the verified email, and can be consumed once. Invitations are shared manually;
no email delivery integration is implied. Angular creates a fragment link
`/#invite=...`, removes the fragment immediately, and temporarily retains it in
session storage during sign-in until accepted or dismissed. Treat the link as
sensitive. Token values are not returned in member/invitation listings.
Canceled or expired tokens cannot join; a revoked member can join again only
after a new owner invitation. Active members plus unexpired pending invitations
share two slots, enforced inside D1 under concurrent creation and acceptance.

Errors have `{error:{code,message}}`:

| Status | Codes and meaning |
| --- | --- |
| 400 | `INVALID_INPUT`: invalid fields, name or time zone |
| 401 | `UNAUTHENTICATED`: missing/invalid/expired signed identity or unavailable signing key |
| 403 | `OWNER_REQUIRED` or `INVALID_ORIGIN` |
| 404 | `HOUSEHOLD_NOT_FOUND`: unknown, cross-household, revoked or scoped target unavailable |
| 409 | `HOUSEHOLD_FULL` or `INVITATION_INVALID`: conflict, used/canceled/expired token, wrong email or duplicate invitation |
| 413 | `PAYLOAD_TOO_LARGE`: request body exceeds the server limit |
| 500 | `INTERNAL_ERROR`: sanitized unexpected failure |
| 503 | `AUTH_NOT_CONFIGURED` or `DATABASE_UNAVAILABLE` |

Unknown resources remain 404. Database and token internals are not returned.

## Authorization handoff for financial features

Global guards authenticate `/api/v1` handlers and check live membership for every
household-prefixed handler, including later read/export/import routes. Household
IDs and all related resource IDs must still be scoped in repository SQL; the
guards do not supply database row-level security or account-level secrecy.

`HouseholdAccessService.batch(identity,householdId,requiredRole,statements)`
inserts a SQL authorization assertion first in the same D1 batch. A revoked
membership or insufficient role aborts before changes can persist. Use this
helper for every future financial write batch, along with its financial/version
assertions. Do not split authorization and financial mutations into separate
database calls. Current household settings, member reads and owner-management
operations already use this boundary. Household creation and invitation
acceptance have their own atomic initialization/acceptance assertions.

## Local verification

`npm run verify:access` builds the apps and starts a disposable Wrangler Worker
and D1 store with generated RSA test keys. It tests the actual production guards,
controllers and services with signed test identities. Only its temporary
entrypoint injects the fixture JWKS. The special batch-proof route exists only
inside that generated fixture, never in the production Worker.

For manual local UI inspection after a build, `node scripts/verify-access.mjs
--serve` runs the same checks and keeps the fixture alive. Its printed loopback
sign-in links set **synthetic**, HTTP-only test cookies for owner, member or a
newcomer. Those links exist only in that owned disposable fixture and do not
authenticate against a real Access application. Stop with Ctrl-C to remove its
processes and database. Never deploy this generated fixture.

## References

- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Access application authorization cookies](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)
- [Access session management and logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- [NestJS authentication options](https://docs.nestjs.com/security/authentication)
