// tests/resilience-partial-publish.test.ts
//
// Failures that land in the middle of a publish: Redis stops answering
// after the payload has already validated, the message-queue accepts
// the connection and then rejects the POST, one leg of a
// `transport: 'both'` fan-out succeeds while the other does not.
//
// The question every test here asks is the same: what does the CALLER
// see, and do the counters an operator reads agree with what actually
// happened on the wire?

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Redis stand-in -------------------------------------------------------
// A single shared client so a test can make Redis start failing partway
// through a run without rebuilding the catalog.

const redisClient = {
  connect: vi.fn(async () => {}),
  quit: vi.fn(async () => {}),
  on: vi.fn(),
  publish: vi.fn(async () => 1),
  subscribe: vi.fn(async () => {}),
  unsubscribe: vi.fn(async () => {}),
  sMembers: vi.fn(async () => [] as string[]),
  xAdd: vi.fn(async () => '1-0'),
  xRange: vi.fn(async () => []),
  ping: vi.fn(async () => 'PONG'),
};
vi.mock('redis', () => ({ createClient: vi.fn(() => redisClient) }));

import { EventCatalog } from '../src/client/index.js';
import type { EventDeclaration } from '../src/types/index.js';

const ORDER_SCHEMA = {
  type: 'object' as const,
  properties: { orderId: { type: 'string' } },
  required: ['orderId'],
};

function declaration(transport: EventDeclaration['transport']): EventDeclaration {
  return {
    name: 'orders:created',
    schema: ORDER_SCHEMA,
    transport,
    producer: 'orders-api',
  };
}

interface MqState {
  postStatus: number;
  posts: number;
}

function stubMessageQueue(state: MqState, registryStatus = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const s = String(url);
    if (s.includes('/api/events/bulk') || s.includes('/api/heartbeat') || s.includes('/api/manifests')) {
      return new Response(JSON.stringify({ ok: true }), { status: registryStatus });
    }
    if (s.endsWith('/health')) return new Response('ok', { status: 200 });
    if (init?.method === 'PUT') return new Response('{}', { status: 201 });
    if (s.includes('/messages') && init?.method === 'POST') {
      state.posts++;
      return new Response('{}', { status: state.postStatus });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function connectedCatalog(
  transport: EventDeclaration['transport'],
  extra: Record<string, unknown> = {},
): Promise<EventCatalog> {
  const catalog = new EventCatalog({
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://mq:3004' },
    serviceName: 'orders-api',
    ...extra,
  });
  catalog.declare(declaration(transport));
  await catalog.connect();
  return catalog;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  redisClient.publish.mockImplementation(async () => 1);
  redisClient.xAdd.mockImplementation(async () => '1-0');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// transport: 'both' — one leg lands, the other does not
// ---------------------------------------------------------------------------

describe("transport: 'both' — partial delivery", () => {
  it('durable leg 500s: the caller is told which leg failed, and the signal leg is not credited as a publish', async () => {
    const state: MqState = { postStatus: 500, posts: 0 };
    stubMessageQueue(state);
    const catalog = await connectedCatalog('both');

    await expect(catalog.publish('orders:created', { orderId: 'o-1' }))
      .rejects.toThrow(/durable-transport.*orders-created.*500/s);

    // The signal leg really did go out — it is on the wire, subscribers
    // have it, and the transport's own channel counter says so.
    expect(redisClient.publish).toHaveBeenCalledTimes(1);
    const channel = catalog.getSignalTransport().getMetrics('orders:created') as
      { publishCount: number } | undefined;
    expect(channel?.publishCount).toBe(1);

    // …but the event's registry stats record a failure and no publish,
    // because the fan-out as a whole did not complete. The two numbers
    // disagreeing is the honest report of a partial delivery: the split
    // is visible rather than averaged away.
    const entry = catalog.getRegistry().get('orders:created');
    expect(entry?.metadata.publishCount ?? 0).toBe(0);
    expect(entry?.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('signal leg fails: the durable message is ALREADY enqueued when the caller is told it failed', async () => {
    const state: MqState = { postStatus: 200, posts: 0 };
    stubMessageQueue(state);
    const catalog = await connectedCatalog('both');
    redisClient.publish.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(catalog.publish('orders:created', { orderId: 'o-2' }))
      .rejects.toThrow(/Connection is closed/);

    // Both legs are attempted before either failure propagates, so the
    // durable POST succeeded and the consumer WILL process it.
    expect(state.posts).toBe(1);
    expect(catalog.getDurableTransport().getMetrics('orders-created'))
      .toMatchObject({ sent: 1, failed: 0 });

    // A producer that retries on this rejection therefore double-delivers
    // on the durable leg. Nothing in the rejection tells it which leg
    // survived — see the report note on EventCatalog.publish.
    const entry = catalog.getRegistry().get('orders:created');
    expect(entry?.metadata.publishCount ?? 0).toBe(0);
    expect(entry?.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('recovery: the next publish after the outage counts once, and the failed one is not backfilled', async () => {
    const state: MqState = { postStatus: 500, posts: 0 };
    stubMessageQueue(state);
    const catalog = await connectedCatalog('both');

    await expect(catalog.publish('orders:created', { orderId: 'o-3' })).rejects.toThrow();

    state.postStatus = 200;
    await expect(catalog.publish('orders:created', { orderId: 'o-4' })).resolves.toBeUndefined();

    const entry = catalog.getRegistry().get('orders:created');
    expect(entry?.metadata.publishCount).toBe(1);
    expect(entry?.metadata.errorCount).toBe(1);
    expect(entry?.metadata.lastPublishedAt).toBeTruthy();

    await catalog.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Mid-flight: Redis stops answering after validation has already passed
// ---------------------------------------------------------------------------

describe('publish — Redis drops between validation and transport', () => {
  it('a rejected PUBLISH surfaces to the caller rather than being swallowed', async () => {
    stubMessageQueue({ postStatus: 200, posts: 0 });
    const catalog = await connectedCatalog('signal');
    redisClient.publish.mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(catalog.publish('orders:created', { orderId: 'o-5' }))
      .rejects.toThrow(/Connection is closed/);

    const entry = catalog.getRegistry().get('orders:created');
    expect(entry?.metadata.publishCount ?? 0).toBe(0);
    expect(entry?.metadata.errorCount).toBe(1);
    // The channel counter must not move either — a publish that threw is
    // not a publish.
    expect(catalog.getSignalTransport().getMetrics('orders:created')).toBeUndefined();

    await catalog.disconnect();
  });

  it('a ring-buffer write failure alone is not a failed publish', async () => {
    stubMessageQueue({ postStatus: 200, posts: 0 });
    const catalog = await connectedCatalog('signal');
    // Redis is serving PUBLISH but the history stream write fails —
    // partial Redis degradation, e.g. an OOM on the stream key.
    redisClient.xAdd.mockRejectedValueOnce(new Error('OOM command not allowed'));

    await expect(catalog.publish('orders:created', { orderId: 'o-6' })).resolves.toBeUndefined();

    const entry = catalog.getRegistry().get('orders:created');
    expect(entry?.metadata.publishCount).toBe(1);
    expect(entry?.metadata.errorCount ?? 0).toBe(0);
    // The delivery happened, so the operator is warned rather than paged.
    expect(warnSpy.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/ring buffer/i);

    await catalog.disconnect();
  });

  it('a beforePublish hook that throws stops the publish before either transport is touched', async () => {
    const state: MqState = { postStatus: 200, posts: 0 };
    stubMessageQueue(state);
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      hooks: [{ beforePublish: async () => { throw new Error('tracing sink is down'); } }],
    });
    catalog.declare(declaration('both'));
    await catalog.connect();

    await expect(catalog.publish('orders:created', { orderId: 'o-7' }))
      .rejects.toThrow('tracing sink is down');

    expect(redisClient.publish).not.toHaveBeenCalled();
    expect(state.posts).toBe(0);
    expect(catalog.getRegistry().get('orders:created')?.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('an afterPublish hook that throws does not undo a publish that already succeeded', async () => {
    stubMessageQueue({ postStatus: 200, posts: 0 });
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      hooks: [{ afterPublish: async () => { throw new Error('audit sink is down'); } }],
    });
    catalog.declare(declaration('signal'));
    await catalog.connect();

    await expect(catalog.publish('orders:created', { orderId: 'o-8' })).resolves.toBeUndefined();

    expect(catalog.getRegistry().get('orders:created')?.metadata.publishCount).toBe(1);
    expect(catalog.getRegistry().get('orders:created')?.metadata.errorCount ?? 0).toBe(0);

    await catalog.disconnect();
  });
});

// ---------------------------------------------------------------------------
// The registry server is degraded, not down
// ---------------------------------------------------------------------------

describe('registry sync against a registry that answers 500', () => {
  it('retries and logs when POST /api/events/bulk answers 500', async () => {
    const state: MqState = { postStatus: 200, posts: 0 };
    const fetchMock = stubMessageQueue(state, 500);

    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      registryUrl: 'http://event-catalog:3010',
    });
    catalog.declare(declaration('signal'));
    await catalog.connect();

    const bulkPosts = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/events/bulk'));

    // Regression: syncToRemoteRegistry() awaited the fetch and never inspected
    // `res.ok`, so the RetryManager saw a resolved promise — one attempt, no
    // retry, no background re-sync and not one line of log, while the server
    // held none of this service's declarations. `pinManifest` on the same
    // class checks `res.ok`; this path did not.
    expect(bulkPosts.length).toBeGreaterThan(1);
    const logged = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/registry sync failed/);

    await catalog.disconnect();
  });

  it('warns when POST /api/heartbeat is rejected, since silence ends in a sweep', async () => {
    const fetchMock = stubMessageQueue({ postStatus: 200, posts: 0 }, 500);
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      registryUrl: 'http://event-catalog:3010',
    });
    catalog.declare(declaration('signal'));
    await catalog.connect();
    catalog.getRegistry().addSubscriber('orders:created', 'orders-api');

    const stop = catalog.startHeartbeating(60_000);
    // The first tick fires immediately; let it settle.
    await new Promise(resolve => setImmediate(resolve));
    stop();

    const beats = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/heartbeat'));
    expect(beats.length).toBeGreaterThan(0);
    // Regression: startHeartbeating() never checked `res.ok`, so a registry
    // rejecting heartbeats expired this consumer's subscription after
    // SUBSCRIBER_TTL_SECONDS while the consumer logged nothing at all. The
    // heartbeat is still best-effort — it must not throw — but it has to say
    // something, and say what the consequence is.
    const logged = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/heartbeat rejected: HTTP 500/);
    expect(logged).toMatch(/swept from the registry/);

    await catalog.disconnect();
  });

  it('pinManifest DOES surface a degraded registry — the contrast that shows the omission is accidental', async () => {
    stubMessageQueue({ postStatus: 200, posts: 0 }, 503);
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      registryUrl: 'http://event-catalog:3010',
    });
    catalog.declare(declaration('signal'));
    await catalog.connect();

    await expect(catalog.pinManifest()).rejects.toThrow(/HTTP 503/);

    await catalog.disconnect();
  });

  it('schema-freshness reports "unknown", not "fresh", when the registry is degraded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const s = String(url);
      if (s.endsWith('/health')) return new Response('ok', { status: 200 });
      if (s.includes('/api/events/')) return new Response('upstream error', { status: 502 });
      return new Response('{}', { status: 200 });
    }));

    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://mq:3004' },
      serviceName: 'orders-api',
      registryUrl: 'http://event-catalog:3010',
    });
    catalog.declare(declaration('signal'));
    await catalog.connect();

    const report = await catalog.checkAllSchemaFreshness();

    // A 502 must not read as agreement. "unknown" is what lets a boot
    // check say "I could not verify" instead of "we are in sync".
    expect(report).toEqual([
      expect.objectContaining({
        eventName: 'orders:created',
        status: 'unknown',
        remoteFingerprint: null,
      }),
    ]);

    await catalog.disconnect();
  });
});
