// tests/load-sustained-client.test.ts
//
// Failure modes that only appear after the process has been up a while.
//
// Everything in `src/client/` runs for the life of a consumer service, on
// the hot path, and several of its maps are keyed by values a *caller*
// picks: an event name passed to `publishSignal`, a Redis channel derived
// per-payload, a queue name derived from an event name. Each of those is a
// leak with a slow fuse, and each of the "warn once per X" log guards is
// only a bound if X is bounded — which none of them are.
//
// This file is the standing proof that the bounds hold. It uses fake
// timers and stubbed transports: no sleeps, no sockets, and it must stay
// fast enough that nobody is tempted to delete it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function mockRedisClient(): Record<string, unknown> {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    publish: vi.fn(async () => 0),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    sMembers: vi.fn(async () => ['node-a']),
    xAdd: vi.fn(async () => '1-0'),
    xRange: vi.fn(async () => []),
    ping: vi.fn(async () => 'PONG'),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => mockRedisClient()) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index.js';
import { SignalTransport } from '../src/client/signal.js';
import { DurableTransport } from '../src/client/durable.js';
import { BoundedCounter, LogThrottle } from '../src/utils/bounded.js';

function baseConfig(): Record<string, unknown> {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'load-test-service',
  };
}

/**
 * How many distinct keys we push through each bookkeeping structure. Large
 * enough to be several multiples of every cap in `src/client/` (1000), small
 * enough that the whole file stays well under a second.
 */
const DISTINCT_KEYS = 5_000;

/** The per-key cap the client applies to caller-keyed maps. */
const CAP = 1_000;

describe('sustained load — caller-keyed maps stay bounded', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('EventCatalog.publishSignal: 5000 distinct undeclared names bound the drop map and the log', async () => {
    const catalog = new EventCatalog(baseConfig() as never);
    // No connect(): every publish is dropped, which is the state a service
    // is in during a Redis outage and the one that exercises every counter.

    for (let i = 0; i < DISTINCT_KEYS; i++) {
      await catalog.publishSignal(`room:${i}`, `attacker:frame:${i}`, { i });
    }

    const perEvent = catalog.getDroppedPublishCount() as Map<string, number>;
    expect(perEvent.size).toBeLessThanOrEqual(CAP);

    const stats = catalog.getDroppedPublishStats();
    // Bounded detail, exact total: no drop is unaccounted for.
    expect(stats.total).toBe(DISTINCT_KEYS);
    expect(stats.trackedEvents).toBeLessThanOrEqual(CAP);
    expect(stats.evictedEvents).toBe(DISTINCT_KEYS - CAP);
    expect(stats.evictedTotal).toBe(DISTINCT_KEYS - CAP);

    // The transport's own per-channel map is bounded by the same rule.
    const transport = catalog.getSignalTransport();
    expect((transport.getDroppedCount() as Map<string, number>).size)
      .toBeLessThanOrEqual(CAP);
    expect(transport.getOverflowStats().droppedTotal).toBe(DISTINCT_KEYS);

    // The log is the second half of the bound: 5000 distinct names must not
    // mean 5000 log lines, whatever the per-key dedupe says.
    expect(warnSpy.mock.calls.length).toBeLessThan(100);

    await catalog.disconnect();
  });

  it('SignalTransport: 5000 per-document channels bound metrics, drops and warnings', async () => {
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });

    // Disconnected: every publish drops. This is the `channel: p =>
    // \`document:${p.documentId}\`` declaration pattern under an outage.
    for (let i = 0; i < DISTINCT_KEYS; i++) {
      await transport.publish(`document:${i}`, {
        eventName: 'doc:changed',
        payload: { i },
        metadata: { id: `e-${i}`, producer: 'load-test', timestamp: 0 },
      });
    }

    expect((transport.getDroppedCount() as Map<string, number>).size).toBeLessThanOrEqual(CAP);
    expect(transport.getOverflowStats().droppedTotal).toBe(DISTINCT_KEYS);
    expect(warnSpy.mock.calls.length).toBeLessThan(100);

    // Now the connected path: per-channel publish metrics are capped too.
    await transport.connect();
    for (let i = 0; i < DISTINCT_KEYS; i++) {
      await transport.publish(`document:${i}`, {
        eventName: 'doc:changed',
        payload: { i },
        metadata: { id: `e-${i}`, producer: 'load-test', timestamp: 0 },
      });
    }
    expect(transport.getAllMetrics().size).toBeLessThanOrEqual(CAP);
    expect(transport.getOverflowStats().evictedChannelMetrics).toBe(DISTINCT_KEYS - CAP);

    await transport.disconnect();
  });

  it('DurableTransport: 5000 distinct queue names bound metrics and the ensure cache', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 0 });
    await t.connect();

    for (let i = 0; i < DISTINCT_KEYS; i++) {
      await t.publish(`queue-${i}`, {
        eventName: 'x',
        payload: {},
        metadata: { id: `m-${i}`, producer: 'load-test', timestamp: 0 },
      });
    }

    expect(t.getAllMetrics().size).toBeLessThanOrEqual(CAP);
    expect(t.getOverflowStats().evictedQueueMetrics).toBe(DISTINCT_KEYS - CAP);
    await t.disconnect();
  });

  it('backpressure counters are process-wide, and still bounded', async () => {
    DurableTransport.resetBackpressureCounters();
    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 0 });
    await t.connect();

    fetchMock.mockImplementation(async (_u: unknown, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return new Response('{}', { status: 200 });
    });

    for (let i = 0; i < 2_000; i++) {
      await t.publish(`bp-queue-${i}`, {
        eventName: 'x',
        payload: {},
        metadata: { id: `m-${i}`, producer: 'load-test', timestamp: 0 },
      }).catch(() => { /* expected: 429 exhausts the single attempt */ });
    }

    const map = DurableTransport.getBackpressureCount() as Map<string, number>;
    expect(map.size).toBeLessThanOrEqual(CAP);
    expect(DurableTransport.getBackpressureTotal()).toBe(2_000);
    DurableTransport.resetBackpressureCounters();
    await t.disconnect();
  });
});

describe('sustained load — a failing transport does not become a log storm', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('10000 publishes over a simulated hour of outage log a bounded number of lines', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const catalog = new EventCatalog({
      ...baseConfig(),
      // A callback that throws does so on every single drop — the shape
      // that turns an outage into a second, self-inflicted outage.
      onPublishDropped: () => { throw new Error('sink is down'); },
    } as never);

    catalog.declare({
      name: 'cursor:moved',
      transport: 'signal',
      producer: 'load-test-service',
      channel: (p: unknown) => `document:${(p as { doc: number }).doc}`,
      schema: { type: 'object', properties: { doc: { type: 'number' } }, required: ['doc'] },
    } as never);

    const PUBLISHES = 10_000;
    for (let i = 0; i < PUBLISHES; i++) {
      // One simulated hour spread across the run, so the throttles roll
      // their windows exactly as they would in production.
      if (i % 100 === 0) vi.advanceTimersByTime(36_000);
      await catalog.publish('cursor:moved', { doc: i });
    }

    // The bound that matters: a per-publish failure path at full request
    // rate must not produce a line per publish. 60 windows × the ceilings
    // leaves plenty of headroom and still catches a regression to 1:1.
    const lines = warnSpy.mock.calls.length + errorSpy.mock.calls.length;
    expect(lines).toBeLessThan(PUBLISHES / 10);

    // Suppressed is not lost: every drop and every callback failure is
    // still counted.
    const stats = catalog.getDroppedPublishStats();
    expect(stats.total).toBe(PUBLISHES);
    expect(stats.hookFailures).toBe(PUBLISHES);
    expect(stats.suppressedWarnings).toBeGreaterThan(0);
    expect(catalog.getSignalTransport().getOverflowStats().droppedTotal).toBe(PUBLISHES);

    // And memory: 10000 distinct channels, both maps capped.
    expect((catalog.getDroppedPublishCount() as Map<string, number>).size).toBeLessThanOrEqual(CAP);
    expect((catalog.getSignalTransport().getDroppedCount() as Map<string, number>).size)
      .toBeLessThanOrEqual(CAP);

    await catalog.disconnect();
  });

  it('a permanently failing ring-buffer write logs at most a line a minute, not one a publish', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });
    await transport.connect();

    // Reach into the connected client and make XADD fail forever — Redis
    // OOM, a wrong-type key, a read-only replica.
    const client = (transport as unknown as { publishClient: { xAdd: ReturnType<typeof vi.fn> } })
      .publishClient;
    client.xAdd.mockImplementation(async () => { throw new Error('OOM'); });

    for (let i = 0; i < 5_000; i++) {
      if (i % 100 === 0) vi.advanceTimersByTime(36_000);
      await transport.publish('hot:channel', {
        eventName: 'x',
        payload: {},
        metadata: { id: `e-${i}`, producer: 'load-test', timestamp: 0 },
      });
    }

    const ringWarns = warnSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('ring buffer write failed'),
    );
    // 50 simulated minutes at one line per minute per key, ceiling included.
    expect(ringWarns.length).toBeLessThan(120);
    expect(transport.getOverflowStats().ringBufferFailures).toBe(5_000);

    await transport.disconnect();
  });
});

describe('timer and listener lifecycle', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
  });

  it('disconnect() releases the re-sync interval, the heartbeat and every poller', async () => {
    vi.useFakeTimers();
    try {
      const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://registry:3010' } as never);
      catalog.declare({
        name: 'orders:created',
        transport: 'durable',
        producer: 'load-test-service',
        schema: { type: 'object' },
      } as never);
      await catalog.connect();
      catalog.startHeartbeating(60_000);
      const sub = catalog.subscribe('orders:created', async () => {});
      await Promise.resolve();

      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await sub.unsubscribe();
      await catalog.disconnect();

      // An interval that survives disconnect is what keeps a container
      // alive after SIGTERM.
      expect(vi.getTimerCount()).toBe(0);
      expect(catalog.getDurableTransport().getActivePollerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second startHeartbeating() replaces the first loop instead of adding one', async () => {
    vi.useFakeTimers();
    try {
      const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://registry:3010' } as never);
      catalog.declare({
        name: 'orders:created',
        transport: 'signal',
        producer: 'load-test-service',
        schema: { type: 'object' },
      } as never);
      await catalog.connect();
      const before = vi.getTimerCount();

      catalog.startHeartbeating(60_000);
      const afterFirst = vi.getTimerCount();
      catalog.startHeartbeating(60_000);
      const afterSecond = vi.getTimerCount();

      expect(afterFirst).toBe(before + 1);
      expect(afterSecond).toBe(afterFirst);

      await catalog.disconnect();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('connect() twice does not double-register, and disconnect() twice is safe', async () => {
    vi.useFakeTimers();
    try {
      const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://registry:3010' } as never);
      catalog.declare({
        name: 'orders:created',
        transport: 'signal',
        producer: 'load-test-service',
        schema: { type: 'object' },
      } as never);

      // Concurrent connects race past the `connected` guard; each used to
      // install its own 60s re-sync interval, and only the last handle was
      // kept — the rest survived disconnect forever.
      await Promise.all([catalog.connect(), catalog.connect()]);
      await catalog.connect();
      const afterConnects = vi.getTimerCount();

      await catalog.disconnect();
      await catalog.disconnect();

      expect(afterConnects).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejected connect() leaves nothing running', async () => {
    vi.useFakeTimers();
    try {
      const redis = await import('redis');
      const createClient = redis.createClient as unknown as ReturnType<typeof vi.fn>;
      createClient.mockImplementationOnce(() => {
        const c = mockRedisClient();
        c.connect = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        return c;
      });

      const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://registry:3010' } as never);
      await expect(catalog.connect()).rejects.toThrow();

      expect(catalog.isConnected()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(catalog.getSignalTransport().isConnected()).toBe(false);
      // The durable half may have succeeded; the failed connect must still
      // have torn it back down rather than leaving a half-live catalog.
      expect(catalog.getDurableTransport().isConnected()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('two subscriptions to one queue keep two cancellable pollers', async () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    await t.connect();

    const cancelA = t.subscribe('shared-queue', async () => {});
    const cancelB = t.subscribe('shared-queue', async () => {});
    expect(t.getActivePollerCount()).toBe(2);

    // Cancelling one used to delete the *other* one's map entry, orphaning
    // a poll loop that disconnect() could then never abort.
    cancelA();
    expect(t.getActivePollerCount()).toBe(1);
    cancelB();
    expect(t.getActivePollerCount()).toBe(0);

    await t.disconnect();
  });
});

describe('bounded primitives', () => {
  it('BoundedCounter evicts oldest-first and keeps an exact total', () => {
    const c = new BoundedCounter(3);
    c.increment('a', 2);
    c.increment('b');
    c.increment('c');
    c.increment('d'); // evicts 'a'

    expect(c.size).toBe(3);
    expect(c.get('a')).toBe(0);
    expect(c.get('d')).toBe(1);
    expect(c.total).toBe(5);
    expect(c.evictedKeys).toBe(1);
    expect(c.evictedTotal).toBe(2);
  });

  it('LogThrottle bounds lines per window even when every key is new', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const t = new LogThrottle({ maxKeys: 4, maxPerWindow: 3, windowMs: 60_000 });

      let emitted = 0;
      for (let i = 0; i < 1_000; i++) {
        if (t.attempt(`key-${i}`) !== null) emitted++;
      }
      expect(emitted).toBe(3);
      expect(t.suppressedTotal).toBe(997);
      expect(t.trackedKeys).toBeLessThanOrEqual(4);

      // A new window re-arms the ceiling, and the emitted line carries the
      // suppressed count so the reader knows it is a sample.
      vi.advanceTimersByTime(60_000);
      expect(t.attempt('key-fresh')).toBe(997);
    } finally {
      vi.useRealTimers();
    }
  });
});
