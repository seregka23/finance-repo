import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

// Angular builds the client separately. Copy its finished files unchanged.
// Nest compiles the Worker first so decorator metadata survives bundling.
export default defineConfig({
  publicDir: '../frontend/dist/frontend/browser',
  plugins: [
    cloudflare({
      persistState: { path: '.cloudflare/state' },
      remoteBindings: false,
    }),
  ],
  build: { outDir: '.cloudflare/build' },
});
