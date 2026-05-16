import { defineConfig } from 'vitest/config';

// Bound worker concurrency. Vitest's default fork pool can OOM the dev box
// on suites that load heavy compilers. Override with VITEST_MAX_WORKERS=N
// for CI machines with dedicated RAM.
const maxWorkers = process.env.VITEST_MAX_WORKERS ?? '25%';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    maxWorkers,
    minWorkers: 1,
  },
});
