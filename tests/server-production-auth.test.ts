import { afterEach, expect, it, vi } from 'vitest';
import { startServer } from '../src/server/index';

afterEach(() => vi.unstubAllEnvs());

it('rejects unconfigured production authentication before opening dependencies or a listener', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
  await expect(startServer({ redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' }))
    .rejects.toThrow('required in production');
});
