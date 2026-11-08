import { afterEach, expect, it, vi } from 'vitest';
import { startServer } from '../src/server/index';

afterEach(() => vi.unstubAllEnvs());

it('rejects unconfigured production authentication before opening dependencies or a listener', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
  await expect(startServer({ redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' }))
    .rejects.toThrow('INSECURE_DEV_MODE');
});

it('refuses to boot with no auth when nothing is set (NODE_ENV unset counts as production)', async () => {
  vi.stubEnv('NODE_ENV', undefined);
  vi.stubEnv('INSECURE_DEV_MODE', undefined);
  vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
  await expect(startServer({ redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' }))
    .rejects.toThrow('INSECURE_DEV_MODE');
});

it('still refuses under production even with the flag set', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('INSECURE_DEV_MODE', 'true');
  vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
  await expect(startServer({ redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' }))
    .rejects.toThrow('required');
});

it('starts under INSECURE_DEV_MODE=true and binds loopback by default', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('INSECURE_DEV_MODE', 'true');
  vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
  vi.stubEnv('HOST', undefined);
  vi.stubEnv('MQ_SERVICE_AUTH_SECRET', undefined);
  const server = await startServer({ port: 0, redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' });
  try {
    expect(server.address()?.hostname).toBe('127.0.0.1');
  } finally {
    await server.shutdown();
  }
}, 30_000);
