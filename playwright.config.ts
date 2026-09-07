import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3099);

export default defineConfig({
  testDir: 'tests/e2e',
  // Only *.spec.ts here; tests/**/*.test.ts belongs to vitest and the two
  // runners must never pick up each other's files.
  testMatch: /.*\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // The specs share one server process (registry, DLQ, tap emitter), so they
  // run one at a time. The suite is small; determinism beats wall-clock.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npx tsx tests/e2e/test-server.ts',
    port: PORT,
    // Never reuse: a server left over from an earlier run is running stale
    // code, and the whole suite then silently tests the wrong build.
    reuseExistingServer: false,
    // First boot may build the admin bundle from source.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
