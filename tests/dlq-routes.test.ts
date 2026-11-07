// tests/dlq-routes.test.ts
//
// Route-level tests for the three DLQ HTTP endpoints that had no coverage:
//   GET    /api/transports/durable/dlq
//   DELETE /api/transports/durable/dlq/:id
//   POST   /api/transports/durable/dlq/:id/replay
//
// The batch-replay route (POST /api/transports/durable/dlq/replay) already
// has thorough coverage in routes.test.ts — not duplicated here.

import { describe, it, expect, vi } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

type DLQEntry = {
    id: string;
    pk: string;
    sk: string;
    eventName: string;
    payload: Record<string, unknown>;
    error: string;
    attempts: number;
    deadAt: string;
    ttl: number;
};

function makeEntry(overrides: Partial<DLQEntry> = {}): DLQEntry {
    return {
        id: 'entry-1',
        pk: 'DLQ#orders.failed',
        sk: '2026-05-15T00:00:00.000Z#entry-1',
        eventName: 'orders.failed',
        payload: { orderId: 'o1' },
        error: 'timeout',
        attempts: 3,
        deadAt: '2026-05-15T00:00:00.000Z',
        ttl: 1_700_000_000 + 30 * 86400,
        ...overrides,
    };
}

/** A `DurableTransport.getDLQ()` entry as the transport really shapes it. */
function makeDeadLettered(overrides: Record<string, unknown> = {}) {
    return {
        messageId: 'im-1',
        queueName: 'orders-failed',
        envelope: {
            eventName: 'orders.failed',
            payload: { orderId: 'o9' },
            metadata: { id: 'im-1', producer: 'worker', timestamp: 0 },
        },
        error: 'handler threw',
        attempts: 3,
        deadLetteredAt: '2026-05-15T01:00:00.000Z',
        ...overrides,
    };
}

function makeDurable(overrides: Record<string, unknown> = {}): RoutesDeps['durable'] {
    return {
        isConnected: () => true,
        healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
        getAllMetrics: () => new Map(),
        getDLQ: () => [],
        publish: vi.fn(async () => { }),
        ...overrides,
    } as unknown as RoutesDeps['durable'];
}

function createApp(overrides: Partial<RoutesDeps> = {}) {
    const defaultDlqStore: RoutesDeps['dlqStore'] = {
        list: vi.fn(async () => []),
        remove: vi.fn(async () => true),
        findById: vi.fn(async () => null),
        put: vi.fn(async () => makeEntry()),
        clear: vi.fn(async () => 0),
    };

    const defaultDurable: RoutesDeps['durable'] = {
        isConnected: () => true,
        healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
        getAllMetrics: () => new Map(),
        getDLQ: () => [],
        publish: vi.fn(async () => {}),
    } as unknown as RoutesDeps['durable'];

    // Replay re-validates against the registry, so the event must be declared.
    const registry = new Registry();
    registry.declare({ name: 'orders.failed', transport: 'durable', producer: 'order-service' });

    const deps: RoutesDeps = {
        registry,
        metrics: new MetricsCollector(60),
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getHistory: async () => [],
        } as unknown as RoutesDeps['signal'],
        durable: defaultDurable,
        dlqStore: defaultDlqStore,
        startedAt: Date.now(),
        ...overrides,
    };

    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));
    return { app, deps };
}

// ─── GET /api/transports/durable/dlq ─────────────────────────────────────────

describe('GET /api/transports/durable/dlq', () => {
    it('returns 200 with messages array from dlqStore.list()', async () => {
        const entry = makeEntry();
        const dlqStore = {
            list: vi.fn(async () => [entry]),
            remove: vi.fn(),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(1);
        expect(res.body.total).toBe(1);
        expect(res.body.messages[0].eventName).toBe('orders.failed');
        expect(res.body.source).toBe('store');
    });

    // ─── Response normalization (the dual-shape fix) ─────────────────────────
    //
    // The route used to hand back whatever the answering source held:
    // DynamoDB rows normally, `DeadLetteredMessage` objects
    // (`messageId`/`envelope`) during a DynamoDB outage. Same 200, two
    // shapes, switching exactly when someone is reading the DLQ.

    it('strips the DynamoDB storage keys pk/sk/ttl from the wire entry', async () => {
        const dlqStore = {
            list: vi.fn(async () => [makeEntry()]),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq');
        const [message] = res.body.messages;
        expect(message).not.toHaveProperty('pk');
        expect(message).not.toHaveProperty('sk');
        expect(message).not.toHaveProperty('ttl');
    });

    it('renders the DynamoDB ttl as an ISO-8601 expiresAt', async () => {
        const dlqStore = {
            list: vi.fn(async () => [makeEntry({ ttl: 1_700_000_000 })]),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.body.messages[0].expiresAt).toBe('2023-11-14T22:13:20.000Z');
    });

    it('serves the same keys from the store and the in-memory mirror', async () => {
        const storeApp = createApp({
            dlqStore: {
                list: vi.fn(async () => [makeEntry()]),
                remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
            } as unknown as RoutesDeps['dlqStore'],
        }).app;

        const memoryApp = createApp({
            dlqStore: {
                list: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
                remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
            } as unknown as RoutesDeps['dlqStore'],
            durable: makeDurable({ getDLQ: () => [makeDeadLettered()] }),
        }).app;

        const fromStore = await request(storeApp).get('/api/transports/durable/dlq');
        const fromMemory = await request(memoryApp).get('/api/transports/durable/dlq');

        // `expiresAt` is the one optional field: DynamoDB rows carry a TTL,
        // the in-process mirror has no expiry concept.
        const keys = (body: { messages: Array<Record<string, unknown>> }) =>
            Object.keys(body.messages[0]!).filter(k => k !== 'expiresAt').sort();
        expect(keys(fromMemory.body)).toEqual(keys(fromStore.body));
    });

    it('passes eventName query param to dlqStore.list()', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        await request(app).get('/api/transports/durable/dlq?eventName=orders.failed');
        expect(listFn).toHaveBeenCalledWith({ eventName: 'orders.failed', limit: undefined });
    });

    it('passes limit query param to dlqStore.list()', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        await request(app).get('/api/transports/durable/dlq?limit=10');
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: 10 });
    });

    it('normalizes in-memory DeadLetteredMessage entries into the wire shape', async () => {
        const dlqStore = {
            list: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({
            dlqStore,
            durable: makeDurable({ getDLQ: () => [makeDeadLettered()] }),
        });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('in-memory');
        expect(res.body.total).toBe(1);
        // messageId → id, envelope.{eventName,payload} lifted out,
        // deadLetteredAt → deadAt. No envelope, no messageId on the wire.
        expect(res.body.messages[0]).toEqual({
            id: 'im-1',
            eventName: 'orders.failed',
            payload: { orderId: 'o9' },
            error: 'handler threw',
            attempts: 3,
            deadAt: '2026-05-15T01:00:00.000Z',
        });
    });

    it('reads a mirror entry defensively when it carries a bare payload and id', async () => {
        const dlqStore = {
            list: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const legacy = { id: 'legacy-1', eventName: 'orders.failed', payload: { a: 1 }, error: 'boom', attempts: 1 };
        const { app } = createApp({
            dlqStore,
            durable: makeDurable({ getDLQ: () => [legacy] }),
        });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.body.messages[0]).toEqual({
            id: 'legacy-1',
            eventName: 'orders.failed',
            payload: { a: 1 },
            error: 'boom',
            attempts: 1,
            deadAt: '',
        });
    });

    it('applies ?eventName= and ?limit= to the in-memory mirror too', async () => {
        const dlqStore = {
            list: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({
            dlqStore,
            durable: makeDurable({
                getDLQ: () => [
                    makeDeadLettered({ messageId: 'a' }),
                    makeDeadLettered({ messageId: 'b' }),
                    makeDeadLettered({
                        messageId: 'c',
                        envelope: { eventName: 'payments.failed', payload: {}, metadata: {} },
                    }),
                ],
            }),
        });

        const filtered = await request(app).get('/api/transports/durable/dlq?eventName=orders.failed');
        expect(filtered.body.messages.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);

        const limited = await request(app).get('/api/transports/durable/dlq?limit=1');
        expect(limited.body.messages.map((m: { id: string }) => m.id)).toEqual(['a']);
        expect(limited.body.total).toBe(1);
    });

    // ─── Error redaction ─────────────────────────────────────────────────────

    it('redacts the raw store error on the degraded path but still flags the source', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const dlqStore = {
            list: vi.fn().mockRejectedValue(new Error('ResourceNotFoundException: table event-catalog-dlq not found')),
            remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore, durable: makeDurable() });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('in-memory');
        expect(res.body.error).not.toContain('ResourceNotFoundException');
        expect(res.body.error).not.toContain('event-catalog-dlq');
        expect(res.body.error).toMatch(/DLQ store unavailable/);
        // The detail an operator needs is still on the server side.
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('DLQ list fell back to the in-memory mirror'),
            expect.stringContaining('ResourceNotFoundException'),
        );
        warn.mockRestore();
    });

    it('returns empty messages array when there are no entries', async () => {
        const { app } = createApp();
        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(0);
        expect(res.body.total).toBe(0);
    });

    // ─── Input validation: reject malformed query strings rather than
    //     silently coercing to phantom-empty results (hub #898).
    it('rejects duplicate ?eventName=A&eventName=B with 400 (array form silently mis-targets the Query)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?eventName=A&eventName=B');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/eventName/);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects non-integer ?limit=abc with 400 (NaN limit silently asks DDB for NaN items)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=abc');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects non-positive ?limit=-5 with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=-5');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects ?limit=0 with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=0');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects ?limit above MAX_DLQ_LIMIT (1001) with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=1001');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('accepts ?limit at the MAX_DLQ_LIMIT boundary (1000)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=1000');
        expect(res.status).toBe(200);
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: 1000 });
    });

    it('treats whitespace-only ?eventName=%20 as no filter rather than partition "%20"', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?eventName=%20%20');
        expect(res.status).toBe(200);
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: undefined });
    });
});

// ─── DELETE /api/transports/durable/dlq/:id ──────────────────────────────────

describe('DELETE /api/transports/durable/dlq/:id', () => {
    it('returns 200 with the removed id when entry exists', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(async () => true),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).delete('/api/transports/durable/dlq/entry-1');
        expect(res.status).toBe(200);
        expect(res.body.removed).toBe('entry-1');
    });

    it('returns 404 when entry does not exist', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(async () => false),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).delete('/api/transports/durable/dlq/ghost-id');
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('ghost-id');
    });
});

// ─── POST /api/transports/durable/dlq/:id/replay ─────────────────────────────

describe('POST /api/transports/durable/dlq/:id/replay', () => {
    it('returns 404 when the entry is not found', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => null),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).post('/api/transports/durable/dlq/no-such-id/replay');
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('no-such-id');
    });

    it('re-publishes the entry and removes it, returning 200', async () => {
        const entry = makeEntry({ id: 'replay-me', eventName: 'orders.failed' });
        const removeFn = vi.fn(async () => true);
        const publishFn = vi.fn(async () => {});

        const dlqStore = {
            list: vi.fn(),
            remove: removeFn,
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [],
            publish: publishFn,
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app).post('/api/transports/durable/dlq/replay-me/replay');
        expect(res.status).toBe(200);
        expect(res.body.replayed).toBe('replay-me');
        expect(res.body.eventName).toBe('orders.failed');
        // Verify the publish call used the entry id as idempotency key
        expect(publishFn).toHaveBeenCalledTimes(1);
        const [queueName, envelope] = publishFn.mock.calls[0]!;
        expect(queueName).toBe('orders-failed');
        expect(envelope.metadata.id).toBe('replay-me');
        // Verify removal happened after successful publish
        expect(removeFn).toHaveBeenCalledWith('replay-me');
    });

    it('returns 500 with a redacted message when durable.publish() throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const entry = makeEntry({ id: 'fail-replay' });
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = makeDurable({
            publish: vi.fn(async () => {
                throw new Error('POST http://message-queue.internal:3004/api/v1/queues failed: queue full');
            }),
        });

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app).post('/api/transports/durable/dlq/fail-replay/replay');
        expect(res.status).toBe(500);
        // The message-queue endpoint is an internal detail; the client
        // gets something it can act on instead.
        expect(res.body.error).not.toContain('message-queue.internal');
        expect(res.body.error).not.toContain('queue full');
        expect(res.body.error).toMatch(/Replay failed/);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('DLQ replay failed for "fail-replay"'),
            expect.stringContaining('message-queue.internal'),
        );
        warn.mockRestore();
    });

    it('redacts the same way on the batch-replay path', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const entry = makeEntry({ id: 'batch-1' });
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = makeDurable({
            publish: vi.fn(async () => { throw new Error('AccessDenied: sqs:SendMessage on arn:aws:sqs:us-east-1:1234'); }),
        });

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app)
            .post('/api/transports/durable/dlq/replay')
            .send({ ids: ['batch-1'] });

        expect(res.status).toBe(200);
        expect(res.body.failed).toHaveLength(1);
        expect(res.body.failed[0].id).toBe('batch-1');
        expect(res.body.failed[0].error).not.toContain('arn:aws:sqs');
        expect(res.body.failed[0].error).toMatch(/Replay failed/);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('DLQ batch replay failed for "batch-1"'),
            expect.stringContaining('arn:aws:sqs'),
        );
        warn.mockRestore();
    });

    // Missing ids are a caller-side fact, not our internals — that one
    // stays verbatim so a client can tell "gone" from "transport broke".
    it('still reports a missing id as "not found" in the batch breakdown', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => null),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app)
            .post('/api/transports/durable/dlq/replay')
            .send({ ids: ['ghost'] });

        expect(res.body.failed).toEqual([{ id: 'ghost', error: 'not found' }]);
    });

    it('does not call dlqStore.remove() when publish fails', async () => {
        const entry = makeEntry({ id: 'keep-me' });
        const removeFn = vi.fn();
        const dlqStore = {
            list: vi.fn(),
            remove: removeFn,
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [],
            publish: vi.fn(async () => { throw new Error('network error'); }),
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        await request(app).post('/api/transports/durable/dlq/keep-me/replay');
        expect(removeFn).not.toHaveBeenCalled();
    });
});
