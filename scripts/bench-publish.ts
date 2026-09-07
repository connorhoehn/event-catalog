// scripts/bench-publish.ts
//
// Hot-path benchmark for the publish pipeline.
//
//   npx tsx scripts/bench-publish.ts
//   npx tsx scripts/bench-publish.ts --iters 200000 --json
//
// What it measures (all in-process, transports stubbed so nothing is
// timing I/O):
//
//   1. boot         — `new EventCatalog(...)` + `declareAll(allDeclarations)`
//                     for the full ~194 real declarations.
//   2. publish       — `catalog.publish(name, payload)` in a tight loop:
//                      alias resolution + schema validation + envelope
//                      construction + routing to a stub transport.
//   3. validate      — `registry.validate()` alone, to separate validation
//                      cost from the rest of publish.
//   4. list          — `registry.list()` unfiltered and with each filter.
//   5. resolve-alias — `registry.resolve()` on a deprecated alias (the
//                      known linear-scan path).
//
// Latencies are reported as p50/p99 in microseconds, plus ops/sec.

import { EventCatalog } from '../src/client/index';
import { Registry } from '../src/registry/index';
import { allDeclarations } from '../src/declarations/index';
import type { EventDeclaration, EventEnvelope } from '../src/types/index';

// ─── args ────────────────────────────────────────────────────────────────

function argValue(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const ITERS = argValue('--iters', 100_000);
const WARMUP = argValue('--warmup', 10_000);
const AS_JSON = process.argv.includes('--json');

// ─── stub transports ─────────────────────────────────────────────────────

/**
 * Replace the catalog's real Redis / message-queue transports with no-op
 * stubs and mark it connected. We are timing validation + routing, not I/O.
 * `sink` counts deliveries so the optimizer can't elide the call.
 */
const sink = { count: 0 };

function stubTransports(catalog: EventCatalog): void {
  const anyCatalog = catalog as unknown as Record<string, unknown>;
  anyCatalog.connected = true;
  anyCatalog.signal = {
    publish: async (_channel: string, _envelope: EventEnvelope): Promise<void> => {
      sink.count++;
    },
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
  };
  anyCatalog.durable = {
    publish: async (): Promise<void> => {
      sink.count++;
    },
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
  };
}

// ─── payload synthesis ───────────────────────────────────────────────────

/**
 * Build a payload that satisfies a declared schema: every required
 * property gets a value of the right type, plus every declared optional
 * scalar so the validator actually walks the properties it declares
 * (a payload of only required fields under-exercises the hot path).
 */
function sampleFor(schema: Record<string, unknown> | undefined, depth = 0): unknown {
  if (!schema || typeof schema !== 'object') return {};
  const s = schema as Record<string, any>;

  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case 'string':
      if (typeof s.pattern === 'string') return '';
      return 'x'.repeat(Math.max(s.minLength ?? 1, 1));
    case 'number':
      return s.minimum ?? 1.5;
    case 'integer':
      return s.minimum ?? 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array': {
      if (depth > 4) return [];
      const item = sampleFor(s.items as Record<string, unknown> | undefined, depth + 1);
      return [item, item];
    }
    case 'object':
    default: {
      if (depth > 4) return {};
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      for (const [k, sub] of Object.entries(props)) {
        out[k] = sampleFor(sub as Record<string, unknown>, depth + 1);
      }
      for (const r of (Array.isArray(s.required) ? s.required : []) as string[]) {
        if (!(r in out)) out[r] = 'x';
      }
      return out;
    }
  }
}

// ─── timing helpers ──────────────────────────────────────────────────────

interface Stats {
  label: string;
  n: number;
  p50us: number;
  p99us: number;
  meanUs: number;
  opsPerSec: number;
  totalMs: number;
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
    totalMs: round(totalNs / 1e6),
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Time a synchronous op `iters` times, recording a per-call sample. */
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

/** Time an async op `iters` times, sequentially. */
async function benchAsync(label: string, iters: number, fn: (i: number) => Promise<void>): Promise<Stats> {
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

// ─── the benchmark ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const decls = allDeclarations as EventDeclaration[];

  // ── 1. boot: construct + declare all 194 -------------------------------
  const bootRuns = 30;
  const bootSamples = new Float64Array(bootRuns);
  const bootT0 = process.hrtime.bigint();
  for (let i = 0; i < bootRuns; i++) {
    const s = process.hrtime.bigint();
    const c = new EventCatalog({
      serviceName: 'bench',
      redis: { url: 'redis://127.0.0.1:6379' },
      messageQueue: { url: 'http://127.0.0.1:3004' },
    });
    c.declareAll(decls);
    bootSamples[i] = Number(process.hrtime.bigint() - s);
  }
  const bootTotal = Number(process.hrtime.bigint() - bootT0);
  const boot = summarize('boot: new EventCatalog + declareAll(194)', bootSamples, bootTotal);

  // Registry-only declare, to separate catalog construction from declare().
  const declRuns = 30;
  const declSamples = new Float64Array(declRuns);
  const declT0 = process.hrtime.bigint();
  for (let i = 0; i < declRuns; i++) {
    const s = process.hrtime.bigint();
    const r = new Registry();
    for (const d of decls) r.declare(d);
    declSamples[i] = Number(process.hrtime.bigint() - s);
  }
  const declTotal = Number(process.hrtime.bigint() - declT0);
  const declareOnly = summarize('boot: Registry.declare() x194', declSamples, declTotal);

  // ── shared catalog for the hot-path runs -------------------------------
  const catalog = new EventCatalog({
    serviceName: 'bench',
    redis: { url: 'redis://127.0.0.1:6379' },
    messageQueue: { url: 'http://127.0.0.1:3004' },
  });
  catalog.declareAll(decls);
  stubTransports(catalog);

  const registry = new Registry();
  for (const d of decls) registry.declare(d);

  // Round-robin over every declared event with a matching valid payload,
  // so the loop exercises the real spread of schema shapes rather than one.
  const names = decls.map((d) => d.name);
  const payloads = decls.map((d) => sampleFor(d.schema));

  // Sanity: every synthesized payload must validate, else we'd be timing
  // the error path instead of the success path.
  let invalid = 0;
  for (let i = 0; i < names.length; i++) {
    if (!registry.validate(names[i], payloads[i]).valid) invalid++;
  }

  // ── warmup -------------------------------------------------------------
  for (let i = 0; i < WARMUP; i++) {
    const k = i % names.length;
    await catalog.publish(names[k], payloads[k]);
  }

  // ── 2. publish ---------------------------------------------------------
  const publish = await benchAsync('publish() [validation + routing]', ITERS, async (i) => {
    const k = i % names.length;
    await catalog.publish(names[k], payloads[k]);
  });

  // ── 3. validate alone --------------------------------------------------
  for (let i = 0; i < WARMUP; i++) {
    const k = i % names.length;
    registry.validate(names[k], payloads[k]);
  }
  let validAcc = 0;
  const validate = benchSync('registry.validate()', ITERS, (i) => {
    const k = i % names.length;
    if (registry.validate(names[k], payloads[k]).valid) validAcc++;
  });

  // ── 4. list ------------------------------------------------------------
  const listIters = 20_000;
  let listAcc = 0;
  const listAll = benchSync('registry.list() no filter', listIters, () => {
    listAcc += registry.list().length;
  });
  const listNs = benchSync('registry.list({namespace})', listIters, () => {
    listAcc += registry.list({ namespace: 'pipeline' }).length;
  });
  const listMulti = benchSync('registry.list({transport,namespace,tag})', listIters, () => {
    listAcc += registry.list({ transport: 'signal', namespace: 'pipeline', tag: 'pipeline' }).length;
  });

  // ── 5. alias resolve ---------------------------------------------------
  // `publish()` calls `resolve()` for every event. A canonical name is a
  // Map hit; an alias used to fall through to a scan of every entry. Both
  // are measured, the alias one at 194 and at 5,000 events so the shape of
  // the cost (flat vs linear in registry size) is visible.
  const aliasStats: Stats[] = [];
  aliasStats.push(benchSync('registry.resolve() canonical', 50_000, () => {
    registry.resolve(names[names.length - 1]);
  }));
  for (const scale of [decls.length, 5_000]) {
    const r = new Registry();
    for (const d of decls) r.declare(d);
    for (let i = r.size(); i < scale; i++) {
      r.declare({
        name: `synthetic:filler:${i}`,
        transport: 'signal',
        producer: 'bench',
        description: 'synthetic filler declaration',
        schema: { type: 'object' },
      });
    }
    // Alias on the last-declared event: worst case for a linear scan.
    r.declare({
      name: 'synthetic:aliased',
      transport: 'signal',
      producer: 'bench',
      description: 'carries the alias under test',
      schema: { type: 'object' },
      aliases: [{ name: 'synthetic.aliased.old' }],
    });
    aliasStats.push(benchSync(`registry.resolve() alias @ ${r.size()} events`, 50_000, () => {
      r.resolve('synthetic.aliased.old');
    }));
  }

  const results = [boot, declareOnly, publish, validate, listAll, listNs, listMulti]
    .concat(aliasStats);

  if (AS_JSON) {
    console.log(JSON.stringify({ iters: ITERS, declarations: decls.length, invalidSamples: invalid, results }, null, 2));
    return;
  }

  console.log(`\nevent-catalog publish benchmark`);
  console.log(`node ${process.version} · ${decls.length} declarations · ${ITERS.toLocaleString()} iters · warmup ${WARMUP.toLocaleString()}`);
  if (invalid > 0) {
    console.log(`WARNING: ${invalid} synthesized payloads failed validation — those iterations time the error path.`);
  }
  console.log('');
  const pad = Math.max(...results.map((r) => r.label.length));
  console.log(
    `${'benchmark'.padEnd(pad)}  ${'n'.padStart(8)}  ${'p50 µs'.padStart(10)}  ${'p99 µs'.padStart(10)}  ${'mean µs'.padStart(10)}  ${'ops/sec'.padStart(12)}`,
  );
  console.log('-'.repeat(pad + 60));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(pad)}  ${String(r.n).padStart(8)}  ${r.p50us.toFixed(3).padStart(10)}  ${r.p99us.toFixed(3).padStart(10)}  ${r.meanUs.toFixed(3).padStart(10)}  ${r.opsPerSec.toLocaleString().padStart(12)}`,
    );
  }
  console.log(`\n(sink deliveries: ${sink.count}, valid: ${validAcc}, listAcc: ${listAcc})\n`);
}

void main();
