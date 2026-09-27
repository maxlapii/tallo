import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Workspace scripts run with `server/` as cwd, so use an absolute path.
const E2E_DATA_DIR = resolve(import.meta.dirname, 'server/data/e2e');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npm run db:reset -w server && npm run dev -w server`,
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: '3000',
        DATA_DIR: E2E_DATA_DIR,
        JWT_SECRET: 'e2e-jwt-secret-not-for-production',
        LOG_LEVEL: 'warn',
        LOGIN_RATE_LIMIT_MAX: '1000',
      },
    },
    {
      command: 'npm run dev -w client',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
