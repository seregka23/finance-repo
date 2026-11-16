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
page is the Angular starter page.

```sh
npm run build
npm test -- --watch=false
```

Each application has its own `package.json` and `package-lock.json`. Run npm
commands from the relevant application directory. Build output, dependencies,
and local caches are excluded from Git.

These are starter applications. Database access, authentication, and communication
between the frontend and backend can be added as features are implemented.
