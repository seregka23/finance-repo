import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ mode }) => {
  const selectedMode = mode ?? 'development';
  if (!['development', 'test', 'production'].includes(selectedMode)) {
    throw new Error('Use Cloudflare mode development, test, or production.');
  }
  const local = selectedMode === 'development';
  const environment = local ? 'local' : selectedMode;
  const databaseId = local
    ? '00000000-0000-4000-8000-000000000001' // Local simulator only, not a Cloudflare resource.
    : process.env[`D1_DATABASE_ID_${environment.toUpperCase()}`];
  if (!databaseId || (!local && !process.env.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error(
      `Set CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID_${environment.toUpperCase()} for this mode.`,
    );
  }

  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    worker: {
      name: `family-finance-${environment}`,
      entrypoint: './dist/worker.js',
      compatibilityDate: '2026-11-16',
      compatibilityFlags: [
        'nodejs_compat',
        'enable_nodejs_http_server_modules',
      ],
      env: {
        DB: bindings.d1({
          id: databaseId,
          name: `family-finance-${environment}`,
        }),
        ASSETS: bindings.assets(),
      },
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: ['/api/*'],
      },
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true },
        traces: { enabled: true },
      },
    },
  };
});
