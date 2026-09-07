// tests/asyncapi.test.ts
//
// wave24-c — verify the AsyncAPI 3.0 generator emits a well-shaped
// spec from the registry. Light shape checks (asyncapi version,
// channels/operations/messages/schemas presence + cross-refs) — not
// a full asyncapi-cli lint pass.

import { describe, it, expect } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { allDeclarations } from '../src/declarations/index.js';

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
    const app = expressLikeApp();
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

// ---------------------------------------------------------------------------
// The SHIPPED artifact: contracts/asyncapi.yaml.
//
// Distinct from `buildAsyncApiSpec` above, which is the LIVE, whole-registry
// AsyncAPI 3.0 the server renders at `GET /api/asyncapi` from whatever is
// registered at that moment. `contracts/asyncapi.yaml` is AsyncAPI 2.6,
// generated offline by `npm run generate-asyncapi` and committed, and it is
// deliberately scoped to ONE protocol: the gateway's multiplexed WebSocket.
//
// A published spec that omits or misdescribes a frame is worse than no spec,
// so the checks below are about FIDELITY WITHIN THAT SCOPE — every in-scope
// declaration is present, its payload is the declaration's own schema
// (annotations included), and nothing is referenced that is not defined.
// ---------------------------------------------------------------------------

describe('contracts/asyncapi.yaml — the committed artifact', () => {
  const specPath = join(__dirname, '..', 'contracts', 'asyncapi.yaml');
  const doc = parseYaml(readFileSync(specPath, 'utf8')) as any;

  const outbound = allDeclarations.filter((d) => d.name.startsWith('client.'));
  const inbound = allDeclarations.filter((d) => d.name.startsWith('ws.'));
  const inScope = [...outbound, ...inbound];
  const key = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');

  it('is committed in sync with the declarations — regenerate if this fails', () => {
    const missing = inScope.filter((d) => !(key(d.name) in doc.components.messages)).map((d) => d.name);
    expect(missing, `declared but absent from the shipped spec: ${missing.join(', ')}`).toEqual([]);
    // +1 for the inline SessionBootstrap, which has no declaration.
    expect(Object.keys(doc.components.messages)).toHaveLength(inScope.length + 1);
  });

  it('every message is reachable from the channel — no orphan components', () => {
    const refs = new Set<string>(
      [...doc.channels['/'].publish.message.oneOf, ...doc.channels['/'].subscribe.message.oneOf]
        .map((r: { $ref: string }) => r.$ref.split('/').pop()!),
    );
    const defined = new Set(Object.keys(doc.components.messages));
    expect([...defined].filter((k) => !refs.has(k)), 'defined but never referenced').toEqual([]);
    expect([...refs].filter((k) => !defined.has(k)), 'referenced but never defined').toEqual([]);
  });

  it('routes each frame to the operation the adopter reads it from', () => {
    const pub = new Set(doc.channels['/'].publish.message.oneOf.map((r: any) => r.$ref.split('/').pop()));
    const sub = new Set(doc.channels['/'].subscribe.message.oneOf.map((r: any) => r.$ref.split('/').pop()));
    // publish = what the CLIENT sends; subscribe = what it receives.
    for (const d of outbound) expect(pub.has(key(d.name)), `${d.name} should be publish`).toBe(true);
    for (const d of inbound) expect(sub.has(key(d.name)), `${d.name} should be subscribe`).toBe(true);
    expect(pub.size).toBe(outbound.length);
    expect(sub.size).toBe(inbound.length + 1);
  });

  it('drops in each declaration\'s schema verbatim, annotations and all', () => {
    for (const d of inScope) {
      expect(doc.components.messages[key(d.name)].payload, d.name).toEqual(d.schema);
    }
    // The `format` annotations stamped by field-glossary must survive
    // generation — they are the half of the contract a non-JS adopter has no
    // other way to learn.
    const formats = JSON.stringify(doc.components.messages).match(/"format":"[a-z-]+"/g) ?? [];
    expect(formats.length).toBeGreaterThan(80);
  });

  it('carries the declaration\'s description as the message summary', () => {
    const undocumented = inScope
      .filter((d) => d.description && doc.components.messages[key(d.name)].summary !== d.description)
      .map((d) => d.name);
    expect(undocumented, `summary drifted from the declaration description: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('has no deprecation to mark — and will fail loudly the day it does', () => {
    // The 2.6 generator drops `aliases` entirely. That is harmless only while
    // no in-scope frame HAS one: today all 25 deprecated aliases in the
    // registry are `pipeline*`, which this spec does not cover. If a
    // `client.*` / `ws.*` frame ever gains a deprecated alias, the shipped
    // spec would silently omit it — so fail here and teach the generator
    // to emit `deprecated: true` instead of relaxing this.
    const withAliases = inScope.filter((d) => (d.aliases ?? []).length > 0).map((d) => d.name);
    expect(withAliases, `generator cannot express these aliases: ${withAliases.join(', ')}`).toEqual([]);
  });

  it('describes the welcome frame twice — a transitional duplicate, recorded on purpose', () => {
    // `scripts/generate-asyncapi.ts` hand-inlines the welcome frame as
    // `SessionBootstrap`, with a comment saying it does so because the frame
    // "has no event-catalog declaration". As of 2026-09-07 it does:
    // ws.session.connected. Until the generator (owned elsewhere) drops its
    // inline copy, the published spec carries both — same wire frame, two
    // message names, and the hand-written copy is the looser of the two.
    // Asserted rather than left to drift, so the day the generator is fixed
    // this test fails and gets deleted.
    const inline = doc.components.messages.SessionBootstrap;
    const declared = doc.components.messages['ws_session_connected'];
    expect(inline, 'generator no longer inlines SessionBootstrap — delete this test').toBeDefined();
    expect(declared).toBeDefined();
    expect(inline.payload.properties.type.const).toBe('session');
    expect(declared.payload.properties.type.const).toBe('session');
    // The declaration is the stricter of the two, which is why it should win.
    expect(declared.payload.required.length).toBeGreaterThan(inline.payload.required.length);
  });

  it('scopes itself honestly — the rest of the registry is NOT in this file', () => {
    // Not a defect: contracts/asyncapi.yaml describes the gateway WS
    // protocol, not the platform's whole event surface. The live
    // `GET /api/asyncapi` covers everything. This asserts the two facts stay
    // true together, so nobody reads the file as a full inventory.
    const outOfScope = allDeclarations.filter((d) => !inScope.includes(d));
    expect(outOfScope.length).toBeGreaterThan(0);
    for (const d of outOfScope) {
      expect(key(d.name) in doc.components.messages, `${d.name} leaked into the WS spec`).toBe(false);
    }
  });
});
