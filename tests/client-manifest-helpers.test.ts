// tests/client-manifest-helpers.test.ts
//
// wave24-e — consumer-side helpers: startHeartbeating, exportManifest,
// pinManifest. These are thin wrappers but the *contract* (HTTP shape,
// no-op when registryUrl missing, returning stop fn) matters to ops.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock distributed-core / messaging-queue + the message-queue client like
// client-integration.test.ts does, so EventCatalog can be constructed
// without real Redis or MQ.
vi.mock('distributed-core/messaging-queue', () => ({
  JsonSchemaValidator: class {
    validate() { return { valid: true, errors: [] }; }
  },
}));

vi.mock('@connorhoehn/message-queue', () => ({
  MessageQueueClient: class {
    async healthCheck() { return { status: 'connected' }; }
    async createQueue() { return { queue_name: 'test' }; }
    async sendMessage() { return { message_id: 'msg-1' }; }
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index.js';

function makeConfig(overrides?: { registryUrl?: string }) {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'consumer-x',
    ...overrides,
  };
}

describe('wave24-e — consumer-side helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  describe('exportManifest()', () => {
    it('returns events the catalog is subscribed to with their fingerprints', () => {
      const catalog = new EventCatalog(makeConfig());
      catalog.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      catalog.declare({ name: 'b.y', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      // Subscribe only to a.x via registry to avoid the (unconnected) transport.
      catalog.getRegistry().addSubscriber('a.x', 'consumer-x');
      const m = catalog.exportManifest();
      expect(m.events).toHaveLength(1);
      expect(m.events[0]!.name).toBe('a.x');
      expect(m.events[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns an empty events array when no subscriptions exist', () => {
      const catalog = new EventCatalog(makeConfig());
      catalog.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      const m = catalog.exportManifest();
      expect(m.events).toEqual([]);
    });
  });

  describe('pinManifest()', () => {
    it('PUTs the manifest to /api/manifests/:consumer using serviceName', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
      catalog.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      catalog.getRegistry().addSubscriber('a.x', 'consumer-x');
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const result = await catalog.pinManifest();

      expect(fetchMock).toHaveBeenCalled();
      const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/manifests/'));
      expect(call).toBeTruthy();
      expect(String(call![0])).toBe('http://catalog:3010/api/manifests/consumer-x');
      expect(call![1]?.method).toBe('PUT');
      const body = JSON.parse(String(call![1]?.body));
      expect(body.events[0]?.name).toBe('a.x');
      expect(result).toEqual({ ok: true });
    });

    it('honors an explicit consumerName override', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
      catalog.declare({ name: 'z.q', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      catalog.getRegistry().addSubscriber('z.q', 'consumer-x');
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

      await catalog.pinManifest('worker-7');

      const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/manifests/'));
      expect(String(call![0])).toBe('http://catalog:3010/api/manifests/worker-7');
    });

    it('returns null when registryUrl is unset (no-op)', async () => {
      const catalog = new EventCatalog(makeConfig());
      const result = await catalog.pinManifest();
      expect(result).toBeNull();
    });

    it('throws on non-2xx HTTP', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
      catalog.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
      catalog.getRegistry().addSubscriber('a.x', 'consumer-x');
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

      await expect(catalog.pinManifest()).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('startHeartbeating()', () => {
    it('returns a no-op stop fn when registryUrl is unset', () => {
      const catalog = new EventCatalog(makeConfig());
      const stop = catalog.startHeartbeating(1000);
      expect(typeof stop).toBe('function');
      stop();
    });

    it('POSTs /api/heartbeat with subscribed events on each tick', async () => {
      vi.useFakeTimers();
      try {
        const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
        catalog.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
        catalog.getRegistry().addSubscriber('a.x', 'consumer-x');
        fetchMock.mockClear();

        const stop = catalog.startHeartbeating(60_000);
        // Immediate tick fires inside startHeartbeating.
        await vi.advanceTimersByTimeAsync(10);

        const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/heartbeat'));
        expect(call).toBeTruthy();
        const body = JSON.parse(String(call![1]?.body));
        expect(body.serviceName).toBe('consumer-x');
        expect(body.events).toEqual(['a.x']);

        // Second tick fires after the interval.
        fetchMock.mockClear();
        await vi.advanceTimersByTimeAsync(60_000);
        const second = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/heartbeat'));
        expect(second).toBeTruthy();

        stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the HTTP call when there are no subscriptions', async () => {
      vi.useFakeTimers();
      try {
        const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
        fetchMock.mockClear();
        const stop = catalog.startHeartbeating(60_000);
        await vi.advanceTimersByTimeAsync(10);
        const hb = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/heartbeat'));
        expect(hb).toBeUndefined();
        stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('swallows network failure in tick — logs warning and does not throw', async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog:3010' }));
        catalog.declare({ name: 'hb.event', schema: { type: 'object' }, transport: 'signal', producer: 'p' });
        catalog.getRegistry().addSubscriber('hb.event', 'consumer-x');

        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
        const stop = catalog.startHeartbeating(60_000);

        // Immediate tick fires — should not throw
        await vi.advanceTimersByTimeAsync(10);

        const hbWarn = warnSpy.mock.calls.find(c =>
          typeof c[0] === 'string' && (c[0] as string).includes('heartbeat failed'),
        );
        expect(hbWarn).toBeDefined();

        stop();
      } finally {
        vi.useRealTimers();
        warnSpy.mockRestore();
      }
    });
  });
});
