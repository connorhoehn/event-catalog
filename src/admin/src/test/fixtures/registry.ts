// Production-scale fixture, DERIVED from the real registry.
//
// Every admin bug found so far was invisible at the six-event scale the
// component tests used and obvious at the 216 the platform actually runs:
// a namespace <select> that erased its own options, a canvas that laid out
// at 0px, a ticker that re-appended its history every second. So the fixture
// is not a hand-written handful — it is built at import time from
// `src/declarations`, the same array `scripts/regen-registry-snapshot.ts`
// ships as `contracts/registry.snapshot.json`.
//
// Derived, not copied: adding a declaration to `src/declarations` changes
// what these tests render on the next run. A checked-in JSON blob would go
// stale silently, which is worse than having no fixture at all — it would
// keep asserting that the UI copes with a catalog that no longer exists.
//
// Namespace resolution comes from the registry's own `resolveNamespace`, so
// the fixture's namespace distribution is exactly the server's (today:
// ws 76, pipeline 48, client 31, ag-ui 29, sfu 20, orgiq 6, transcription 3,
// call 2, activity 1 — deliberately lopsided, which is the point).

import { allDeclarations } from '../../../../declarations/index.js';
import { allBundles } from '../../../../declarations/bundles/index.js';
import { resolveNamespace } from '../../../../registry/namespace.js';
import type { EventEntry, EventStats, FeatureBundleEntry, TopologyGraph } from '../../api';

/**
 * Deterministic 32-bit hash. Stats, subscriber counts and rate history are
 * all keyed off this rather than Math.random, so a failing assertion is
 * reproducible and a snapshot of "what the UI drew" is stable across runs.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pseudo-random integer in [0, n) derived from a name + salt. */
function pick(name: string, salt: string, n: number): number {
  return hash(`${name}#${salt}`) % n;
}

function producerList(p: string | string[]): string[] {
  return Array.isArray(p) ? p : [p];
}

/**
 * Consumers are not declared in this repo — real ones POST themselves in via
 * `syncToRemoteRegistry` at boot — so they are synthesised. The pool and the
 * assignment are deterministic, and roughly 45% of events end up with at
 * least one subscriber, which is what the production registry looks like:
 * a long tail of orphan signal frames plus a well-consumed durable core.
 */
const CONSUMER_POOL = [
  'platform-api',
  'websocket-gateway',
  'pipeline-worker',
  'analytics-sink',
  'audit-service',
  'notification-service',
  'search-indexer',
  'billing-service',
];

function subscribersFor(name: string): string[] {
  const roll = pick(name, 'subs', 100);
  if (roll < 55) return [];
  const count = roll < 80 ? 1 : roll < 94 ? 2 : 3;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const svc = CONSUMER_POOL[pick(name, `sub${i}`, CONSUMER_POOL.length)]!;
    if (!out.includes(svc)) out.push(svc);
  }
  return out;
}

/**
 * The API's EventEntry narrows transport to signal|durable, but four real
 * declarations are `both`. The registry stores what was declared, so the
 * fixture does too — the cast is the honest representation of a widening the
 * admin's own type has not done yet, and it is exactly the kind of value the
 * transport <select> and the EventNode accent have to survive.
 */
type DeclaredTransport = EventEntry['transport'];

const BASE_TIME = Date.parse('2026-09-07T12:00:00.000Z');

function statsFor(name: string, subscriberCount: number): EventStats | null {
  // A fifth of the catalog has never fired — the "—" / "never" cells the
  // EventList renders for them are a real state, not an edge case.
  if (pick(name, 'cold', 5) === 0) return null;
  const publishCount = pick(name, 'count', 250_000);
  return {
    publishCount,
    publishRate: pick(name, 'rate', 40_000) / 100,
    lastPublishedAt: new Date(BASE_TIME - pick(name, 'age', 86_400) * 1000).toISOString(),
    errorCount: pick(name, 'err', 12) === 0 ? pick(name, 'errn', 40) : 0,
    subscriberCount,
  };
}

/** Every declaration, shaped the way `GET /api/events` returns it. */
export const realEvents: EventEntry[] = allDeclarations.map((d) => {
  const namespace = resolveNamespace(d.name, d.namespace);
  const subscribers = subscribersFor(d.name);
  return {
    name: d.name,
    namespace,
    transport: d.transport as DeclaredTransport,
    producer: d.producer,
    description: d.description,
    tags: d.tags ? [...d.tags] : undefined,
    schema: (d.schema ?? {}) as Record<string, unknown>,
    schemaFingerprint: hash(d.name).toString(16).padStart(8, '0').repeat(8).slice(0, 64),
    version: 1 + pick(d.name, 'ver', 4),
    subscribers,
    metadata: {
      createdAt: new Date(BASE_TIME - 90 * 86_400_000).toISOString(),
      lastPublishedAt: null,
      publishCount: 0,
      errorCount: 0,
    },
    stats: statsFor(d.name, subscribers.length),
  } satisfies EventEntry;
});

export const REAL_EVENT_COUNT = realEvents.length;

/** The `GET /api/events` envelope. */
export const realEventsResponse = { events: realEvents, total: realEvents.length };

/** Every namespace present, sorted — what the topology <select> should show. */
export const realNamespaces: string[] = [
  ...new Set(realEvents.map((e) => e.namespace!)),
].sort();

/**
 * `GET /api/topology`, built the way `Registry.getTopology()` builds it:
 * one node per event, one per distinct service, a `publishes` edge per
 * producer and a `subscribes` edge per subscriber.
 */
export function buildRealTopology(namespace?: string): TopologyGraph {
  const nodes: TopologyGraph['nodes'] = [];
  const edges: TopologyGraph['edges'] = [];
  const seen = new Set<string>();

  for (const e of realEvents) {
    if (namespace && e.namespace !== namespace) continue;
    nodes.push({
      id: e.name,
      type: 'event',
      metadata: { transport: e.transport, description: e.description, namespace: e.namespace },
    });
    for (const p of producerList(e.producer)) {
      if (!seen.has(p)) {
        seen.add(p);
        nodes.push({ id: p, type: 'service', metadata: {} });
      }
      edges.push({ from: p, to: e.name, relation: 'publishes' });
    }
    for (const s of e.subscribers) {
      if (!seen.has(s)) {
        seen.add(s);
        nodes.push({ id: s, type: 'service', metadata: {} });
      }
      edges.push({ from: e.name, to: s, relation: 'subscribes' });
    }
  }
  return { nodes, edges };
}

export const realTopology = buildRealTopology();

/** `GET /api/namespaces/summary?detail=full`. */
export function buildRealNamespaceSummary() {
  const byNs = new Map<
    string,
    {
      namespace: string;
      eventCount: number;
      deprecatedCount: number;
      producerCount: number;
      subscriberCount: number;
      signalCount: number;
      durableCount: number;
      events: Array<{ name: string; transport: string; version: number; deprecated: boolean }>;
      producers: Set<string>;
      subscribers: Set<string>;
    }
  >();

  for (const e of realEvents) {
    const ns = e.namespace!;
    let row = byNs.get(ns);
    if (!row) {
      row = {
        namespace: ns,
        eventCount: 0,
        deprecatedCount: 0,
        producerCount: 0,
        subscriberCount: 0,
        signalCount: 0,
        durableCount: 0,
        events: [],
        producers: new Set(),
        subscribers: new Set(),
      };
      byNs.set(ns, row);
    }
    row.eventCount += 1;
    if (e.transport === 'durable') row.durableCount += 1;
    else row.signalCount += 1;
    for (const p of producerList(e.producer)) row.producers.add(p);
    for (const s of e.subscribers) row.subscribers.add(s);
    row.events.push({
      name: e.name,
      transport: e.transport,
      version: e.version ?? 1,
      deprecated: false,
    });
  }

  const items = [...byNs.values()]
    .map(({ producers, subscribers, ...row }) => ({
      ...row,
      producerCount: producers.size,
      subscriberCount: subscribers.size,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);

  return { count: items.length, items };
}

export const realNamespaceSummary = buildRealNamespaceSummary();

/**
 * `GET /api/metrics/history` — 60 samples per event, for the sparkline
 * column. This is the payload that makes the EventList row work O(samples)
 * instead of O(1), so it has to be present at full size.
 */
export const realMetricsHistory: Record<string, number[]> = Object.fromEntries(
  realEvents.map((e) => [
    e.name,
    Array.from({ length: 60 }, (_, i) => pick(e.name, `h${i}`, 500) / 10),
  ]),
);

/** A tap frame for `name`, shaped the way `GET /api/flow` emits them. */
export function tapFrameFor(name: string, at = new Date().toISOString()) {
  const e = realEvents.find((x) => x.name === name) ?? realEvents[0]!;
  return {
    eventName: e.name,
    namespace: e.namespace!,
    producer: producerList(e.producer)[0]!,
    transport: e.transport === 'durable' ? ('durable' as const) : ('signal' as const),
    timestamp: at,
  };
}

/** N tap frames cycling through the catalog — a synthetic firehose. */
export function tapBurst(n: number, startAt = BASE_TIME): ReturnType<typeof tapFrameFor>[] {
  const out: ReturnType<typeof tapFrameFor>[] = [];
  for (let i = 0; i < n; i++) {
    const e = realEvents[i % realEvents.length]!;
    out.push(tapFrameFor(e.name, new Date(startAt + i).toISOString()));
  }
  return out;
}

/**
 * Every declared FeatureBundle, shaped the way `GET /api/feature-bundles`
 * returns it — derived from `src/declarations/bundles` for the same reason
 * the events are: the interesting property of this data is its LOPSIDEDNESS
 * (18 bundles covering 142 of 226 events, one of them deprecated with a
 * replacement), and a hand-written handful would assert nothing about the
 * catalog that actually ships.
 *
 * The fingerprints are the real ones: each declaration stamps itself with
 * `computeFingerprint`, so FingerprintChip renders genuine 64-char sha256s.
 */
export const realBundles: FeatureBundleEntry[] = allBundles.map((b) => ({
  name: b.name,
  version: b.version,
  fingerprint: b.fingerprint,
  transport: b.transport,
  events: b.events.map((e) => ({ ...e })),
  ...(b.description !== undefined ? { description: b.description } : {}),
  ...(b.deprecated !== undefined ? { deprecated: { ...b.deprecated } } : {}),
}));

export const REAL_BUNDLE_COUNT = realBundles.length;

/** The `GET /api/feature-bundles` envelope. */
export const realBundlesResponse = { bundles: realBundles, total: realBundles.length };

/** Distinct event names claimed by at least one bundle. */
export const realBundleMemberNames: string[] = [
  ...new Set(realBundles.flatMap((b) => b.events.map((e) => e.name))),
].sort();

/** The route table every view needs to render the full catalog. */
export const realRoutes = {
  '/api/events': { body: realEventsResponse },
  '/api/metrics/history': { body: realMetricsHistory },
  '/api/topology': { body: realTopology },
  '/api/namespaces/summary': { body: realNamespaceSummary },
  '/api/feature-bundles': { body: realBundlesResponse },
};
