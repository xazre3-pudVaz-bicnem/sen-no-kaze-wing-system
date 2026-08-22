import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // PDF レンダラーは 'server-only' を読み込むため、テストでは空実装に差し替える
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
