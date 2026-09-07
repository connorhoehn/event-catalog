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
import {
  buildGatewayWsDoc,
  buildRegistryDoc,
  isGatewayFrame,
} from '../scripts/generate-asyncapi.js';

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

  it('anchors each channel to the server its address is valid on', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    expect(Object.keys(spec.servers).sort()).toEqual(['durableMessageQueue', 'signalRedis']);
    for (const channel of Object.values(spec.channels) as any[]) {
      const expected = channel['x-event-catalog-transport'] === 'signal'
        ? 'signalRedis'
        : 'durableMessageQueue';
      expect(channel.servers).toEqual([{ $ref: `#/servers/${expected}` }]);
    }
  });

  it('ships only the servers some channel sits on', () => {
    // A signal-only registry must not advertise a message-queue server it
    // never addresses — an unreferenced server is an orphan.
    const reg = new Registry();
    reg.declare({ name: 'only.signal', schema: { type: 'object' }, transport: 'signal', producer: 's' });
    const spec = buildAsyncApiSpec(reg) as any;
    expect(Object.keys(spec.servers)).toEqual(['signalRedis']);
  });

  it('durable address is the queue the publish path actually uses', () => {
    const reg = new Registry();
    // No `queue` declared — EventCatalog.publish derives it as
    // DurableTransport.eventNameToQueueName(name), NOT the raw event name.
    reg.declare({ name: 'activity.recorded', schema: { type: 'object' }, transport: 'durable', producer: 'gw' });
    reg.declare({ name: 'pipeline:run:started', schema: { type: 'object' }, transport: 'durable', producer: 'p' });
    const addresses = (Object.values((buildAsyncApiSpec(reg) as any).channels) as any[])
      .map((c) => c.address)
      .sort();
    expect(addresses).toEqual(['activity-recorded', 'pipeline-run-started']);
  });

  it('claims the (empty) redis binding for signal and no binding at all for durable', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry()) as any;
    for (const channel of Object.values(spec.channels) as any[]) {
      if (channel['x-event-catalog-transport'] === 'signal') {
        expect(Object.keys(channel.bindings)).toEqual(['redis']);
      } else {
        // AsyncAPI has no binding for this platform's message-queue; the old
        // `bindings.mq` key was a protocol no tool recognizes.
        expect(channel.bindings).toBeUndefined();
      }
    }
  });

  it('excludeNamespaces drops whole namespaces (how the two artifacts are split)', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry(), { excludeNamespaces: ['ws'] }) as any;
    const names = Object.values(spec.components.messages).map((m: any) => m.name);
    expect(names).not.toContain('ws.chat.message');
    expect(names).toContain('orders.placed');
  });

  it('carries deprecated aliases as x-aliases — a name still on the wire', () => {
    const reg = new Registry();
    reg.declare({
      name: 'pipeline.approval.requested',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'p',
      aliases: [{ name: 'pipeline:approval:requested', deprecated: true }],
    });
    const msg = Object.values((buildAsyncApiSpec(reg) as any).components.messages)[0] as any;
    expect(msg['x-aliases']).toEqual([{ name: 'pipeline:approval:requested', deprecated: true }]);
  });

  it('stamps info extensions and externalDocs when asked', () => {
    const spec = buildAsyncApiSpec(fixtureRegistry(), {
      infoExtensions: { 'x-event-catalog-coverage': { describedInThisDocument: 3 } },
      externalDocs: { url: './asyncapi.yaml' },
    }) as any;
    expect(spec.info['x-event-catalog-coverage'].describedInThisDocument).toBe(3);
    expect(spec.externalDocs.url).toBe('./asyncapi.yaml');
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
// The SHIPPED artifacts.
//
// `buildAsyncApiSpec` above is the BUILDER — the server renders it live at
// `GET /api/asyncapi` from whatever is registered at that moment. The two
// files in `contracts/` are what a consumer outside this repo actually reads,
// generated offline by `npm run generate-asyncapi` and committed:
//
//   contracts/asyncapi.yaml           AsyncAPI 2.6 — the gateway's multiplexed
//                                     WebSocket: 110 client.* / ws.* frames.
//   contracts/asyncapi.registry.yaml  AsyncAPI 3.0 — the 119 broker-addressed
//                                     backbone events, from the SAME builder.
//
// A published spec that omits or misdescribes an event is worse than no spec,
// so these checks are about FIDELITY: every declaration is present in exactly
// one of the two documents, its payload is the declaration's own schema
// (annotations included), and regenerating changes nothing.
//
// Structural validity (ref resolution, orphans, required fields) lives in
// tests/asyncapi-structure.test.ts.
// ---------------------------------------------------------------------------

describe('contracts/asyncapi.yaml — the committed WebSocket artifact', () => {
  const specPath = join(__dirname, '..', 'contracts', 'asyncapi.yaml');
  const doc = parseYaml(readFileSync(specPath, 'utf8')) as any;

  const outbound = allDeclarations.filter((d) => d.name.startsWith('client.'));
  const inbound = allDeclarations.filter((d) => d.name.startsWith('ws.'));
  const inScope = [...outbound, ...inbound];
  const key = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_');

  it('is byte-for-byte what the generator produces today', () => {
    // The strongest form of "committed in sync": re-render and deep-compare,
    // rather than spot-checking a few properties. Fails on ANY drift —
    // a changed schema, description, tag, or ordering.
    expect(doc).toEqual(buildGatewayWsDoc());
  });

  it('is committed in sync with the declarations — regenerate if this fails', () => {
    const missing = inScope.filter((d) => !(key(d.name) in doc.components.messages)).map((d) => d.name);
    expect(missing, `declared but absent from the shipped spec: ${missing.join(', ')}`).toEqual([]);
    expect(Object.keys(doc.components.messages)).toHaveLength(inScope.length);
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
    expect(sub.size).toBe(inbound.length);
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

  it('emits deprecated aliases as x-aliases rather than dropping them', () => {
    // 2.6 has no native slot for "this frame also arrives under an older
    // name", so the generator emits an extension. No gateway frame has an
    // alias today (all 25 in the registry are pipeline events, which live in
    // the companion document), so assert the CAPABILITY on the builder and
    // the absence in the artifact — the old test asserted only the absence,
    // which would have silently dropped the first one to appear.
    for (const d of inScope) {
      const emitted = doc.components.messages[key(d.name)]['x-aliases'];
      if ((d.aliases ?? []).length > 0) expect(emitted, d.name).toEqual(d.aliases);
      else expect(emitted, d.name).toBeUndefined();
    }
  });

  it('describes the welcome frame exactly once, from its declaration', () => {
    // The generator used to hand-inline this frame as `SessionBootstrap`
    // because it "has no event-catalog declaration". It has had one since
    // 2026-09-07 — ws.session.connected — and the declared copy is strictly
    // richer (6 required fields vs 3, plus `timestamp`). The inline copy is
    // gone; this asserts it stays gone and that the survivor is the declared
    // one, not a re-inlined hand-written schema.
    expect(doc.components.messages.SessionBootstrap).toBeUndefined();
    const declared = doc.components.messages['ws_session_connected'];
    expect(declared).toBeDefined();
    expect(declared.payload.properties.type.const).toBe('session');
    expect(declared.payload.required).toEqual(
      ['type', 'status', 'clientId', 'sessionToken', 'restored', 'nodeId', 'enabledServices'],
    );
    const welcomeFrames = Object.values<any>(doc.components.messages)
      .filter((m) => m.payload?.properties?.type?.const === 'session')
      .map((m) => m.name);
    expect(welcomeFrames, 'the welcome frame is described more than once').toEqual(
      ['ws.session.connected'],
    );
  });

  it('states its own scope in the artifact, not only in the README', () => {
    const cov = doc.info['x-event-catalog-coverage'];
    expect(cov.registryDeclarations).toBe(allDeclarations.length);
    expect(cov.describedInThisDocument).toBe(inScope.length);
    expect(cov.describedInCompanionDocument.file).toBe('contracts/asyncapi.registry.yaml');
    expect(doc.info.description).toContain('contracts/asyncapi.registry.yaml');
    expect(doc.externalDocs.url).toBe('./asyncapi.registry.yaml');
  });

  it('keeps the backbone events out — they are described elsewhere, not nowhere', () => {
    const outOfScope = allDeclarations.filter((d) => !inScope.includes(d));
    expect(outOfScope.length).toBeGreaterThan(0);
    for (const d of outOfScope) {
      expect(key(d.name) in doc.components.messages, `${d.name} leaked into the WS spec`).toBe(false);
    }
  });
});

describe('contracts/asyncapi.registry.yaml — the committed backbone artifact', () => {
  const specPath = join(__dirname, '..', 'contracts', 'asyncapi.registry.yaml');
  const doc = parseYaml(readFileSync(specPath, 'utf8')) as any;
  const backbone = allDeclarations.filter((d) => !isGatewayFrame(d));

  it('is byte-for-byte what the generator produces today', () => {
    expect(doc).toEqual(buildRegistryDoc());
  });

  it('describes every backbone declaration exactly once', () => {
    const names = Object.values<any>(doc.components.messages).map((m) => m.name);
    expect(new Set(names).size).toBe(backbone.length);
    for (const d of backbone) {
      expect(names).toContain(d.name);
    }
  });

  it('drops in each declaration\'s schema verbatim, annotations and all', () => {
    const schemaKey = (name: string) => `${name.replace(/[^A-Za-z0-9_]/g, '_')}__schema`;
    for (const d of backbone) {
      expect(doc.components.schemas[schemaKey(d.name)], d.name).toEqual(d.schema);
    }
    const formats = JSON.stringify(doc.components.schemas).match(/"format":"[a-z-]+"/g) ?? [];
    expect(formats.length).toBeGreaterThan(20);
  });

  it('gives a `transport: both` event one channel per transport', () => {
    const both = backbone.filter((d) => d.transport === 'both');
    expect(both.length).toBeGreaterThan(0);
    for (const d of both) {
      const id = d.name.replace(/[^A-Za-z0-9_]/g, '_');
      expect(doc.channels[`signal__${id}`], `${d.name} signal channel`).toBeDefined();
      expect(doc.channels[`durable__${id}`], `${d.name} durable channel`).toBeDefined();
    }
  });

  it('addresses durable channels by the queue the publish path uses', () => {
    for (const d of backbone.filter((x) => x.transport === 'durable' || x.transport === 'both')) {
      const channel = doc.channels[`durable__${d.name.replace(/[^A-Za-z0-9_]/g, '_')}`];
      const expected = d.queue ?? d.name.replace(/[:.]/g, '-').replace(/--+/g, '-');
      expect(channel.address, d.name).toBe(expected);
    }
  });

  it('carries the 25 deprecated aliases the registry declares', () => {
    const withAliases = backbone.filter((d) => (d.aliases ?? []).length > 0);
    expect(withAliases.length).toBeGreaterThan(0);
    for (const d of withAliases) {
      const msg = Object.values<any>(doc.components.messages).find((m) => m.name === d.name);
      expect(msg['x-aliases'], d.name).toEqual(d.aliases);
    }
  });

  it('states its own scope in the artifact, not only in the README', () => {
    const cov = doc.info['x-event-catalog-coverage'];
    expect(cov.registryDeclarations).toBe(allDeclarations.length);
    expect(cov.describedInThisDocument).toBe(backbone.length);
    expect(cov.describedInCompanionDocument.file).toBe('contracts/asyncapi.yaml');
    expect(doc.externalDocs.url).toBe('./asyncapi.yaml');
  });
});
