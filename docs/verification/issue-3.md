# Issue #3: NestJS Worker and D1 verification

Source: [GitHub issue #3](https://github.com/seregka23/finance-repo/issues/3).
Verified locally on November 16, 2026 with Node.js 24.22.1, npm 11.9.0 and
Wrangler 4.163.0. This record covers infrastructure readiness, not the household
financial schema in issue #4.

## Existing foundation

The existing code already compiled NestJS for Cloudflare's Node HTTP bridge,
served Angular static assets, exposed the greeting and read-only D1 health
routes, and shipped `0001_infrastructure_probe.sql`. Those paths and the
migration are preserved. The new work adds an explicit local-only API write/read
proof, repeatable verification, environment separation and this handoff.

## Acceptance evidence

| Check | Expected | Observed |
| --- | --- | --- |
| Build | NestJS and Angular compile with generated Worker types | `npm run build` passed |
| Worker packaging | Wrangler packages the API, assets and D1 binding | Default-target `wrangler deploy --dry-run` passed; it does not deploy |
| Backend contracts | Default-disabled probe, valid CRUD, validation, host restriction and sanitized failures | Backend unit suite: 1 passed; HTTP e2e suites: 11 passed; lint and TypeScript checks passed |
| Clean local D1 | Versioned migration applies to a disposable store | Native Wrangler migration applied `0001_infrastructure_probe.sql` |
| API write/read | A bound quoted Unicode value survives actual NestJS → `env.DB` writes and reads | POST returned a generated UUID and value; GET returned the same record |
| Persistence | Record survives a Worker restart | Read after restart matched the original record |
| Migration replay | Existing record and migration history remain unchanged | Reapplying migrations preserved the row and the exact `id`, `name`, `applied_at` history |
| Cleanup | Remove only the synthetic probe and owned temporary state | DELETE returned 204, subsequent GET returned 404, and SQL verified an empty probe table |
| Adjacent routes | Health, greeting, SPA fallback and API 404 still work | Real Wrangler runtime checks passed |
| Existing data | No pre-existing local store, remote database or historical migration is changed | Verification uses a newly created temporary persistence directory; original migration file is unchanged |

The integration command executed successfully after the build:

```sh
node scripts/verify-local-d1.mjs
# Local D1 migration, replay, Worker API, and cleanup verified.
```

The documented convenience command runs the same build and verification steps:

```sh
npm run verify:local
```

`node --check scripts/verify-local-d1.mjs` and `git diff --check` also passed.
The managed execution workspace required
`XDG_CONFIG_HOME=/tmp/finance-cloudflare-config` for local CLI logs/config;
normal development does not require that workspace-specific override.

## Local API contract

The probe controller is registered only when
`INFRASTRUCTURE_PROBE_ENABLED === 'true'`. Only the named `local` environment sets
that value, and the controller additionally rejects non-loopback hostnames.
The flag and host check are development controls, not household authentication.
No financial or arbitrary-SQL endpoint is introduced.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/infrastructure/probe` | Body exactly `{ "value": "1–256 characters" }`; 201 `{ "id": "UUID", "value": "..." }` |
| GET | `/api/infrastructure/probe/:id` | 200 record, or 404 when missing |
| DELETE | `/api/infrastructure/probe/:id` | Idempotent 204 cleanup |

Invalid bodies or UUIDs return 400. Disabled routes and non-loopback hosts return
404. Database failures return sanitized 503 responses. Insert, select and delete
use prepared statements with bound values against `infrastructure_probe` only.

## Environment and migration decisions

- **Local:** synthetic simulator identifier, `remote: false`, explicit
  `--env local --local`; probe enabled. Verification overrides persistence with
  its own temporary directory and cleans up child processes on success/failure.
- **Test:** the known `family-finance-test` database. The existing `finance-repo`
  default deployment and explicit `finance-repo-test` target refer to this same
  test tier; neither is designated production. Probe disabled.
- **Production:** a separate proposed target is recorded with an unmistakable
  configuration placeholder instead of an invented database UUID. A real
  production database, routing and migration/recovery plan must be agreed before
  replacing it or running production commands. Probe disabled.
- Bindings and variables are explicit in each named environment; Wrangler does
  not inherit those fields. Commands and target selection are documented in the
  root README. No remote deployment or migration was run for this issue.

## Remaining production decisions

- Angular hosting is already selected: Workers Static Assets with same-origin
  NestJS API routing and SPA fallback.
- Production D1 identity/location, final domain/routing and access policy remain
  open. The proposed production configuration is not a production readiness claim.
- Household sign-in, membership and authorization remain issue #5 work.
- Production recovery verification and cutover are later release tasks. Existing
  source-system data and migration history have not been altered here.

Independent backend/database specialists implemented their bounded parts. An
independent reviewer found no significant actionable issue in the gated API,
environment isolation or local verification runner.
