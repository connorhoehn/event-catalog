import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Deliberately a SEPARATE config from the repo root's.
//
// The root `vitest.config.ts` includes only `tests/**/*.test.ts` and loads a
// node-only supertest setup file, so nothing under `src/admin` is ever picked
// up by `npx vitest run` at the root — and nothing here needs the root to
// change. Run these with `npm test` from `src/admin`.
//
// It merges vite.config so the `@ui` alias and the react plugin resolve the
// same way tests and the real bundle do; a divergence there is how you end up
// testing a component the build never produces.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  }),
);
