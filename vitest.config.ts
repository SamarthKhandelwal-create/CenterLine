import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // The real package throws outside a React Server Components bundler. The
      // boundary it protects is still enforced by `next build`.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
      '@': resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
