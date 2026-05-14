import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    // distributed-core v0.19.x published package lacks ESM barrels for some
    // subpaths (e.g. messaging-queue). Map to the CJS build directly so Vite
    // can resolve them without hitting the missing ESM barrel.
    alias: {
      'distributed-core/messaging-queue': path.resolve(
        __dirname,
        'node_modules/distributed-core/dist/messaging-queue.js',
      ),
    },
    conditions: ['require'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
