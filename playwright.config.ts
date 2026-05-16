import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3099',
    headless: true,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npx tsx tests/e2e/test-server.ts',
    port: 3099,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
