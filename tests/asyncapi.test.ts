// tests/asyncapi.test.ts
//
// wave24-c — verify the AsyncAPI 3.0 generator emits a well-shaped
// spec from the registry. Light shape checks (asyncapi version,
// channels/operations/messages/schemas presence + cross-refs) — not
// a full asyncapi-cli lint pass.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { buildAsyncApiSpec } from '../src/server/asyncapi.js';

function fixtureRegistry() {
  const reg = new Registry();
  reg.declare({
    name: 'orders.placed',
    namespace: 'orders',
    schema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    transport: 'durable',
    producer: 'orders-svc',
    description: 'A new order was placed by a customer.',
    tags: ['orders', 'lifecycle'],
    queue: 'orders-events',
  });
  reg.declare({
    name: 'pipeline.run.completed',
    namespace: 'pipeline',
    schema: { type: 'object' },
    transport: 'both',
    producer: ['distributed-core', 'platform-api'],
  });
  reg.declare({
    name: 'ws.chat.message',
    namespace: 'ws',
    schema: { type: 'object', properties: { Type: { type: 'string' } } },
    transport: 'signal',
    producer: 'websocket-gateway',
    channel: 'chat-bus',
  });
  return reg;
}

describe('buildAsyncApiSpec (wave24-c)', () => {
  it('emits AsyncAPI 3.0 with info + channels + operations + components', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry(), { title: 'test', version: '9.9.9' }) as any;
    expect(spec.asyncapi).toBe('3.0.0');
    expect(spec.info.title).toBe('test');
    expect(spec.info.version).toBe('9.9.9');
    expect(spec.channels).toBeTypeOf('object');
    expect(spec.operations).toBeTypeOf('object');
    expect(spec.components.messages).toBeTypeOf('object');
    expect(spec.components.schemas).toBeTypeOf('object');
  });

  it('creates one channel per (transport, eventName) — `both` produces two', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    const channelKeys = Object.keys(spec.channels);
    // 3 events: 1 durable-only + 1 both (2 channels) + 1 signal-only = 4
    expect(channelKeys).toHaveLength(4);
    expect(channelKeys.some((k) => k.includes('signal__pipeline_run_completed'))).toBe(true);
    expect(channelKeys.some((k) => k.includes('durable__pipeline_run_completed'))).toBe(true);
  });

  it('emits one operation per (producer, transport) — multi-producer events get multiple', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    const opKeys = Object.keys(spec.operations);
    // pipeline.run.completed has 2 producers × 2 transports = 4 operations.
    // orders.placed: 1 producer × 1 transport = 1.
    // ws.chat.message: 1 producer × 1 transport = 1.
    // Total: 6.
    expect(opKeys).toHaveLength(6);
    const pipelineOps = opKeys.filter((k) => k.includes('pipeline_run_completed'));
    expect(pipelineOps).toHaveLength(4);
  });

  it('all messages reference a schema in components.schemas', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    for (const msg of Object.values(spec.components.messages) as any[]) {
      expect(msg.payload.$ref).toMatch(/^#\/components\/schemas\//);
      const schemaKey = msg.payload.$ref.split('/').pop()!;
      expect(spec.components.schemas[schemaKey]).toBeDefined();
    }
  });

  it('all channels and operations cross-reference correctly', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    for (const op of Object.values(spec.operations) as any[]) {
      const channelRef = op.channel.$ref.split('/').pop()!;
      expect(spec.channels[channelRef]).toBeDefined();
    }
  });

  it('channel address mirrors declared `channel` (signal) or `queue` (durable)', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    const wsChat = Object.values(spec.channels).find((c: any) => c.address === 'chat-bus') as any;
    expect(wsChat).toBeDefined();
    const ordersDurable = Object.values(spec.channels).find((c: any) => c.address === 'orders-events') as any;
    expect(ordersDurable).toBeDefined();
  });

  it('?namespace filter restricts the spec to one namespace', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry(), { namespace: 'orders' }) as any;
    expect(Object.keys(spec.components.messages)).toHaveLength(1);
    expect(Object.keys(spec.channels)).toHaveLength(1);
  });

  it('tags from declarations propagate to messages + operations', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    const ordersMsg = Object.values(spec.components.messages).find((m: any) => m.name === 'orders.placed') as any;
    expect(ordersMsg.tags.map((t: any) => t.name).sort()).toEqual(['lifecycle', 'orders']);
  });

  it('deprecated event message gets a synthetic "deprecated" tag and x-deprecated extension', () => {
    const reg = fixtureRegistry();
    reg.deprecate('orders.placed', { reason: 'Use orders.submitted instead', by: 'migration-team' });

    const spec = buildAsyncApiSpec(reg) as any;
    const ordersMsg = Object.values(spec.components.messages).find((m: any) => m.name === 'orders.placed') as any;

    const tagNames: string[] = ordersMsg.tags.map((t: any) => t.name);
    expect(tagNames).toContain('deprecated');
    // Original tags are preserved alongside the synthetic one
    expect(tagNames).toContain('orders');
    expect(tagNames).toContain('lifecycle');

    expect(ordersMsg['x-deprecated']).toBeDefined();
    expect(ordersMsg['x-deprecated'].reason).toBe('Use orders.submitted instead');
    expect(ordersMsg['x-deprecated'].by).toBe('migration-team');
  });

  it('non-deprecated event does NOT get a synthetic deprecated tag', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    const ordersMsg = Object.values(spec.components.messages).find((m: any) => m.name === 'orders.placed') as any;

    const tagNames: string[] = (ordersMsg.tags ?? []).map((t: any) => t.name);
    expect(tagNames).not.toContain('deprecated');
    expect(ordersMsg['x-deprecated']).toBeUndefined();
  });

  it('deprecated event with no reason uses fallback description in the deprecated tag', () => {
    const reg = new Registry();
    reg.declare({ name: 'gone.event', schema: {}, transport: 'signal', producer: 'svc' });
    reg.deprecate('gone.event'); // no reason or by

    const spec = buildAsyncApiSpec(reg) as any;
    const msg = Object.values(spec.components.messages)[0] as any;
    const deprecatedTag = msg.tags.find((t: any) => t.name === 'deprecated');

    expect(deprecatedTag).toBeDefined();
    expect(deprecatedTag.description).toBe('Deprecated event.');
  });
});

describe('GET /api/asyncapi', () => {
  function makeApp(registry: Registry) {
    const metrics = new MetricsCollector(60);
    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes({
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
    }));
    return app;
  }

  it('returns the spec as JSON', async () => {
    const app = makeApp(fixtureRegistry());
    const res = await request(app).get('/api/asyncapi');
    expect(res.status).toBe(200);
    expect(res.body.asyncapi).toBe('3.0.0');
    expect(Object.keys(res.body.operations).length).toBeGreaterThan(0);
  });

  it('?namespace=X filters', async () => {
    const app = makeApp(fixtureRegistry());
    const res = await request(app).get('/api/asyncapi?namespace=orders');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.components.messages)).toHaveLength(1);
  });
});
