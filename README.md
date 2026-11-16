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

These are starter applications. Database access and authentication can be added
as features are implemented.
