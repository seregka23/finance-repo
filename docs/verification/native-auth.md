# Native registration and session acceptance record

Verified on 2026-11-17 against the existing Cloudflare compatibility date and
flags, Node 24.22.1, Wrangler 4.163.0, native Workerd, disposable local D1 and
Chromium. No remote migration, Access policy change or deployment was performed.

## Result

Visitors can reach a public welcome, create a native email/password account,
sign in and sign out without configuring Cloudflare Access. The existing
household and category features retain their live authorization checks. The
site's design reference, routes and financial primitives are preserved.

## Actual validation

| Check | Result |
| --- | --- |
| Backend unit suite | Nine files / 27 tests passed |
| Angular unit suite | Three files / 14 tests passed |
| Final native hash comparison auth tests | Four tests passed |
| Backend lint | Passed |
| Full build and `npm run deploy:check` | Passed; packaging only, no publication |
| `node scripts/verify-access.mjs` | Ten native Worker/D1 groups passed, also used by browser fixture startup |
| `node scripts/verify-auth.mjs` | Four desktop/mobile browser groups passed |
| `node scripts/verify-navigation.mjs` | Eight browser groups passed |
| `node scripts/verify-categories.mjs` | Eight API/browser groups passed |
| `node scripts/verify-schema.mjs` | 13 groups and 21 scoped relationship rejection cases passed |
| Script syntax / `git diff --check` | Passed |

The access fixture imports the actual compiled production Worker, including its
trusted-header overwrite boundary and native authentication service. It applies
all five real migrations to its isolated local database. Only the fixture
entrypoint has SQL inspection, atomic-write assertions and browser shortcut
routes; these are absent from the shipped Worker.

The checks observed:

- PBKDF2-SHA256 with 600,000 iterations works in Workerd. Passwords are stored as
  salted versioned hashes, sessions as hashes of independent opaque tokens.
  Password hash comparison uses native `node:crypto` `timingSafeEqual`.
- Registration returns a session, email case is normalized, duplicate and invalid
  credentials fail, wrong-password login fails, and a later valid login works.
- Cookies carry HttpOnly and SameSite=Lax locally; HTTPS Secure selection is
  explicit in the controller. Seven-day lifetime is persisted. Tests expired a
  stored session and verified rejection, and logout revoked a captured token.
- Cross-origin writes to register/login/logout and household APIs are rejected.
  A supplied internal origin header cannot override the original Worker origin.
  Old Access assertions/cookies cannot authenticate as native users.
- Ten failed email attempts exhaust the email window; native tests also seed the
  network counter at its configured limit and verify a different email is still
  rejected. Unit tests reserve 100 attempts across varying emails, reject the
  101st, check the email limit across networks and its successful-login reset.
- Native sessions still enforce household creation, two-member capacity,
  invitation ownership/single-use/expiry, sharing, revocation, isolation and
  failed-batch rollback. Categories remain shared and scoped, and saved history
  survives renaming/archival.
- Desktop (1440px) and mobile (390px) forms pass six axe WCAG A/AA scans without
  reported violations or horizontal overflow. The browser completed password
  confirmation mismatch, registration, refresh/session persistence, logout,
  unauthenticated rejection, wrong-password feedback and successful re-login.
  It found no browser page errors or auth data in local storage.
- The full migration upgrade/replay preserves existing financial fixtures and
  the legacy infrastructure probe. Migration 0005 is additive and performs no
  email-based reassignment of existing identities.

Independent visual review also identified low-contrast input boundaries that
automated axe scans did not flag. Auth fields now use the existing muted-color
border (6.48:1 against white), preserving the indigo focus outline.

During integration, a registration password hint was separated from the field's
accessible name using `aria-describedby`. The final stable-build browser run
passed after this fix. An earlier categories browser run encountered assets
being replaced by a concurrent frontend build; it passed against the final,
unchanging build. A crypto-heavy unit test hit the default five-second timeout
under concurrent runtime builds; its scoped timeout is now 15 seconds, and the
complete suite plus final auth tests passed without lowering hash cost.

## Captures

- [Desktop welcome](native-auth/desktop-welcome.png)
- [Desktop sign-in](native-auth/desktop-login.png)
- [Mobile registration](native-auth/mobile-register.png)

These show synthetic local test states, not seeded application data. Full local
artifacts include all six welcome/login/register captures and browser results
under `.cloudflare/auth-verification`.

## Review and remaining boundaries

Backend/frontend specialists contributed, followed by independent security
review. The shared-network throttle concern was resolved by separating network
and email limits and clearing the email counter on successful authentication.
The reviewer found no remaining concrete blocker by source inspection. An
independent Impeccable finish review inspected all six UI captures and requested
the input-border contrast correction. Its confirmation disposition was **ship**:
the listed finding was resolved in all four recaptured form states, with the
existing focus outline preserved. That confirmation covered the fix, not a new
backend review. Immediate
registration's account-existence disclosure is an accepted, documented tradeoff.

Email ownership verification and self-service password recovery are not
implemented. Invitation redemption still requires the secret link and matching
account email; unverified email alone never claims a legacy household. Existing
Access memberships need a separately reviewed ownership migration if used.

Apply `0005_native_auth.sql` to the intended remote D1 before deploying the new
code. Remove any old dashboard Access protection to make registration public.
The separate production database placeholder is unchanged. See
[authentication and rollout](../authentication.md) for commands and details.
