import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prisma's Workerd client imports a compiled WASM module. Execute that same
  // compiler in Node tests rather than mocking Prisma or using another client.
  plugins: [
    {
      name: 'workerd-wasm-module',
      enforce: 'pre',
      load(id) {
        if (!id.endsWith('.wasm?module')) return;
        return `import { readFileSync } from 'node:fs'; export default new WebAssembly.Module(readFileSync(${JSON.stringify(id.slice(0, -'?module'.length))}));`;
      },
    },
  ],
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
