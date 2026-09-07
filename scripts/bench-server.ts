// scripts/bench-server.ts
//
// Server-side benchmark: the endpoints an operator or a Prometheus
// scraper actually hits, against a registry loaded with the real 216
// declarations.
//
//   npx tsx scripts/bench-server.ts
//   npx tsx scripts/bench-server.ts --iters 5000 --json
//
// Companion to `bench-publish.ts`, which covers the *client* hot path.
// Everything here runs in-process: route handlers are dispatched through
// the real `createRoutes()` router with a synthetic req/res pair whose
// `json()` performs the same `JSON.stringify` the production
// `makeRouteResponse` does. Socket writes are excluded on purpose —
// they are kernel time, not something this repo can fix — but every byte
// of serialization, filtering, graph construction and exposition
// rendering is inside the measured region.
//
// What it measures:
//
//   1. GET /api/events        — unfiltered and per filter combination.
//   2. GET /api/topology      — graph construction (O(events × edges)).
//   3. GET /metrics           — the Prometheus render. Called on a fixed
//                               schedule forever, so it is the only
//                               endpoint with a guaranteed production
//                               call rate. Broken out into collectors /
//                               snapshot / format so the cost is
//                               attributable.
//   4. SSE fan-out            — one tap event delivered to 1, 50 and 250
//                               concurrent streams, reported per-event
//                               AND per-stream so super-linear scaling
//                               is visible.
//   5. POST /api/events       — declare, with the recursive compat gate
//                               off and strict, including the single
//                               deepest real declaration.
//
// Latencies are p50/p99 in microseconds, plus ops/sec.

import { EventEmitter } from 'node:events';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import type { HttpRouter, RouteRequest, RouteResponse } from '../src/server/http-router.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import { sseRegistry } from '../src/server/sse.js';
import { tapEmitter, type TapEvent } from '../src/server/tap-emitter.js';
import { allDeclarations } from '../src/declarations/index.js';
import type { EventDeclaration } from '../src/types/index.js';

// ─── args ────────────────────────────────────────────────────────────────

function argValue(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const ITERS = argValue('--iters', 2_000);
const WARMUP = argValue('--warmup', 200);
const AS_JSON = process.argv.includes('--json');

// ─── timing ──────────────────────────────────────────────────────────────

interface Stats {
  label: string;
  n: number;
  p50us: number;
  p99us: number;
  meanUs: number;
  opsPerSec: number;
  /** Optional per-unit cost (e.g. µs per SSE stream) for fan-out rows. */
  perUnitUs?: number;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function summarize(label: string, samplesNs: Float64Array, totalNs: number): Stats {
  const sorted = Float64Array.from(samplesNs).sort();
  const n = sorted.length;
  const p = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] / 1000;
  return {
    label,
    n,
    p50us: round(p(0.5)),
    p99us: round(p(0.99)),
    meanUs: round(totalNs / n / 1000),
    opsPerSec: Math.round(n / (totalNs / 1e9)),
  };
}

function benchSync(label: string, iters: number, fn: (i: number) => void): Stats {
  const samples = new Float64Array(iters);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) {
    const s = process.hrtime.bigint();
    fn(i);
    samples[i] = Number(process.hrtime.bigint() - s);
  }
  const total = Number(process.hrtime.bigint() - t0);
  return summarize(label, samples, total);
}

async function benchAsync(
  label: string,
  iters: number,
  fn: (i: number) => Promise<void>,
): Promise<Stats> {
  const samples = new Float64Array(iters);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) {
    const s = process.hrtime.bigint();
    await fn(i);
    samples[i] = Number(process.hrtime.bigint() - s);
  }
  const total = Number(process.hrtime.bigint() - t0);
  return summarize(label, samples, total);
}

// ─── synthetic req/res ───────────────────────────────────────────────────
//
// `json()` stringifies exactly as `makeRouteResponse` does, so
// serializing the whole registry is inside the measured region. The
// resulting byte count is accumulated into `sink` so V8 cannot elide it.

const sink = { bytes: 0, frames: 0 };

/** Minimal stand-in for the pieces of http.ServerResponse the SSE path uses. */
class FakeRaw extends EventEmitter {
  writableLength = 0;
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}

interface FakeRes extends RouteResponse {
  statusCode: number;
  body: unknown;
}

function makeReq(
  method: string,
  path: string,
  query: Record<string, string | string[]> = {},
  body?: unknown,
  headers: Record<string, string> = {},
): RouteRequest {
  const raw = new FakeRaw();
  return {
    method,
    path,
    params: {},
    query,
    body,
    header: (name: string) => headers[name.toLowerCase()],
    on: (event: string, listener: (...args: unknown[]) => void) => {
      raw.on(event, listener);
    },
    raw: raw as unknown as RouteRequest['raw'],
  };
}

function makeRes(): FakeRes {
  const raw = new FakeRaw();
  let headersSent = false;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res as unknown as RouteResponse;
    },
    json(body: unknown): void {
      res.body = body;
      // Same work production does: the full response is serialized.
      sink.bytes += JSON.stringify(body).length;
      headersSent = true;
    },
    send(body: string): void {
      sink.bytes += body.length;
      headersSent = true;
    },
    setHeader(): void {},
    write(chunk: string): boolean {
      sink.bytes += chunk.length;
      sink.frames += 1;
      headersSent = true;
      return true;
    },
    end(): void {
      headersSent = true;
    },
    flushHeaders(): void {
      headersSent = true;
    },
    get headersSent(): boolean {
      return headersSent;
    },
    raw: raw as unknown as RouteResponse['raw'],
  };
  return res as unknown as FakeRes;
}

/** Dispatch one request through the real router and return the response. */
async function call(
  router: HttpRouter,
  method: string,
  path: string,
  query: Record<string, string | string[]> = {},
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<FakeRes> {
  const req = makeReq(method, path, query, body, headers);
  const res = makeRes();
  await router.handle(req, res, path);
  return res;
}

// ─── fixture ─────────────────────────────────────────────────────────────

/**
 * A realistic subscriber population. The committed declarations carry no
 * subscribers (they are added at runtime via POST /events/:name/subscribers),
 * so a topology built from a bare registry has only producer edges and
 * understates the graph an operator actually renders. Seeding ~3
 * subscribers per event from a 12-service pool matches the platform's
 * real consumer fan-out.
 */
const SERVICES = [
  'platform-api', 'websocket-gateway', 'pipeline-worker', 'message-queue',
  'live-video-streaming', 'realtime-modules', 'orgiq', 'agent-runner',
  'transcription-worker', 'notification-service', 'billing', 'analytics',
];

function buildRegistry(withSubscribers: boolean): Registry {
  const registry = new Registry();
  for (const d of allDeclarations as EventDeclaration[]) registry.declare(d);
  if (withSubscribers) {
    const names = registry.list().map((e) => e.name);
    for (let i = 0; i < names.length; i++) {
      for (let k = 0; k < 3; k++) {
        registry.addSubscriber(names[i], SERVICES[(i * 3 + k) % SERVICES.length]);
      }
    }
  }
  return registry;
}

function buildDeps(registry: Registry, metrics: MetricsCollector, promMetrics: PromMetrics): RoutesDeps {
  const noopAsync = async (): Promise<void> => {};
  return {
    registry,
    metrics,
    metricsObserver: {
      observe: noopAsync,
      refreshSubscriberCount: () => {},
      syncSubscriberCounts: () => {},
    } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
    } as unknown as RoutesDeps['signal'],
    durable: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
    } as unknown as RoutesDeps['durable'],
    dlqStore: {
      list: async () => [],
    } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    promMetrics,
  };
}

/**
 * Populate the prom surface the way a live server's would be after a
 * while: one publish series per event per transport/mode, a schema-fetch
 * series per event, and a DLQ gauge for a slice of them. That is the
 * series count the render walks on every scrape.
 */
function seedPromMetrics(prom: PromMetrics, registry: Registry): void {
  const entries = registry.list();
  for (const e of entries) {
    const t = e.transport === 'both' ? 'both' : e.transport;
    prom.recordPublish(e.name, t, 'warn');
    prom.recordSchemaFetch(e.name);
  }
  const dlqCounts = new Map<string, number>();
  for (let i = 0; i < entries.length; i += 8) dlqCounts.set(entries[i].name, i % 7);
  prom.syncDLQEntries(dlqCounts);
  prom.setDLQOldestAgeSeconds(42);
  prom.setRegistrySize(entries.length);
  prom.setSseStreams(3, 256);
  prom.setTransportUp('redis', true);
  prom.setTransportUp('message-queue', true);
  prom.setTransportProbeLatencySeconds('redis', 0.001);
  prom.setTransportProbeLatencySeconds('message-queue', 0.004);
  prom.setPoisonedEvents(0);
}

/** Deepest declaration by nested-schema depth — worst case for the compat gate. */
function schemaDepth(schema: unknown, depth = 0): number {
  if (typeof schema !== 'object' || schema === null || depth > 32) return depth;
  const s = schema as Record<string, unknown>;
  let max = depth;
  for (const key of ['properties', 'items', 'additionalProperties']) {
    const v = s[key];
    if (typeof v !== 'object' || v === null) continue;
    for (const sub of Object.values(v as Record<string, unknown>)) {
      max = Math.max(max, schemaDepth(sub, depth + 1));
    }
    max = Math.max(max, schemaDepth(v, depth + 1));
  }
  return max;
}

function deepestDeclaration(): EventDeclaration {
  let best = (allDeclarations as EventDeclaration[])[0];
  let bestDepth = -1;
  for (const d of allDeclarations as EventDeclaration[]) {
    const depth = schemaDepth(d.schema);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = d;
    }
  }
  return best;
}

// ─── SSE fan-out ─────────────────────────────────────────────────────────

/**
 * Open `n` real SSE streams against a private SseRegistry (so the module
 * singleton's cap and any live streams are irrelevant), attach the same
 * handler `/api/flow` attaches, and time one `tapEmitter.publish()`.
 */
function benchFanout(n: number, iters: number, flowStream: (req: RouteRequest, res: RouteResponse) => void): Stats {
  const opened: Array<() => void> = [];
  for (let i = 0; i < n; i++) {
    const req = makeReq('GET', '/api/flow');
    const res = makeRes();
    flowStream(req, res);
    opened.push(() => {
      (req.raw as unknown as FakeRaw).emit('close');
    });
  }

  const event: TapEvent = {
    eventName: 'pipeline:step:completed',
    namespace: 'pipeline',
    producer: 'pipeline-worker',
    transport: 'signal',
    timestamp: new Date().toISOString(),
    channel: 'events:pipeline:step:completed',
    envelope: {
      eventName: 'pipeline:step:completed',
      payload: { stepId: 'step-42', pipelineId: 'p-7', status: 'ok', durationMs: 128 },
      metadata: { id: '01J000000000000000000000', producer: 'pipeline-worker', timestamp: Date.now() },
    },
  };

  // warmup
  for (let i = 0; i < 50; i++) tapEmitter.publish(event);

  const stats = benchSync(`SSE fan-out: 1 tap event → ${n} stream${n === 1 ? '' : 's'}`, iters, () => {
    tapEmitter.publish(event);
  });
  stats.perUnitUs = round(stats.meanUs / n);

  for (const close of opened) close();
  return stats;
}

// ─── main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const declCount = allDeclarations.length;

  // Give the fan-out bench its own registry with headroom above 250.
  sseRegistry.configure({ maxStreams: 4096, backlogBytes: 0 });

  const registry = buildRegistry(true);
  const bareRegistry = buildRegistry(false);
  const metrics = new MetricsCollector(60);
  const promMetrics = new PromMetrics(undefined, { maxEventLabels: 4096 });
  seedPromMetrics(promMetrics, registry);
  promMetrics.collect(() => {
    promMetrics.setRegistrySize(registry.size());
    promMetrics.setSseStreams(sseRegistry.size, sseRegistry.getLimits().maxStreams);
  });

  const deps = buildDeps(registry, metrics, promMetrics);
  const router = createRoutes(deps);
  const bareRouter = createRoutes(buildDeps(bareRegistry, metrics, promMetrics));

  const results: Stats[] = [];

  // ── 1. GET /api/events ────────────────────────────────────────────────
  const listCases: Array<[string, Record<string, string>]> = [
    ['GET /api/events (no filter)', {}],
    ['GET /api/events ?transport=signal', { transport: 'signal' }],
    ['GET /api/events ?namespace=pipeline', { namespace: 'pipeline' }],
    ['GET /api/events ?producer=pipeline-worker', { producer: 'pipeline-worker' }],
    ['GET /api/events ?subscriber=platform-api', { subscriber: 'platform-api' }],
    ['GET /api/events ?tag=pipeline', { tag: 'pipeline' }],
    [
      'GET /api/events ?transport&namespace&tag',
      { transport: 'signal', namespace: 'pipeline', tag: 'pipeline' },
    ],
  ];
  for (const [label, query] of listCases) {
    for (let i = 0; i < WARMUP; i++) await call(router, 'GET', '/events', query);
    results.push(await benchAsync(label, ITERS, async () => {
      await call(router, 'GET', '/events', query);
    }));
  }

  // Attribution: how much of the unfiltered list is filtering, how much is
  // per-event stats enrichment, how much is JSON serialization.
  results.push(benchSync('  ↳ registry.list() only', ITERS, () => {
    sink.frames += registry.list().length;
  }));
  results.push(benchSync('  ↳ list + getStats enrichment', ITERS, () => {
    const out = registry.list().map((e) => ({ ...e, stats: metrics.getStats(e.name) }));
    sink.frames += out.length;
  }));
  {
    const payload = { events: registry.list().map((e) => ({ ...e, stats: metrics.getStats(e.name) })), total: registry.size() };
    results.push(benchSync('  ↳ JSON.stringify(response) only', ITERS, () => {
      sink.bytes += JSON.stringify(payload).length;
    }));
  }

  // ── 2. GET /api/topology ──────────────────────────────────────────────
  const topoCases: Array<[string, Record<string, string>, HttpRouter]> = [
    ['GET /api/topology (no filter, 3 subs/event)', {}, router],
    ['GET /api/topology (no filter, no subscribers)', {}, bareRouter],
    ['GET /api/topology ?namespace=pipeline', { namespace: 'pipeline' }, router],
    ['GET /api/topology ?producer=pipeline-worker', { producer: 'pipeline-worker' }, router],
    ['GET /api/topology ?consumer=platform-api', { consumer: 'platform-api' }, router],
  ];
  for (const [label, query, r] of topoCases) {
    for (let i = 0; i < WARMUP; i++) await call(r, 'GET', '/topology', query);
    results.push(await benchAsync(label, ITERS, async () => {
      await call(r, 'GET', '/topology', query);
    }));
  }
  results.push(benchSync('  ↳ registry.getTopology() only', ITERS, () => {
    sink.frames += registry.getTopology().nodes.length;
  }));

  // ── 3. GET /metrics (Prometheus render) ───────────────────────────────
  for (let i = 0; i < WARMUP; i++) promMetrics.renderProm();
  const promRender = benchSync('GET /metrics — renderProm()', ITERS, () => {
    sink.bytes += promMetrics.renderProm().length;
  });
  results.push(promRender);

  // Attribution inside the render.
  {
    const reg = promMetrics.getRegistry();
    results.push(benchSync('  ↳ MetricsRegistry.getSnapshot()', ITERS, () => {
      sink.frames += reg.getSnapshot().metrics.length;
    }));
    const { formatPrometheus } = await import('distributed-core');
    const snap = reg.getSnapshot();
    results.push(benchSync('  ↳ formatPrometheus(snapshot)', ITERS, () => {
      sink.bytes += formatPrometheus(snap).length;
    }));
  }

  // ── 4. SSE fan-out ────────────────────────────────────────────────────
  const flow = createRoutes(deps);
  // Grab the flow handler by dispatching through the router once per open.
  const flowStream = (req: RouteRequest, res: RouteResponse): void => {
    void flow.handle(req, res, '/flow');
  };
  for (const n of [1, 50, 250]) {
    results.push(benchFanout(n, Math.max(500, Math.floor(ITERS / 2)), flowStream));
  }

  // ── 5. POST /api/events (declare + compat gate) ───────────────────────
  const deepest = deepestDeclaration();
  const deepestDepth = schemaDepth(deepest.schema);
  const declBody = (d: EventDeclaration): Record<string, unknown> => ({
    name: d.name,
    schema: d.schema,
    transport: d.transport,
    producer: Array.isArray(d.producer) ? d.producer[0] : d.producer,
    description: d.description,
    tags: d.tags,
  });

  const decls = allDeclarations as EventDeclaration[];
  const bodies = decls.map(declBody);
  const deepBody = declBody(deepest);

  const declIters = Math.max(200, Math.floor(ITERS / 4));
  for (let i = 0; i < 50; i++) await call(router, 'POST', '/events', {}, bodies[i % bodies.length]);

  results.push(await benchAsync('POST /api/events (compat gate off)', declIters, async (i) => {
    await call(router, 'POST', '/events', {}, bodies[i % bodies.length]);
  }));
  results.push(await benchAsync('POST /api/events (strict — recursive compat gate)', declIters, async (i) => {
    await call(router, 'POST', '/events', {}, bodies[i % bodies.length], {
      'x-event-catalog-strict': 'true',
    });
  }));
  results.push(await benchAsync(
    `POST /api/events (strict, deepest decl "${deepest.name}", depth ${deepestDepth})`,
    declIters,
    async () => {
      await call(router, 'POST', '/events', {}, deepBody, { 'x-event-catalog-strict': 'true' });
    },
  ));

  // ── report ────────────────────────────────────────────────────────────
  const seriesCount = promMetrics.getRegistry().getSnapshot().metrics.length;
  const promBytes = promMetrics.renderProm().length;
  const topo = registry.getTopology();

  if (AS_JSON) {
    console.log(JSON.stringify({
      node: process.version,
      declarations: declCount,
      promSeries: seriesCount,
      promBytes,
      topologyNodes: topo.nodes.length,
      topologyEdges: topo.edges.length,
      iters: ITERS,
      results,
    }, null, 2));
    process.exit(0);
  }

  console.log(`\nevent-catalog SERVER benchmark`);
  console.log(
    `node ${process.version} · ${declCount} declarations · ${seriesCount} prom series `
    + `(${(promBytes / 1024).toFixed(1)} KiB exposition) · topology ${topo.nodes.length} nodes / ${topo.edges.length} edges`,
  );
  console.log(`${ITERS.toLocaleString()} iters (declare: ${Math.max(200, Math.floor(ITERS / 4)).toLocaleString()})\n`);

  const pad = Math.max(...results.map((r) => r.label.length));
  console.log(
    `${'benchmark'.padEnd(pad)}  ${'n'.padStart(7)}  ${'p50 µs'.padStart(11)}  ${'p99 µs'.padStart(11)}  ${'mean µs'.padStart(11)}  ${'ops/sec'.padStart(11)}  ${'µs/unit'.padStart(9)}`,
  );
  console.log('-'.repeat(pad + 70));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(pad)}  ${String(r.n).padStart(7)}  ${r.p50us.toFixed(3).padStart(11)}  `
      + `${r.p99us.toFixed(3).padStart(11)}  ${r.meanUs.toFixed(3).padStart(11)}  `
      + `${r.opsPerSec.toLocaleString().padStart(11)}  ${(r.perUnitUs !== undefined ? r.perUnitUs.toFixed(3) : '').padStart(9)}`,
    );
  }
  console.log(`\n(sink: ${sink.bytes} bytes, ${sink.frames} frames)\n`);
  // SSE streams hold unref'd heartbeat timers; nothing else keeps the
  // loop alive, but be explicit so the script always terminates.
  process.exit(0);
}

void main();
