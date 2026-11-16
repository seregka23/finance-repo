# Finance

NestJS API and Angular application, managed as independent npm projects.

## Requirements

- Node.js 24.15 or newer within the Node.js 24 LTS release line
- npm (included with Node.js)

## Backend

```sh
cd backend
npm ci
npm run start:dev
```

The API runs at http://localhost:3000. The starter `GET /` endpoint returns
`Hello World!`.
`GET /api/hello` returns the JSON greeting `{ "message": "Hello World!" }`.

```sh
npm run build
npm test
npm run test:e2e
npm run lint
```

## Frontend

In a separate terminal:

```sh
cd frontend
npm ci
npm start
```

The application runs at http://localhost:4200. Routing is enabled; the initial
page requests `/api/hello` and displays the NestJS greeting. Loading, error,
and retry states are included.

Keep the backend running on port 3000. The Angular development server proxies
`/api/**` to `http://127.0.0.1:3000` using `frontend/proxy.conf.json`.
For production, configure the hosting server to forward `/api/**` to NestJS;
the Angular development proxy is not included in the production build.

```sh
npm run build
npm test -- --watch=false
```

Each application has its own `package.json` and `package-lock.json`. Run npm
commands from the relevant application directory. Build output, dependencies,
and local caches are excluded from Git.

These are starter applications. Financial data persistence and authentication
can be added as features are implemented.

## Cloudflare setup

Cloudflare Workers serves the NestJS API and the built Angular files on one
origin. D1 is bound as `DB`. This setup uses the pinned Cloudflare `cf` CLI and
Vite plugin release candidates, with `backend/cloudflare.config.ts` as the
configuration. There is no Wrangler configuration to maintain alongside it.

Install both applications' dependencies (`npm ci` in each directory). Then, from
`backend/`, run:

```sh
npm run db:migrate:local
npm run db:smoke:local
npm run cloudflare:dev
```

Open http://localhost:8787. Angular requests `/api/hello` from the same Worker;
`/api/health` checks the D1 binding and returns
`{ "status": "ok", "database": "ok" }`. Unknown `/api/*` paths remain API
errors rather than returning the Angular page. Other client routes fall back to
Angular's `index.html`.

The Cloudflare commands build Angular and compile NestJS before bundling. This
preserves Nest's decorator metadata. Restart `cloudflare:dev` after changing
source files to rebuild them. The original separate Node/Angular development
commands above remain available.

```sh
npm run cloudflare:typecheck
npm run cloudflare:check
```

`cloudflare:check` builds and validates a deployment with `--dry-run`; it does
not upload or provision anything. Generated binding types, build output and local
D1 data live under the ignored `backend/.cloudflare/` directory. The local D1
helper always passes `--local` and cannot be redirected to a remote database.
The migration creates an infrastructure probe table only; financial schemas
are separate work. Never commit `.env`, `.dev.vars`, tokens or local D1 files.

### Future test and production deployments

No Cloudflare resources or deployments are created by this setup PR. When a
deployment is explicitly requested:

1. Authenticate the CLI with `npx cf auth login`, or supply a scoped
   `CLOUDFLARE_API_TOKEN` through your shell/CI secrets. The connected Cloudflare
   app and the CLI have separate authentication.
2. Create separate test and production D1 databases. Export
   `CLOUDFLARE_ACCOUNT_ID` and the appropriate `D1_DATABASE_ID_TEST` or
   `D1_DATABASE_ID_PRODUCTION` in the shell/CI environment. See
   `backend/.env.example` for variable names; the config reads `process.env`.
3. Explicitly apply the versioned migrations to the intended remote database,
   after reviewing its data and recovery plan. The local helper never does this.
4. Run `npm run deploy:test` or `npm run deploy:production` from `backend/`.
   Missing remote IDs fail configuration instead of provisioning a database.
   Worker names are `family-finance-test` and `family-finance-production`.

The local simulator uses a clearly marked synthetic UUID, never a production
database. Test/production builds require their own IDs. Authentication and the
full household data model are not implemented by this infrastructure setup.
