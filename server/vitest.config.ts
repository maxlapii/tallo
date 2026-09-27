import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@tallo/shared': resolve(import.meta.dirname, '../shared/src/index.ts') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: true,
    // bcrypt logins across 20+ parallel files can spike; keep a generous budget.
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret-not-for-production',
      LOG_LEVEL: 'silent',
      BCRYPT_ROUNDS: '4',
      DATA_DIR: './data/test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/db/cli.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
        'src/services/**': { lines: 90, functions: 90, branches: 80, statements: 90 },
      },
    },
  },
});
