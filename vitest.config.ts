import { defineConfig } from 'vitest/config';

// Bound worker concurrency. Vitest's default fork pool can OOM the dev box
// on suites that load heavy compilers. Override with VITEST_MAX_WORKERS=N
// for CI machines with dedicated RAM.
const maxWorkers = process.env.VITEST_MAX_WORKERS ?? '25%';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Gives every file one loopback listener and one keep-alive connection
    // pool instead of the one-server-and-one-socket-per-request that
    // supertest defaults to. See the header of that file for the flake it
    // fixes; it is a setup file rather than a per-suite import so the ~30
    // supertest-using files need no changes.
    setupFiles: ['./tests/helpers/shared-http-server.ts'],
    // Suites boot servers without auth; the explicit dev flag (NODE_ENV is
    // 'test', not production) is what permits that.
    env: { INSECURE_DEV_MODE: 'true' },
    maxWorkers,
    minWorkers: 1,
  },
});
