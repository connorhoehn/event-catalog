import { queueResponse } from './helpers/queue-http';
// tests/publish-evolution.test.ts
//
// Phase E3.4 — transport: 'both' fan-out
// Phase E3.6 — discriminator validation
//
// Verifies the new EventCatalog.publish behavior added in the E3 wave.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory Redis pub/sub simulator (reused from client-integration.test.ts).
const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();

function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      const handlers = subscriptions.get(channel);
      if (handlers) {
        for (const handler of handlers) handler(message, channel);
      }
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (message: string, channel: string) => void) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => { subscriptions.delete(channel); }),
    xAdd: vi.fn(async () => '0-0'),
    xRange: vi.fn(async () => []),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index.js';

function makeConfig() {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.clear();
  // Default: healthy fetch (durable-transport queue exists + send 200)
  fetchMock.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (urlStr.includes('/ready')) return queueResponse(200, { status: 'ready' });
    if (opts?.method === 'PUT') return queueResponse(201, { status: 'created' });
    if (opts?.method === 'POST') return queueResponse(200, { message_id: 'm-1' });
    if (opts?.method === 'GET') return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    return new Response('', { status: 200 });
  });
});

describe("publish transport: 'both' (Phase E3.4)", () => {
  it('publishes to BOTH signal (Redis) and durable (message-queue) transports', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'pipeline.run.completed',
      schema: {},
      transport: 'both',
      producer: 'pipeline-worker',
    });

    // Subscribe to the signal channel so we can detect the publish.
    let signalDelivered: unknown = null;
    catalog.getSignalTransport()
      .subscribe('pipeline.run.completed', (env) => {
        signalDelivered = env.payload;
      });

    await catalog.publish('pipeline.run.completed', { runId: 'r-1', status: 'completed' });

    // Signal: in-memory pubsub fired.
    expect(signalDelivered).toEqual({ runId: 'r-1', status: 'completed' });

    // Durable: a POST to /queues/.../messages happened.
    const durableSends = fetchMock.mock.calls.filter(([url, opts]) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      return u.includes('/queues/') && u.includes('/messages') && (opts as RequestInit | undefined)?.method === 'POST';
    });
    expect(durableSends.length).toBeGreaterThanOrEqual(1);

    await catalog.disconnect();
  });

  it("transport: 'signal' alone does NOT publish durable", async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social:post',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
    });

    await catalog.publish('social:post', { id: 'p-1' });

    const durableSends = fetchMock.mock.calls.filter(([url, opts]) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      return u.includes('/queues/') && u.includes('/messages') && (opts as RequestInit | undefined)?.method === 'POST';
    });
    expect(durableSends).toHaveLength(0);
    await catalog.disconnect();
  });

  it("uses declaration.queue when set (overrides eventNameToQueueName)", async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'social.post.created',
      schema: {},
      transport: 'durable',
      producer: 'platform-api',
      queue: 'social-posts-fifo',
    });
    await catalog.publish('social.post.created', { id: 'p-1' });

    const targetUrls = fetchMock.mock.calls
      .map(([url]) => (typeof url === 'string' ? url : (url as URL).toString()))
      .filter((u) => u.includes('/messages'));
    expect(targetUrls.some((u) => u.includes('social-posts-fifo'))).toBe(true);
    await catalog.disconnect();
  });
});

describe('publish discriminator validation (Phase E3.6)', () => {
  it('rejects publish when payload discriminator value is not declared', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'ingest:progress',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
      discriminator: { field: 'type', values: ['sync.started', 'sync.completed'] },
    });
    await expect(
      catalog.publish('ingest:progress', { type: 'sync.invalid', sourceId: 's-1' }),
    ).rejects.toThrow(/discriminator validation failed/);
    await catalog.disconnect();
  });

  it('accepts publish when discriminator value is declared', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'ingest:progress',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
      discriminator: { field: 'type', values: ['sync.started', 'sync.completed'] },
    });
    await expect(
      catalog.publish('ingest:progress', { type: 'sync.started', sourceId: 's-1' }),
    ).resolves.toBeUndefined();
    await catalog.disconnect();
  });

  it('rejects publish when discriminator field is missing or not a string', async () => {
    const catalog = new EventCatalog(makeConfig());
    await catalog.connect();
    catalog.declare({
      name: 'ingest:progress',
      schema: {},
      transport: 'signal',
      producer: 'platform-api',
      discriminator: { field: 'type', values: ['sync.started'] },
    });
    await expect(catalog.publish('ingest:progress', {} as Record<string, unknown>))
      .rejects.toThrow(/discriminator validation failed/);
    await expect(catalog.publish('ingest:progress', { type: 42 } as unknown as Record<string, unknown>))
      .rejects.toThrow(/discriminator validation failed/);
    await catalog.disconnect();
  });
});
