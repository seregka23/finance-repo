# Registration failure in deployed Cloudflare Workers

## Observed failure and cause

On 2026-11-17 the deployed registration form returned 503
`DATABASE_UNAVAILABLE`. Read-only Cloudflare API checks confirmed that
`finance-repo` was bound to the intended `family-finance-test` D1 database, all
five migrations were applied, and `auth_users`, `auth_sessions` and
`auth_throttles` existed. The database held zero users/sessions and two throttle
rows, consistent with registration failing after its initial database writes.
No real credentials, hashes or session tokens were read.

With the user's explicit approval, a temporary Worker named
`finance-auth-probe-mwkp410p` tested synthetic credentials under the same
compatibility date (`2026-11-16`) and `nodejs_compat`. It had **no D1 binding**.
Cloudflare's browser-rendering content API invoked its public diagnostic routes
because the execution workspace's outbound proxy could not reach workers.dev.

Observed deployed responses:

| Primitive | Actual result |
| --- | --- |
| Web Crypto PBKDF2-SHA256, 600,000 iterations | `NotSupportedError`: `Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).` |
| Node PBKDF2-SHA256, 600,000 iterations | The same limit error |
| Native Node scrypt, N=16,384, r=8, p=5, maxmem=33,554,432, 32-byte digest | Success; exact output matched Node |

The synthetic scrypt vector used password `synthetic-runtime-probe` and 16 salt
bytes of value 7. Both deployed Workers and Node produced:

```text
65a782e7470205259892530b36ca2821766311cb1a8b82f565756297cdf12f8a
```

The diagnostic Worker was deleted after the checks. A follow-up lookup confirmed
it no longer existed. The application Worker was not redeployed and the real D1
data was not modified by this investigation.

The production-only limit explains why the original local Workerd proof passed.
Cloudflare's source discussion records the same local/deployed difference:
[workerd issue #1346](https://github.com/cloudflare/workerd/issues/1346).
The service also caught crypto failures in the same broad error boundary as D1
failures, which caused the misleading database message.

## Change

New registrations now use native scrypt with the proven parameters, random
16-byte salts, 32-byte hashes and algorithm ID `scrypt-16384-8-5-v1`. The selected
16 MiB setting is one of the
[OWASP scrypt configurations](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
This replaces the unsupported primitive rather than reducing PBKDF2's work
factor or inventing a custom hash construction.

Login selects the hash algorithm recorded on the user row. Legacy
`pbkdf2-sha256-600000-v1` rows are verified as PBKDF2 where the runtime supports
it; their digest is never interpreted as scrypt. On restricted Cloudflare,
legacy verification remains unavailable and returns 503 `AUTH_UNAVAILABLE`.
If another environment has legacy users, it needs a separately authorized
credential-reset/migration flow. The live database checked here had no users;
that is not a claim about other environments.

Hashing failures now return `AUTH_UNAVAILABLE`. D1 failures still return
`DATABASE_UNAVAILABLE`. Hash diagnostics log only a fixed stage and the error
class, never the raw error, password, salt, hash, token or query parameters.
Session format, membership checks, origin validation and throttles are unchanged.
No new migration or package dependency is needed.

## Validation

- Backend: nine test files / 30 tests passed, including new scrypt registration
  cross-checks, the deployed known vector, legacy PBKDF2 compatibility, simulated
  runtime-cap errors with sanitized logging and unknown-algorithm rejection.
- Backend lint and regenerated-type build passed.
- `node scripts/verify-access.mjs`: ten groups passed against the compiled
  application Worker and disposable local D1. The fixture now explicitly
  rejects PBKDF2 calls above 100,000 iterations, modeling the missing production
  constraint; registration, login, logout, expiry, sharing, invitations,
  isolation and revocation pass under that constraint.
- Wrangler packaging dry run passed; this did not publish the application.
- Script syntax and `git diff --check` passed.

An independent backend/security review found no actionable findings in the final
change and confirmed the disclosed legacy limitation. The reviewer ran
`git diff --check` but did not claim to rerun tests. Applicable
skills were `.agents/skills/nestjs-best-practices/SKILL.md` and its async-error,
HTTP-exception, validation and rate-limiting rules, plus Cloudflare Workers
runtime/configuration guidance. The applied decisions preserve existing guards,
bounded inputs and throttles, distinguish internal failure types and use actual
deployed-runtime evidence rather than treating local success as platform parity.

## Rollout

Merge and deploy the fix through the configured Cloudflare build. Existing D1
migrations are already compatible; there is no new migration to apply. A complete
registration against the live application's D1 was intentionally not performed,
so this record proves the selected crypto operation in Cloudflare and the full
flow locally, not a newly created live account.
