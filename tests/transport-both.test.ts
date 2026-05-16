import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------- In-memory Redis pub/sub simulator ----------
// Both publish and subscribe mock clients share this map so messages route correctly.
const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();
let streamIdCounter = 0;

function createMockRedisClient() {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      const handlers = subscriptions.get(channel);
      if (handlers) for (const h of handlers) h(message, channel);
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (message: string, channel: string) => void) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => { subscriptions.delete(channel); }),
    xAdd: vi.fn(async () => `${++streamIdCounter}-0`),
    xRange: vi.fn(async () => []),
  };
}

vi.mock('redis', () => ({ createClient: vi.fn(() => createMockRedisClient()) }));

// ---------- Global fetch mock ----------
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

function urlStr(url: string | URL | Request): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
}

function durableMessageCalls() {
  return fetchMock.mock.calls.filter(([url, opts]: [string | URL | Request, RequestInit | undefined]) =>
    urlStr(url).includes('/messages') && opts?.method === 'POST',
  );
}

// Default fetch stub: health → 200, queue ensure (PUT) → 200, message send → 200.
function defaultFetchMock() {
  fetchMock.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
    const s = urlStr(url);
    if (s.includes('/health')) return new Response('ok', { status: 200 });
    if (s.includes('/queues') && opts?.method === 'PUT' && !s.includes('/messages'))
      return new Response(JSON.stringify({ queue_name: 'test' }), { status: 200 });
    if (s.includes('/attributes'))
      return new Response(JSON.stringify({ approximate_number_of_messages: 0 }), { status: 200 });
    if (s.includes('/messages') && opts?.method === 'POST')
      return new Response(JSON.stringify({ message_id: 'msg-1' }), { status: 200 });
    if (s.includes('/api/events')) return new Response('ok', { status: 200 });
    return new Response('not found', { status: 404 });
  });
}

describe("transport: 'both' fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions.clear();
    streamIdCounter = 0;
    defaultFetchMock();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('fan-out: single publish reaches BOTH signal channel AND durable queue', async () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.both',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    // Subscribe directly to the signal channel — bypasses catalog.subscribe() so
    // we don't depend on its 'both' handling.
    const signalReceived: unknown[] = [];
    subscriptions.set('infra.both', new Set([(msg) => {
      signalReceived.push(JSON.parse(msg));
    }]));

    await catalog.publish('infra.both', { id: 'x1' });

    // Signal arm received the event.
    expect(signalReceived).toHaveLength(1);
    const sig = signalReceived[0] as { eventName: string; payload: { id: string } };
    expect(sig.eventName).toBe('infra.both');
    expect(sig.payload).toEqual({ id: 'x1' });

    // Durable arm sent to message-queue HTTP.
    const durableCalls = durableMessageCalls();
    expect(durableCalls).toHaveLength(1);
    const body = JSON.parse(durableCalls[0][1].body as string);
    const durEnv = JSON.parse(body.message_body);
    expect(durEnv.eventName).toBe('infra.both');
    expect(durEnv.payload).toEqual({ id: 'x1' });

    await catalog.disconnect();
  });

  it('both arms carry the SAME envelope metadata.id and payload', async () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.consistency',
      schema: { type: 'object' },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    let signalEnvelopeId: string | undefined;
    subscriptions.set('infra.consistency', new Set([(msg) => {
      signalEnvelopeId = (JSON.parse(msg) as { metadata: { id: string } }).metadata.id;
    }]));

    await catalog.publish('infra.consistency', { val: 42 });

    const body = JSON.parse(durableMessageCalls()[0][1].body as string);
    const durEnv = JSON.parse(body.message_body) as { metadata: { id: string }; payload: unknown };

    expect(signalEnvelopeId).toBeDefined();
    expect(durEnv.metadata.id).toBe(signalEnvelopeId);
    expect(durEnv.payload).toEqual({ val: 42 });

    await catalog.disconnect();
  });

  it('multiple publishes: each publish fans out to both arms independently', async () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.multi',
      schema: { type: 'object' },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    const signalReceived: unknown[] = [];
    subscriptions.set('infra.multi', new Set([(msg) => {
      signalReceived.push((JSON.parse(msg) as { payload: unknown }).payload);
    }]));

    await catalog.publish('infra.multi', { n: 1 });
    await catalog.publish('infra.multi', { n: 2 });
    await catalog.publish('infra.multi', { n: 3 });

    expect(signalReceived).toHaveLength(3);
    expect(signalReceived).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(durableMessageCalls()).toHaveLength(3);

    await catalog.disconnect();
  });

  it('failure mode: durable fails — publish rejects but signal was still sent (Promise.allSettled semantics)', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
      const s = urlStr(url);
      if (s.includes('/health')) return new Response('ok', { status: 200 });
      if (s.includes('/queues') && opts?.method === 'PUT' && !s.includes('/messages'))
        return new Response(JSON.stringify({ queue_name: 'test' }), { status: 200 });
      if (s.includes('/attributes'))
        return new Response(JSON.stringify({ approximate_number_of_messages: 0 }), { status: 200 });
      if (s.includes('/messages') && opts?.method === 'POST')
        return new Response('queue unavailable', { status: 500 });
      if (s.includes('/api/events')) return new Response('ok', { status: 200 });
      return new Response('not found', { status: 404 });
    });

    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.durable-fail',
      schema: { type: 'object' },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    const signalReceived: unknown[] = [];
    subscriptions.set('infra.durable-fail', new Set([(msg) => {
      signalReceived.push((JSON.parse(msg) as { payload: unknown }).payload);
    }]));

    // Publish should reject because durable failed.
    await expect(catalog.publish('infra.durable-fail', { x: 1 })).rejects.toThrow();

    // Signal arm still fired (Promise.allSettled waits for both before surfacing the rejection).
    expect(signalReceived).toHaveLength(1);
    expect(signalReceived[0]).toEqual({ x: 1 });

    // Error count incremented.
    const entry = catalog.getRegistry().get('infra.durable-fail')!;
    expect(entry.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('failure mode: signal fails — publish rejects but durable message was still attempted', async () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.signal-fail',
      schema: { type: 'object' },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    // Poison the signal transport's publish after connect.
    const signalTransport = catalog.getSignalTransport();
    vi.spyOn(signalTransport, 'publish').mockRejectedValue(new Error('Redis connection lost'));

    await expect(catalog.publish('infra.signal-fail', { y: 2 })).rejects.toThrow('Redis connection lost');

    // Durable arm was still attempted (allSettled sees both outcomes before throwing).
    expect(durableMessageCalls()).toHaveLength(1);

    // Error count incremented.
    const entry = catalog.getRegistry().get('infra.signal-fail')!;
    expect(entry.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('publishCount only increments when BOTH arms succeed', async () => {
    const catalog = new EventCatalog(makeConfig());
    catalog.declare({
      name: 'infra.counts',
      schema: { type: 'object' },
      transport: 'both',
      producer: 'test-service',
    });

    await catalog.connect();

    // First publish — both arms succeed.
    await catalog.publish('infra.counts', { n: 1 });
    let entry = catalog.getRegistry().get('infra.counts')!;
    expect(entry.metadata.publishCount).toBe(1);
    expect(entry.metadata.errorCount).toBe(0);

    // Inject durable failure for the second publish only.
    const durableTransport = catalog.getDurableTransport();
    vi.spyOn(durableTransport, 'publish').mockRejectedValueOnce(new Error('durable unavailable'));

    // Second publish — durable arm fails.
    await expect(catalog.publish('infra.counts', { n: 2 })).rejects.toThrow('durable unavailable');
    entry = catalog.getRegistry().get('infra.counts')!;
    expect(entry.metadata.publishCount).toBe(1); // did not increment on failure
    expect(entry.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it("'both' event does not interfere with pure-signal or pure-durable events", async () => {
    const catalog = new EventCatalog(makeConfig());

    catalog.declare({ name: 'only.signal', schema: { type: 'object' }, transport: 'signal', producer: 'test-service' });
    catalog.declare({ name: 'only.durable', schema: { type: 'object' }, transport: 'durable', producer: 'test-service' });
    catalog.declare({ name: 'fan.both', schema: { type: 'object' }, transport: 'both', producer: 'test-service' });

    await catalog.connect();

    const signalHits: Record<string, number> = {};
    subscriptions.set('only.signal', new Set([(msg) => {
      const name = (JSON.parse(msg) as { eventName: string }).eventName;
      signalHits[name] = (signalHits[name] ?? 0) + 1;
    }]));
    subscriptions.set('fan.both', new Set([(msg) => {
      const name = (JSON.parse(msg) as { eventName: string }).eventName;
      signalHits[name] = (signalHits[name] ?? 0) + 1;
    }]));

    await catalog.publish('only.signal', {});
    await catalog.publish('only.durable', {});
    await catalog.publish('fan.both', {});

    // only.signal delivered on signal channel.
    expect(signalHits['only.signal']).toBe(1);
    // fan.both also delivered on signal channel.
    expect(signalHits['fan.both']).toBe(1);
    // only.durable + fan.both = 2 durable message POSTs.
    expect(durableMessageCalls()).toHaveLength(2);

    await catalog.disconnect();
  });
});
