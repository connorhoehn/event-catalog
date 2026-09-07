// tests/client-publish-edges.test.ts
//
// EventCatalog publish/subscribe edge behaviour that the happy-path suites
// (client-integration, transport-both, publish-signal) don't reach:
//   - partial fan-out failure on transport:'both' (one leg down)
//   - concurrent publishes and the publishCount / errorCount accounting
//   - beforePublish/afterPublish hook failure semantics
//   - namespace-policy defaults for dlqAfterAttempts and tags
//   - subscribe() rejection on a function-typed channel and on an
//     undeclared event
//   - remote-registry deregistration failures staying non-fatal

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const channels = new Map<string, Set<(message: string, channel: string) => void>>();

function mockRedisClient(): Record<string, unknown> {
  return {
    connect: vi.fn(async () => {}),
    quit: vi.fn(async () => {}),
    on: vi.fn(),
    publish: vi.fn(async (channel: string, message: string) => {
      const hs = channels.get(channel);
      if (hs) for (const h of hs) h(message, channel);
      return hs?.size ?? 0;
    }),
    subscribe: vi.fn(async (channel: string, handler: (m: string, c: string) => void) => {
      if (!channels.has(channel)) channels.set(channel, new Set());
      channels.get(channel)!.add(handler);
    }),
    unsubscribe: vi.fn(async (channel: string) => { channels.delete(channel); }),
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
import type { EventEnvelope, EventDeclaration } from '../src/types/index.js';

function urlOf(u: string | URL | Request): string {
  return typeof u === 'string' ? u : u instanceof URL ? u.toString() : (u as Request).url;
}

/** health/PUT-queue OK; message POSTs delegated to `onSend`. */
function stubFetch(onSend: (url: string) => Response | Promise<Response>): void {
  fetchMock.mockImplementation(async (u: string | URL | Request, opts?: RequestInit) => {
    const s = urlOf(u);
    if (s.includes('/health')) return new Response('ok', { status: 200 });
    if (opts?.method === 'PUT') return new Response('{}', { status: 200 });
    if (s.includes('/messages') && opts?.method === 'POST') return onSend(s);
    return new Response('{}', { status: 200 });
  });
}

function baseConfig(): Record<string, unknown> {
  return {
    redis: { url: 'redis://localhost:6379' },
    messageQueue: { url: 'http://localhost:3004' },
    serviceName: 'test-service',
  };
}

const orderDecl: EventDeclaration = {
  name: 'orders:created',
  transport: 'both',
  producer: 'test-service',
  schema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
};

describe('EventCatalog.publish — partial fan-out failure', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let catalog: EventCatalog;

  beforeEach(async () => {
    channels.clear();
    fetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await catalog?.disconnect().catch(() => {});
  });

  it('still delivers on the healthy leg when the durable leg fails, and rethrows', async () => {
    stubFetch(() => new Response('mq down', { status: 500 }));
    catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare(orderDecl);

    const seen: EventEnvelope[] = [];
    await catalog.getSignalTransport().subscribe('orders:created', e => { seen.push(e); });

    await expect(catalog.publish('orders:created', { orderId: 'o-1' })).rejects.toThrow(
      /message-queue returned 500/,
    );

    // Promise.allSettled means the signal leg was NOT short-circuited by
    // the durable failure — a partial delivery must not be silently masked
    // and must not be silently skipped either.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload).toEqual({ orderId: 'o-1' });

    // The failure is accounted for, and publishCount is NOT bumped.
    const entry = catalog.getRegistry().get('orders:created')!;
    expect(entry.metadata.errorCount).toBe(1);
    expect(entry.metadata.publishCount).toBe(0);
  });

  it('records a successful publish exactly once on the entry metadata', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare(orderDecl);

    await catalog.publish('orders:created', { orderId: 'o-1' });

    const entry = catalog.getRegistry().get('orders:created')!;
    expect(entry.metadata.publishCount).toBe(1);
    expect(entry.metadata.errorCount).toBe(0);
    expect(entry.metadata.lastPublishedAt).toBeTypeOf('string');
  });

  it('counts every publish under concurrency without losing an increment', async () => {
    stubFetch(() => new Response('{}', { status: 200 }));
    catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'signal' });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => catalog.publish('orders:created', { orderId: `o-${i}` })),
    );

    // publishCount is read-modify-write against the registry entry, so a
    // dropped increment here would mean the flow view under-reports load.
    expect(catalog.getRegistry().get('orders:created')!.metadata.publishCount).toBe(20);
  });

  it('mixes successes and failures correctly when both are in flight', async () => {
    let n = 0;
    stubFetch(() => (++n % 2 === 0 ? new Response('nope', { status: 500 }) : new Response('{}', { status: 200 })));
    catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'durable' });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => catalog.publish('orders:created', { orderId: `o-${i}` })),
    );

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const bad = results.length - ok;
    const meta = catalog.getRegistry().get('orders:created')!.metadata;
    expect(ok + bad).toBe(6);
    expect(meta.publishCount).toBe(ok);
    expect(meta.errorCount).toBe(bad);
  });
});

describe('EventCatalog.publish — validation rejection paths', () => {
  let catalog: EventCatalog;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    channels.clear();
    fetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(() => new Response('{}', { status: 200 }));
    catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await catalog.disconnect().catch(() => {});
  });

  it('rejects a schema-invalid payload before any transport is touched', async () => {
    catalog.declare({ ...orderDecl, transport: 'durable' });
    fetchMock.mockClear();

    await expect(catalog.publish('orders:created', { wrong: true })).rejects.toThrow(
      /payload validation failed for "orders:created"/,
    );

    const posts = fetchMock.mock.calls.filter(
      ([, o]: [unknown, RequestInit | undefined]) => o?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
    // A rejected publish must not be counted as an error against the
    // transport — the payload never left the process.
    expect(catalog.getRegistry().get('orders:created')!.metadata.errorCount).toBe(0);
  });

  it('rejects a payload whose discriminator value is not declared', async () => {
    catalog.declare({
      name: 'ingest:progress',
      transport: 'signal',
      producer: 'test-service',
      schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
      discriminator: { field: 'type', values: ['started', 'chunk', 'done'] },
    } as EventDeclaration);

    await expect(catalog.publish('ingest:progress', { type: 'exploded' })).rejects.toThrow(
      /discriminator validation failed .* is not in declared values \[started, chunk, done\]/,
    );
    await expect(catalog.publish('ingest:progress', { type: 'chunk' })).resolves.toBeUndefined();
  });

  it('rejects a non-string discriminator value rather than coercing it', async () => {
    catalog.declare({
      name: 'ingest:numeric',
      transport: 'signal',
      producer: 'test-service',
      schema: { type: 'object' },
      discriminator: { field: 'type', values: ['1'] },
    } as EventDeclaration);

    await expect(catalog.publish('ingest:numeric', { type: 1 })).rejects.toThrow(
      /discriminator validation failed/,
    );
  });

  it('rejects publishing an event that was never declared', async () => {
    await expect(catalog.publish('never:declared', {})).rejects.toThrow(
      /"never:declared" is not declared/,
    );
  });

  it('publishSignal rejects an invalid payload for a DECLARED event but allows an undeclared one', async () => {
    catalog.declare({ ...orderDecl, transport: 'signal' });

    await expect(catalog.publishSignal('room-1', 'orders:created', { nope: 1 })).rejects.toThrow(
      /publishSignal payload validation failed/,
    );

    // Undeclared: warns and proceeds (strict rejection is a later wave).
    await expect(catalog.publishSignal('room-1', 'wholly:undeclared', { a: 1 })).resolves.toBe(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('undeclared event "wholly:undeclared"');
  });

  it('publishSignal honours an explicit numeric timestamp option', async () => {
    catalog.declare({ ...orderDecl, transport: 'signal' });

    let captured: Record<string, unknown> | undefined;
    await catalog.getSignalTransport().subscribe('websocket:route:room-1', () => {});
    const redis = catalog.getSignalTransport() as unknown as {
      publishClient: { publish: (c: string, m: string) => Promise<number> };
    };
    const original = redis.publishClient.publish;
    redis.publishClient.publish = async (c: string, m: string) => {
      if (c === 'websocket:route:room-1') captured = JSON.parse(m);
      return original(c, m);
    };

    await catalog.publishSignal('room-1', 'orders:created', { orderId: 'o-1' }, { timestamp: 0 });

    expect(captured?.timestamp).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('EventCatalog.publish — hooks', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    channels.clear();
    fetchMock.mockReset();
    stubFetch(() => new Response('{}', { status: 200 }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warnSpy.mockRestore());

  it('a throwing beforePublish hook aborts the publish and no transport is hit', async () => {
    const catalog = new EventCatalog({
      ...baseConfig(),
      hooks: [{ beforePublish: async () => { throw new Error('policy gate rejected'); } }],
    } as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'durable' });
    fetchMock.mockClear();

    await expect(catalog.publish('orders:created', { orderId: 'o-1' })).rejects.toThrow(
      'policy gate rejected',
    );
    expect(
      fetchMock.mock.calls.filter(([, o]: [unknown, RequestInit | undefined]) => o?.method === 'POST'),
    ).toHaveLength(0);
    expect(catalog.getRegistry().get('orders:created')!.metadata.errorCount).toBe(1);

    await catalog.disconnect();
  });

  it('a throwing afterPublish hook is logged but does NOT fail the publish that already landed', async () => {
    const after = vi.fn(async () => { throw new Error('audit sink down'); });
    const catalog = new EventCatalog({
      ...baseConfig(),
      hooks: [{ afterPublish: after }],
    } as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'durable' });

    await expect(catalog.publish('orders:created', { orderId: 'o-1' })).resolves.toBeUndefined();

    expect(after).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('afterPublish hook threw');
    expect(catalog.getRegistry().get('orders:created')!.metadata.publishCount).toBe(1);

    await catalog.disconnect();
  });

  it('beforePublish hooks run in declared order so a later hook sees earlier mutations', async () => {
    const order: string[] = [];
    const catalog = new EventCatalog({
      ...baseConfig(),
      hooks: [
        { beforePublish: async () => { order.push('first'); } },
        { beforePublish: async () => { order.push('second'); } },
      ],
    } as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'signal' });

    await catalog.publish('orders:created', { orderId: 'o-1' });
    expect(order).toEqual(['first', 'second']);

    await catalog.disconnect();
  });
});

describe('EventCatalog.declare — namespace policy defaults', () => {
  it('fills dlqAfterAttempts and unions tags without overriding explicit per-event values', async () => {
    const catalog = new EventCatalog({
      ...baseConfig(),
      namespacePolicies: {
        orders: {
          dlqAfterAttempts: 5,
          dlqRetention: 1209600,
          retention: 3600,
          compatibilityMode: 'full',
          tags: ['pii', 'audited'],
        },
      },
    } as never);

    catalog.declare({
      name: 'orders:created',
      transport: 'durable',
      producer: 'test-service',
      schema: { type: 'object' },
      tags: ['orders'],
      // Explicit value must survive the policy merge.
      retention: 60,
    } as EventDeclaration);

    const entry = catalog.getRegistry().get('orders:created')!;
    expect(entry.dlqAfterAttempts).toBe(5);
    expect(entry.dlqRetention).toBe(1209600);
    expect(entry.retention).toBe(60);
    expect(entry.compatibilityMode).toBe('full');
    expect([...(entry.tags ?? [])].sort()).toEqual(['audited', 'orders', 'pii']);
  });

  it('does not mutate the caller\'s declaration object', async () => {
    const catalog = new EventCatalog({
      ...baseConfig(),
      namespacePolicies: { orders: { tags: ['pii'], dlqAfterAttempts: 5 } },
    } as never);

    const decl: EventDeclaration = {
      name: 'orders:created',
      transport: 'durable',
      producer: 'test-service',
      schema: { type: 'object' },
      tags: ['orders'],
    };
    catalog.declare(decl);

    // Shared declaration arrays are re-used across catalogs at boot; a
    // merge that mutated the input would leak policy across services.
    expect(decl.tags).toEqual(['orders']);
    expect(decl.dlqAfterAttempts).toBeUndefined();
  });

  it('leaves declarations in an unpoliced namespace untouched', async () => {
    const catalog = new EventCatalog({
      ...baseConfig(),
      namespacePolicies: { orders: { dlqAfterAttempts: 5 } },
    } as never);

    catalog.declare({
      name: 'payments:settled',
      transport: 'durable',
      producer: 'test-service',
      schema: { type: 'object' },
    } as EventDeclaration);

    expect(catalog.getRegistry().get('payments:settled')!.dlqAfterAttempts).toBeUndefined();
    expect(catalog.getNamespacePolicy('orders')?.dlqAfterAttempts).toBe(5);
    expect(catalog.getNamespacePolicy('payments')).toBeUndefined();
  });
});

describe('EventCatalog.subscribe — rejection paths', () => {
  beforeEach(() => {
    channels.clear();
    fetchMock.mockReset();
    stubFetch(() => new Response('{}', { status: 200 }));
  });

  it('throws when the event was never declared', async () => {
    const catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();

    expect(() => catalog.subscribe('never:declared', async () => {})).toThrow(
      /"never:declared" is not declared/,
    );

    await catalog.disconnect();
  });

  it('throws a directive error when the declared channel is a per-payload function', async () => {
    const catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare({
      name: 'crdt:update',
      transport: 'signal',
      producer: 'test-service',
      schema: { type: 'object' },
      channel: (p: unknown) => `document:${(p as { documentId: string }).documentId}`,
    } as unknown as EventDeclaration);

    expect(() => catalog.subscribe('crdt:update', async () => {})).toThrow(
      /its declared channel is a function/,
    );

    // The publish side, which HAS a payload, still resolves it fine.
    const seen: string[] = [];
    await catalog.getSignalTransport().subscribe('document:doc-9', e => { seen.push(e.eventName); });
    await catalog.publish('crdt:update', { documentId: 'doc-9' });
    expect(seen).toEqual(['crdt:update']);

    await catalog.disconnect();
  });

  it('pause() suppresses handler delivery without tearing down the subscription', async () => {
    const catalog = new EventCatalog(baseConfig() as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'signal' });

    const received: string[] = [];
    const sub = catalog.subscribe<{ orderId: string }>('orders:created', async e => {
      received.push(e.payload.orderId);
    });
    await new Promise(r => setImmediate(r));

    await catalog.publish('orders:created', { orderId: 'a' });
    sub.pause();
    expect(sub.isPaused()).toBe(true);
    await catalog.publish('orders:created', { orderId: 'b' });
    sub.resume();
    expect(sub.isPaused()).toBe(false);
    await catalog.publish('orders:created', { orderId: 'c' });

    expect(received).toEqual(['a', 'c']);

    await sub.unsubscribe();
    await catalog.disconnect();
  });

  it('a remote-registry deregistration failure is warned, not thrown, on unsubscribe', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(async (u: string | URL | Request, opts?: RequestInit) => {
      const s = urlOf(u);
      if (s.includes('/subscribers') && opts?.method === 'DELETE') {
        return new Response('gone', { status: 503, statusText: 'Service Unavailable' });
      }
      if (s.includes('/health')) return new Response('ok', { status: 200 });
      return new Response('{}', { status: 200 });
    });

    const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://catalog:3010' } as never);
    await catalog.connect();
    catalog.declare({ ...orderDecl, transport: 'signal' });

    const sub = catalog.subscribe('orders:created', async () => {});
    await new Promise(r => setImmediate(r));

    // Losing the central registry must never break a local unsubscribe.
    await expect(sub.unsubscribe()).resolves.toBeUndefined();
    await new Promise(r => setImmediate(r));
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('failed to deregister subscriber');

    warnSpy.mockRestore();
    await catalog.disconnect();
  });
});

describe('EventCatalog.getSchemaFingerprint', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns null with no registryUrl configured and null on a 404', async () => {
    const noRegistry = new EventCatalog(baseConfig() as never);
    expect(await noRegistry.getSchemaFingerprint('orders:created')).toBeNull();

    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://catalog:3010' } as never);
    expect(await catalog.getSchemaFingerprint('orders:created')).toBeNull();
  });

  it('returns null when the server answers 200 without a fingerprint field', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'orders:created' }), { status: 200 }));
    const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://catalog:3010' } as never);
    expect(await catalog.getSchemaFingerprint('orders:created')).toBeNull();
  });

  it('throws on any other non-2xx so a drift check cannot silently pass', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://catalog:3010' } as never);
    await expect(catalog.getSchemaFingerprint('orders:created')).rejects.toThrow(/HTTP 500/);
  });

  it('URL-encodes the event name so a colon-separated name is not truncated', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ schemaFingerprint: 'abc' }), { status: 200 }));
    const catalog = new EventCatalog({ ...baseConfig(), registryUrl: 'http://catalog:3010' } as never);

    expect(await catalog.getSchemaFingerprint('orders:created')).toBe('abc');
    expect(urlOf(fetchMock.mock.calls[0]![0])).toBe(
      'http://catalog:3010/api/events/orders%3Acreated',
    );
  });
});
