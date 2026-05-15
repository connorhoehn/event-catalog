import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory Redis pub/sub + streams simulator
const subscriptions = new Map<string, Set<(message: string, channel: string) => void>>();
const streams = new Map<string, Array<{ id: string; message: Record<string, string> }>>();
let streamIdCounter = 0;

function createMockRedisClient() {
  let connected = false;
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>();

  return {
    connect: vi.fn(async () => { connected = true; }),
    quit: vi.fn(async () => { connected = false; }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    }),
    publish: vi.fn(async (channel: string, message: string) => {
      const handlers = subscriptions.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          handler(message, channel);
        }
      }
      return handlers?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (message: string, channel: string) => void) => {
      if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
      subscriptions.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => {
      subscriptions.delete(channel);
    }),
    xAdd: vi.fn(async (key: string, id: string, fields: Record<string, string>, _opts?: unknown) => {
      if (!streams.has(key)) streams.set(key, []);
      const entryId = `${++streamIdCounter}-0`;
      streams.get(key)!.push({ id: entryId, message: fields });
      return entryId;
    }),
    xRange: vi.fn(async (key: string, _start: string, _end: string) => {
      return streams.get(key) ?? [];
    }),
  };
}

// Mock the redis module at the top level
vi.mock('redis', () => ({
  createClient: vi.fn(() => createMockRedisClient()),
}));

// Mock global fetch for durable transport and registry sync
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EventCatalog } from '../src/client/index.js';

function makeConfig(overrides?: { registryUrl?: string }) {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
    ...overrides,
  };
}

describe('EventCatalog Client Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions.clear();
    streams.clear();
    streamIdCounter = 0;

    // Default fetch mock: healthy durable transport
    fetchMock.mockImplementation(async (url: string | URL | Request, opts?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes('/health')) {
        return new Response('ok', { status: 200 });
      }
      if (urlStr.includes('/queues') && opts?.method === 'POST' && !urlStr.includes('/messages')) {
        return new Response(JSON.stringify({ queue_name: 'test' }), { status: 201 });
      }
      if (urlStr.includes('/messages') && opts?.method === 'POST') {
        return new Response(JSON.stringify({ message_id: 'msg-1' }), { status: 200 });
      }
      if (urlStr.includes('/api/events')) {
        return new Response('ok', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('Signal round-trip', () => {
    it('Client publishes signal event and subscriber receives it', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'test.signal',
        schema: { type: 'object', properties: { msg: { type: 'string' } } },
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      const received: unknown[] = [];
      const sub = catalog.subscribe('test.signal', (envelope) => {
        received.push(envelope.payload);
      });

      // Allow subscription setup to complete
      await new Promise(r => setTimeout(r, 10));

      await catalog.publish('test.signal', { msg: 'hello' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ msg: 'hello' });

      await sub.unsubscribe();
      await catalog.disconnect();
    });

    it('Subscription.pause()/resume() controls handler delivery (wave20-b)', async () => {
      const catalog = new EventCatalog(makeConfig());
      catalog.declare({
        name: 'gated.signal',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
      });
      await catalog.connect();

      const received: number[] = [];
      const sub = catalog.subscribe('gated.signal', (envelope) => {
        received.push((envelope.payload as { n: number }).n);
      });
      await new Promise((r) => setTimeout(r, 10));

      // Delivered while running.
      expect(sub.isPaused()).toBe(false);
      await catalog.publish('gated.signal', { n: 1 });
      expect(received).toEqual([1]);

      // Dropped while paused.
      sub.pause();
      expect(sub.isPaused()).toBe(true);
      await catalog.publish('gated.signal', { n: 2 });
      await catalog.publish('gated.signal', { n: 3 });
      expect(received).toEqual([1]);

      // Resumed.
      sub.resume();
      expect(sub.isPaused()).toBe(false);
      await catalog.publish('gated.signal', { n: 4 });
      expect(received).toEqual([1, 4]);

      await sub.unsubscribe();
      await catalog.disconnect();
    });
  });

  describe('Phase 20-c — publish middleware (PublishHook)', () => {
    it('beforePublish runs in order and can mutate metadata.headers', async () => {
      const order: string[] = [];
      const catalog = new EventCatalog({
        ...makeConfig(),
        hooks: [
          {
            beforePublish(envelope) {
              order.push('A');
              envelope.metadata.headers = { ...(envelope.metadata.headers ?? {}), traceparent: '00-abcd' };
            },
          },
          {
            beforePublish(envelope) {
              order.push('B');
              // Second hook can read what the first hook set.
              envelope.metadata.headers = {
                ...(envelope.metadata.headers ?? {}),
                'x-trace-seen': envelope.metadata.headers?.traceparent ?? 'missing',
              };
            },
          },
        ],
      });
      catalog.declare({
        name: 'hooked.signal',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
      });
      await catalog.connect();

      const received: Array<Record<string, string>> = [];
      catalog.subscribe('hooked.signal', (envelope) => {
        received.push(envelope.metadata.headers ?? {});
      });
      await new Promise((r) => setTimeout(r, 10));

      await catalog.publish('hooked.signal', { x: 1 });

      expect(order).toEqual(['A', 'B']);
      expect(received[0]).toMatchObject({
        traceparent: '00-abcd',
        'x-trace-seen': '00-abcd',
      });

      await catalog.disconnect();
    });

    it('beforePublish throwing aborts the publish + bumps errorCount', async () => {
      const catalog = new EventCatalog({
        ...makeConfig(),
        hooks: [
          { beforePublish() { throw new Error('quota exceeded'); } },
        ],
      });
      catalog.declare({
        name: 'blocked.signal',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
      });
      await catalog.connect();

      await expect(catalog.publish('blocked.signal', {})).rejects.toThrow(/quota exceeded/);

      const stats = catalog.getRegistry().get('blocked.signal')!.metadata;
      expect(stats.errorCount).toBe(1);
      expect(stats.publishCount).toBe(0);

      await catalog.disconnect();
    });

    it('afterPublish receives the envelope post-transport-send', async () => {
      const seen: Array<{ name: string; namespace: string }> = [];
      const catalog = new EventCatalog({
        ...makeConfig(),
        hooks: [
          {
            afterPublish(envelope, entry) {
              seen.push({ name: envelope.eventName, namespace: entry.namespace });
            },
          },
        ],
      });
      catalog.declare({
        name: 'pipeline.foo',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'distributed-core',
      });
      await catalog.connect();

      await catalog.publish('pipeline.foo', {});
      expect(seen).toEqual([{ name: 'pipeline.foo', namespace: 'pipeline' }]);

      await catalog.disconnect();
    });

    it('afterPublish errors are caught and logged, do NOT fail the publish', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const catalog = new EventCatalog({
        ...makeConfig(),
        hooks: [
          { afterPublish() { throw new Error('audit sink down'); } },
        ],
      });
      catalog.declare({
        name: 'audit.signal',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
      });
      await catalog.connect();

      await expect(catalog.publish('audit.signal', {})).resolves.not.toThrow();
      const stats = catalog.getRegistry().get('audit.signal')!.metadata;
      expect(stats.publishCount).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('afterPublish hook threw'),
        expect.stringContaining('audit sink down'),
      );

      warnSpy.mockRestore();
      await catalog.disconnect();
    });
  });

  describe('Phase 20-b — declareAll + getSchemaFingerprint', () => {
    it('declareAll registers every event in the array', () => {
      const catalog = new EventCatalog(makeConfig());
      const events = [
        { name: 'a.x', schema: {}, transport: 'signal' as const, producer: 's' },
        { name: 'b.y', schema: {}, transport: 'signal' as const, producer: 's' },
        { name: 'c.z', schema: {}, transport: 'durable' as const, producer: 's' },
      ];
      catalog.declareAll(events);
      const reg = catalog.getRegistry();
      expect(reg.size()).toBe(3);
      expect(reg.get('a.x')).toBeDefined();
      expect(reg.get('c.z')!.transport).toBe('durable');
    });

    it('getSchemaFingerprint returns null when registryUrl is unset', async () => {
      const catalog = new EventCatalog(makeConfig());
      const fp = await catalog.getSchemaFingerprint('whatever');
      expect(fp).toBeNull();
    });

    it('getSchemaFingerprint fetches the current fingerprint from the registry', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog.test' }));
      fetchMock.mockImplementationOnce(async () => new Response(
        JSON.stringify({ name: 'a.x', schemaFingerprint: 'abcd1234'.padEnd(64, '0') }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
      const fp = await catalog.getSchemaFingerprint('a.x');
      expect(fp).toBe('abcd1234'.padEnd(64, '0'));
    });

    it('getSchemaFingerprint returns null on 404', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog.test' }));
      fetchMock.mockImplementationOnce(async () => new Response('not found', { status: 404 }));
      const fp = await catalog.getSchemaFingerprint('missing.event');
      expect(fp).toBeNull();
    });

    it('getSchemaFingerprint throws on other HTTP errors', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://catalog.test' }));
      fetchMock.mockImplementationOnce(async () => new Response('server', { status: 503 }));
      await expect(catalog.getSchemaFingerprint('a.x')).rejects.toThrow(/HTTP 503/);
    });
  });

  describe('Phase E3.5 — alias resolution', () => {
    it('publish via deprecated alias routes through canonical declaration', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'pipeline.approval.requested',
        schema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [{ name: 'pipeline:approval:requested', deprecated: true }],
      });

      await catalog.connect();

      const received: Array<{ raw: string }> = [];
      // Subscribe to the canonical channel (alias should route here).
      subscriptions.set('pipeline.approval.requested', new Set([(msg) => received.push({ raw: msg })]));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await catalog.publish('pipeline:approval:requested', { runId: 'r1' });

      expect(received).toHaveLength(1);
      const parsed = JSON.parse(received[0]!.raw) as { eventName: string };
      // Envelope's eventName is the canonical, not the alias.
      expect(parsed.eventName).toBe('pipeline.approval.requested');

      // Deprecation warning was emitted.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('routed via deprecated alias'),
      );

      warnSpy.mockRestore();
      await catalog.disconnect();
    });

    it('warns once per alias per process (no log spam)', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'pipeline.run.checkpoint',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [{ name: 'pipeline:run:checkpoint', deprecated: true }],
      });

      await catalog.connect();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await catalog.publish('pipeline:run:checkpoint', {});
      await catalog.publish('pipeline:run:checkpoint', {});
      await catalog.publish('pipeline:run:checkpoint', {});

      const aliasWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('routed via deprecated alias'),
      );
      expect(aliasWarns).toHaveLength(1);

      warnSpy.mockRestore();
      await catalog.disconnect();
    });

    it('throws when neither the canonical name nor any alias matches', async () => {
      const catalog = new EventCatalog(makeConfig());
      await catalog.connect();

      await expect(catalog.publish('unknown:event', { x: 1 })).rejects.toThrow(
        /is not declared/,
      );

      await catalog.disconnect();
    });

    it('subscribe via alias attaches to the canonical channel without warning', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'pipeline.approval.recorded',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [{ name: 'pipeline:approval:recorded', deprecated: true }],
      });

      await catalog.connect();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const received: unknown[] = [];
      const sub = catalog.subscribe('pipeline:approval:recorded', (env) => {
        received.push(env.payload);
      });
      await new Promise((r) => setTimeout(r, 10));

      await catalog.publish('pipeline.approval.recorded', { ok: true });

      expect(received).toEqual([{ ok: true }]);
      // Subscribe via alias does not warn (only producer-side alias use is
      // warned). Publish here used the canonical name, so total alias warnings
      // should be zero.
      const subWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('routed via deprecated alias'),
      );
      expect(subWarns).toHaveLength(0);

      await sub.unsubscribe();
      warnSpy.mockRestore();
      await catalog.disconnect();
    });

    it('resolveEvent() returns canonical entry on direct query (wave20-a)', () => {
      const catalog = new EventCatalog(makeConfig());
      catalog.declare({
        name: 'pipeline.approval.requested',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [{ name: 'pipeline:approval:requested', deprecated: true }],
      });
      const r = catalog.resolveEvent('pipeline.approval.requested');
      expect(r).toBeDefined();
      expect(r!.entry.name).toBe('pipeline.approval.requested');
      expect(r!.viaAlias).toBeUndefined();
    });

    it('resolveEvent() returns canonical entry + viaAlias on alias query (wave20-a)', () => {
      const catalog = new EventCatalog(makeConfig());
      catalog.declare({
        name: 'pipeline.approval.requested',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'distributed-core',
        aliases: [{ name: 'pipeline:approval:requested', deprecated: true, until: '2027-01-01' }],
      });
      const r = catalog.resolveEvent('pipeline:approval:requested');
      expect(r).toBeDefined();
      expect(r!.entry.name).toBe('pipeline.approval.requested');
      expect(r!.viaAlias).toEqual({ name: 'pipeline:approval:requested', until: '2027-01-01' });
    });

    it('resolveEvent() returns undefined for unknown names', () => {
      const catalog = new EventCatalog(makeConfig());
      expect(catalog.resolveEvent('nothing.declared')).toBeUndefined();
    });
  });

  describe('Phase E3.3 — declared signal channel', () => {
    it('publishes to a literal-string declared channel, not the event name', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'doc.comment.added',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
        channel: 'documents:comments',
      });

      await catalog.connect();

      const received: string[] = [];
      subscriptions.set('documents:comments', new Set([(msg) => received.push(msg)]));

      await catalog.publish('doc.comment.added', { docId: 'd1' });

      expect(received).toHaveLength(1);
      expect(subscriptions.has('doc.comment.added')).toBe(false);

      await catalog.disconnect();
    });

    it('resolves a function-typed channel against the payload at publish time', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'doc.update',
        schema: { type: 'object', properties: { docId: { type: 'string' } } },
        transport: 'signal',
        producer: 'test-service',
        channel: (p) => `documents:${(p as { docId: string }).docId}`,
      });

      await catalog.connect();

      const received: string[] = [];
      subscriptions.set('documents:42', new Set([(msg) => received.push(msg)]));

      await catalog.publish('doc.update', { docId: '42' });

      expect(received).toHaveLength(1);

      await catalog.disconnect();
    });

    it('falls back to the event name as the channel when channel is undeclared', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'plain.event',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      const received: string[] = [];
      subscriptions.set('plain.event', new Set([(msg) => received.push(msg)]));

      await catalog.publish('plain.event', { x: 1 });

      expect(received).toHaveLength(1);

      await catalog.disconnect();
    });

    it('subscribe() throws on function-typed channels (no payload to resolve from)', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'doc.update',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
        channel: (p) => `documents:${(p as { docId: string }).docId}`,
      });

      await catalog.connect();

      expect(() => catalog.subscribe('doc.update', () => {})).toThrow(
        /channel is a function/,
      );

      await catalog.disconnect();
    });
  });

  describe('Declare + topology', () => {
    it('after declaring events, the registry shows them in topology', () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'user.created',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
        transport: 'signal',
        producer: 'auth-service',
        description: 'Fired when a new user signs up',
        tags: ['auth', 'user'],
      });

      catalog.declare({
        name: 'order.placed',
        schema: { type: 'object', properties: { orderId: { type: 'string' } } },
        transport: 'durable',
        producer: 'order-service',
        description: 'Fired when an order is placed',
      });

      const registry = catalog.getRegistry();
      const topology = registry.getTopology();

      // Should have event nodes
      const eventNodes = topology.nodes.filter(n => n.type === 'event');
      expect(eventNodes).toHaveLength(2);
      expect(eventNodes.map(n => n.id)).toContain('user.created');
      expect(eventNodes.map(n => n.id)).toContain('order.placed');

      // Should have service nodes
      const serviceNodes = topology.nodes.filter(n => n.type === 'service');
      expect(serviceNodes.map(n => n.id)).toContain('auth-service');
      expect(serviceNodes.map(n => n.id)).toContain('order-service');

      // Should have publishes edges
      const publishEdges = topology.edges.filter(e => e.relation === 'publishes');
      expect(publishEdges).toHaveLength(2);
      expect(publishEdges).toContainEqual({ from: 'auth-service', to: 'user.created', relation: 'publishes' });
      expect(publishEdges).toContainEqual({ from: 'order-service', to: 'order.placed', relation: 'publishes' });
    });
  });

  describe('Schema validation on publish', () => {
    it('throws when payload does not match declared schema', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'typed.event',
        schema: {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
        },
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      // Publishing with invalid payload (string instead of number)
      await expect(
        catalog.publish('typed.event', { count: 'not-a-number' }),
      ).rejects.toThrow(/payload validation failed/);

      await catalog.disconnect();
    });

    it('allows publish when payload matches schema', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'typed.event',
        schema: {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
        },
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      await expect(
        catalog.publish('typed.event', { count: 42 }),
      ).resolves.not.toThrow();

      await catalog.disconnect();
    });
  });

  describe('Subscribe returns Subscription with unsubscribe', () => {
    it('after unsubscribe, handler is no longer called', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'unsub.test',
        schema: {},
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      const received: unknown[] = [];
      const sub = catalog.subscribe('unsub.test', (envelope) => {
        received.push(envelope.payload);
      });

      // Allow subscription setup
      await new Promise(r => setTimeout(r, 10));

      await catalog.publish('unsub.test', { before: true });
      expect(received).toHaveLength(1);

      await sub.unsubscribe();

      await catalog.publish('unsub.test', { after: true });
      // Should still only have 1 message since handler was unsubscribed
      expect(received).toHaveLength(1);

      await catalog.disconnect();
    });
  });

  describe('Multiple subscribers', () => {
    it('two subscribers both receive published messages', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'multi.sub',
        schema: {},
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];

      const subA = catalog.subscribe('multi.sub', (envelope) => {
        receivedA.push(envelope.payload);
      });
      const subB = catalog.subscribe('multi.sub', (envelope) => {
        receivedB.push(envelope.payload);
      });

      // Allow subscription setup
      await new Promise(r => setTimeout(r, 10));

      await catalog.publish('multi.sub', { value: 1 });

      expect(receivedA).toHaveLength(1);
      expect(receivedA[0]).toEqual({ value: 1 });
      expect(receivedB).toHaveLength(1);
      expect(receivedB[0]).toEqual({ value: 1 });

      await subA.unsubscribe();
      await subB.unsubscribe();
      await catalog.disconnect();
    });
  });

  describe('Durable publish', () => {
    it('verifies durable transport calls message-queue via HTTP', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'durable.event',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        transport: 'durable',
        producer: 'test-service',
      });

      await catalog.connect();

      await catalog.publish('durable.event', { id: 'abc-123' });

      // Verify fetch was called with the correct queue messages endpoint
      const messageCalls = fetchMock.mock.calls.filter(
        ([url, opts]: [string | URL | Request, RequestInit | undefined]) => {
          const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
          return urlStr.includes('/messages') && opts?.method === 'POST';
        },
      );

      expect(messageCalls).toHaveLength(1);
      const [callUrl, callOpts] = messageCalls[0];
      const urlStr = typeof callUrl === 'string' ? callUrl : callUrl instanceof URL ? callUrl.toString() : callUrl.url;
      expect(urlStr).toContain('/queues/durable-event/messages');

      const body = JSON.parse(callOpts.body as string);
      const envelope = JSON.parse(body.message_body);
      expect(envelope.eventName).toBe('durable.event');
      expect(envelope.payload).toEqual({ id: 'abc-123' });

      await catalog.disconnect();
    });
  });

  describe('Connect/disconnect lifecycle', () => {
    it('connect() establishes connections, disconnect() cleans up', async () => {
      const catalog = new EventCatalog(makeConfig());

      expect(catalog.isConnected()).toBe(false);

      await catalog.connect();
      expect(catalog.isConnected()).toBe(true);

      // Signal transport should be connected
      expect(catalog.getSignalTransport().isConnected()).toBe(true);
      // Durable transport should be connected
      expect(catalog.getDurableTransport().isConnected()).toBe(true);

      await catalog.disconnect();
      expect(catalog.isConnected()).toBe(false);
      expect(catalog.getSignalTransport().isConnected()).toBe(false);
      expect(catalog.getDurableTransport().isConnected()).toBe(false);
    });

    it('connect() is idempotent', async () => {
      const catalog = new EventCatalog(makeConfig());

      await catalog.connect();
      await catalog.connect(); // second call should be a no-op

      expect(catalog.isConnected()).toBe(true);

      await catalog.disconnect();
    });

    it('disconnect() is idempotent', async () => {
      const catalog = new EventCatalog(makeConfig());

      await catalog.connect();
      await catalog.disconnect();
      await catalog.disconnect(); // second call should be a no-op

      expect(catalog.isConnected()).toBe(false);
    });
  });

  describe('registryUrl sync', () => {
    it('connect() POSTs declarations to remote registry when registryUrl is set', async () => {
      const catalog = new EventCatalog(makeConfig({ registryUrl: 'http://localhost:9000' }));

      catalog.declare({
        name: 'sync.event',
        schema: { type: 'object' },
        transport: 'signal',
        producer: 'test-service',
        description: 'Synced event',
        tags: ['sync'],
      });

      await catalog.connect();

      // Verify POST was made to the bulk events endpoint
      const syncCalls = fetchMock.mock.calls.filter(
        ([url, opts]: [string | URL | Request, RequestInit | undefined]) => {
          const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
          return urlStr.includes('/api/events/bulk') && opts?.method === 'POST';
        },
      );

      expect(syncCalls).toHaveLength(1);
      const [, syncOpts] = syncCalls[0];
      const body = JSON.parse(syncOpts.body as string);
      expect(body.serviceName).toBe('test-service');
      expect(body.events).toHaveLength(1);
      expect(body.events[0].name).toBe('sync.event');
      expect(body.events[0].description).toBe('Synced event');
      expect(body.events[0].tags).toEqual(['sync']);

      await catalog.disconnect();
    });

    it('connect() does not POST when registryUrl is not set', async () => {
      const catalog = new EventCatalog(makeConfig());

      catalog.declare({
        name: 'local.event',
        schema: {},
        transport: 'signal',
        producer: 'test-service',
      });

      await catalog.connect();

      const syncCalls = fetchMock.mock.calls.filter(
        ([url]: [string | URL | Request]) => {
          const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
          return urlStr.includes('/api/events/bulk');
        },
      );

      expect(syncCalls).toHaveLength(0);

      await catalog.disconnect();
    });
  });
});
