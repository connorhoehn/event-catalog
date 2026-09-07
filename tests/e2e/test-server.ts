/**
 * Test server for the Playwright e2e suite.
 *
 * Boots the *real* `createRoutes()` surface over an in-memory Registry (no
 * Redis, no SQS, no DynamoDB) and serves the built admin UI from
 * `src/admin/dist` through the same `serveStatic` path production takes in
 * `src/server/index.ts`. Only the three external I/O edges are faked:
 *
 *   - SignalTransport  -> stub (health + per-event metrics only)
 *   - DurableTransport -> stub that records what it was asked to publish,
 *                         so a DLQ replay can be proven to round-trip
 *   - DLQStore         -> in-memory implementation of the DynamoDB store's
 *                         surface (put / list / remove / clear / findById)
 *
 * Everything else — routing, SSE framing, the tap emitter, namespace
 * rollups, subscriber heartbeats — is the production code path.
 *
 * A small control plane lives under `/__e2e__/*` (never `/api`, so it can
 * never be mistaken for product surface). Specs use it to drive the flow
 * tap, seed dead letters, and read back what the durable transport saw.
 */
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from 'distributed-core/server';
import { expressLikeApp } from '../helpers/test-app.js';
import { Registry } from '../../src/registry/index.js';
import { MetricsCollector } from '../../src/server/metrics.js';
import { PromMetrics } from '../../src/server/prom-metrics.js';
import { createRoutes } from '../../src/server/routes.js';
import { tapEmitter, type TapEvent } from '../../src/server/tap-emitter.js';

const PORT = Number(process.env.E2E_PORT ?? 3099);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const adminRoot = join(repoRoot, 'src', 'admin');
const adminDist = process.env.E2E_ADMIN_DIST ?? join(adminRoot, 'dist');

// ─── Fixture ────────────────────────────────────────────────────────────────
//
// Two namespaces ("test" and "billing"), four events, six services. Shaped so
// every admin view has something non-trivial to render: a namespace filter
// with more than one option, an event with multiple subscribers, an orphan
// event with none, and both transports represented.

export const FIXTURE = {
  events: ['test.alpha', 'test.beta', 'test.gamma', 'billing.invoice.paid'],
  namespaces: ['billing', 'test'],
  /** Services that appear as topology nodes (producers + subscribers). */
  services: ['test-svc', 'other-svc', 'billing-svc', 'consumer-svc', 'audit-svc', 'ledger-svc'],
} as const;

const registry = new Registry();
registry.declare({
  name: 'test.alpha',
  schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  transport: 'signal',
  producer: 'test-svc',
});
registry.declare({
  name: 'test.beta',
  schema: { type: 'object', properties: { count: { type: 'number' } } },
  transport: 'durable',
  producer: 'test-svc',
});
registry.declare({
  name: 'test.gamma',
  schema: { type: 'object', properties: { active: { type: 'boolean' } } },
  transport: 'signal',
  producer: 'other-svc',
});
registry.declare({
  name: 'billing.invoice.paid',
  schema: {
    type: 'object',
    properties: { invoiceId: { type: 'string' }, amountCents: { type: 'number' } },
    required: ['invoiceId'],
  },
  transport: 'durable',
  producer: 'billing-svc',
});
registry.addSubscriber('test.alpha', 'consumer-svc');
registry.addSubscriber('test.gamma', 'consumer-svc');
registry.addSubscriber('test.gamma', 'audit-svc');
registry.addSubscriber('billing.invoice.paid', 'ledger-svc');
// test.beta deliberately has no subscribers (orphan rollup on the Dashboard).

const metrics = new MetricsCollector(60);
const prom = new PromMetrics();

// ─── Faked I/O edges ────────────────────────────────────────────────────────

const stubSignal = {
  isConnected: () => true,
  healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
  getAllMetrics: () =>
    new Map([
      ['test.alpha', { publishCount: 5, lastPublishedAt: new Date().toISOString(), subscriberCount: 1 }],
      ['test.gamma', { publishCount: 2, lastPublishedAt: null, subscriberCount: 2 }],
    ]),
  getHistory: async () => [] as unknown[],
};

/** Everything the durable stub was asked to publish, newest last. */
interface PublishedRecord {
  queue: string;
  eventName: string;
  payload: unknown;
  metadata: unknown;
}
let published: PublishedRecord[] = [];
/** When set, the next durable publish rejects with this message (replay-failure path). */
let nextPublishError: string | null = null;

const stubDurable = {
  isConnected: () => true,
  healthCheck: async () => ({ status: 'connected' as const, latencyMs: 2 }),
  getAllMetrics: () =>
    new Map([
      ['test.beta', { sent: 10, received: 9, failed: 1, inFlight: 0 }],
      ['billing.invoice.paid', { sent: 3, received: 3, failed: 0, inFlight: 0 }],
    ]),
  getDLQ: () => [] as unknown[],
  async publish(queue: string, envelope: { eventName: string; payload: unknown; metadata: unknown }) {
    if (nextPublishError !== null) {
      const message = nextPublishError;
      nextPublishError = null;
      throw new Error(message);
    }
    published.push({ queue, eventName: envelope.eventName, payload: envelope.payload, metadata: envelope.metadata });
    return { messageId: `stub-${published.length}` };
  },
};

/**
 * In-memory stand-in for `src/server/dlq-store.ts` (DynamoDB-backed in prod).
 * Implements the exact surface `createDlqHandlers` consumes so the routes,
 * not a mock, decide what the UI sees.
 */
interface DlqEntry {
  id: string;
  eventName: string;
  payload: unknown;
  error: string;
  attempts: number;
  deadAt: string;
}

class InMemoryServerDlqStore {
  private entries: DlqEntry[] = [];
  private seq = 0;

  async put(input: Omit<DlqEntry, 'id'>): Promise<DlqEntry> {
    // Deterministic ids — specs assert on round-trips, not on uuid shape.
    const entry: DlqEntry = { id: `dlq-${++this.seq}`, ...input };
    this.entries.push(entry);
    return entry;
  }

  async list(opts: { eventName?: string; limit?: number } = {}): Promise<DlqEntry[]> {
    let out = this.entries.slice();
    if (opts.eventName) out = out.filter(e => e.eventName === opts.eventName);
    if (opts.limit && opts.limit > 0) out = out.slice(0, opts.limit);
    return out;
  }

  async findById(id: string): Promise<DlqEntry | null> {
    return this.entries.find(e => e.id === id) ?? null;
  }

  async remove(id: string): Promise<boolean> {
    const i = this.entries.findIndex(e => e.id === id);
    if (i === -1) return false;
    this.entries.splice(i, 1);
    return true;
  }

  async clear(eventName?: string): Promise<number> {
    const before = this.entries.length;
    this.entries = eventName ? this.entries.filter(e => e.eventName !== eventName) : [];
    return before - this.entries.length;
  }

  reset(): void {
    this.entries = [];
    this.seq = 0;
  }
}

const dlqStore = new InMemoryServerDlqStore();

// ─── Product routes ─────────────────────────────────────────────────────────

const app = expressLikeApp();
app.use(
  '/api',
  createRoutes({
    registry,
    metrics,
    metricsObserver: { observe: async () => {} } as never,
    signal: stubSignal as never,
    durable: stubDurable as never,
    dlqStore: dlqStore as never,
    startedAt: Date.now(),
    promMetrics: prom,
  }),
);

// ─── /__e2e__ control plane ─────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

/** Fill in the TapEvent fields a spec didn't bother to specify. */
function toTapEvent(input: Record<string, unknown>): TapEvent {
  const eventName = String(input.eventName ?? 'test.alpha');
  const entry = registry.get(eventName);
  return {
    eventName,
    namespace: String(input.namespace ?? entry?.namespace ?? eventName.split('.')[0]),
    producer: String(input.producer ?? entry?.producer ?? 'test-svc'),
    transport: (input.transport as 'signal' | 'durable') ?? (entry?.transport === 'durable' ? 'durable' : 'signal'),
    timestamp: String(input.timestamp ?? new Date().toISOString()),
    ...(input.channel !== undefined ? { channel: String(input.channel) } : {}),
    ...(input.queue !== undefined ? { queue: String(input.queue) } : {}),
    ...(input.envelope !== undefined ? { envelope: input.envelope } : {}),
  };
}

/**
 * Open `GET /api/flow` responses, tracked at the HTTP layer so a spec can
 * sever a live SSE stream from the server side. `context.setOffline(true)`
 * does not tear down an already-established EventSource in Chromium, so this
 * is the only honest way to test the drop-and-recover path.
 */
const openFlowStreams = new Set<http.ServerResponse>();

async function controlPlane(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
  const method = req.method ?? 'GET';

  // Sever every live flow stream.
  if (path === '/__e2e__/flow/kill' && method === 'POST') {
    const killed = openFlowStreams.size;
    for (const stream of openFlowStreams) {
      stream.end();
      openFlowStreams.delete(stream);
    }
    return json(res, 200, { killed });
  }

  // How many SSE clients are currently attached to the tap. Specs poll this
  // so a tap is never published into a void — the deterministic alternative
  // to sleeping and hoping EventSource connected.
  if (path === '/__e2e__/flow/clients' && method === 'GET') {
    return json(res, 200, { clients: tapEmitter.listenerCount('publish') });
  }

  // Drive the real tap emitter — the same call site MetricsObserver makes.
  if (path === '/__e2e__/tap' && method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>;
    const count = Math.max(1, Number(body.count ?? 1));
    const emitted: TapEvent[] = [];
    for (let i = 0; i < count; i++) {
      const event = toTapEvent(body);
      tapEmitter.publish(event);
      emitted.push(event);
    }
    return json(res, 200, { emitted: emitted.length, events: emitted });
  }

  if (path === '/__e2e__/dlq' && method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>;
    const entry = await dlqStore.put({
      eventName: String(body.eventName ?? 'test.beta'),
      payload: body.payload ?? { count: 1 },
      error: String(body.error ?? 'handler threw: ECONNRESET'),
      attempts: Number(body.attempts ?? 3),
      deadAt: String(body.deadAt ?? new Date().toISOString()),
    });
    return json(res, 201, entry);
  }

  if (path === '/__e2e__/dlq' && method === 'GET') {
    return json(res, 200, { entries: await dlqStore.list() });
  }

  // Arm a one-shot durable publish failure so the replay error path is
  // reachable without tearing the server down.
  if (path === '/__e2e__/durable/fail-next' && method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>;
    nextPublishError = String(body.message ?? 'queue unreachable');
    return json(res, 200, { armed: nextPublishError });
  }

  if (path === '/__e2e__/durable/published' && method === 'GET') {
    return json(res, 200, { published });
  }

  // Per-spec isolation: wipe mutable state, leave the registry fixture alone.
  if (path === '/__e2e__/reset' && method === 'POST') {
    dlqStore.reset();
    published = [];
    nextPublishError = null;
    return json(res, 200, { reset: true });
  }

  return json(res, 404, { error: 'NotFound', detail: `no e2e control route for ${method} ${path}` });
}

// ─── Admin UI build ─────────────────────────────────────────────────────────

/** Newest mtime under a directory tree, or 0 when it doesn't exist. */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(full));
    } else {
      const s = await stat(full).catch(() => null);
      if (s) newest = Math.max(newest, s.mtimeMs);
    }
  }
  return newest;
}

/**
 * The admin bundle is gitignored, so a clean checkout has no `dist` at all and
 * the whole suite would silently assert against a 404 page. Build it when it's
 * missing or older than the sources it came from. `E2E_SKIP_ADMIN_BUILD=1`
 * opts out (useful when another process owns the build).
 */
async function ensureAdminBuild(): Promise<void> {
  if (process.env.E2E_ADMIN_DIST) return; // caller pointed us at a prebuilt dir
  if (process.env.E2E_SKIP_ADMIN_BUILD === '1') return;

  const indexPath = join(adminDist, 'index.html');
  const builtAt = existsSync(indexPath) ? (await stat(indexPath)).mtimeMs : 0;
  const srcAt = Math.max(
    await newestMtime(join(adminRoot, 'src')),
    (await stat(join(adminRoot, 'index.html')).catch(() => null))?.mtimeMs ?? 0,
    (await stat(join(adminRoot, 'vite.config.ts')).catch(() => null))?.mtimeMs ?? 0,
  );

  if (builtAt > srcAt) return;

  console.log(`[e2e-test-server] admin bundle ${builtAt === 0 ? 'missing' : 'stale'} — building…`);
  execFileSync('npm', ['run', 'build'], { cwd: adminRoot, stdio: 'inherit' });
}

// ─── Boot ───────────────────────────────────────────────────────────────────

// tsx may transform this module to CJS, where top-level await is unavailable —
// hence the explicit main().
async function main(): Promise<void> {
  await ensureAdminBuild();

  const staticHandler = serveStatic({ staticDir: adminDist });
  const spaIndex = join(adminDist, 'index.html');

  http
    .createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];

      if (path.startsWith('/__e2e__')) {
        controlPlane(req, res, path).catch(err => json(res, 500, { error: String(err) }));
        return;
      }
      if (path === '/api' || path.startsWith('/api/')) {
        if (path === '/api/flow') {
          openFlowStreams.add(res);
          res.on('close', () => openFlowStreams.delete(res));
        }
        app(req, res);
        return;
      }
      if (staticHandler(req, res)) return;

      // SPA fallback — deep links like /events/test.alpha must serve index.html.
      readFile(spaIndex)
        .then(html => {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
          res.end(html);
        })
        .catch(() => {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'NotFound', detail: 'admin UI not built' }));
        });
    })
    .listen(PORT, () => {
      console.log(`[e2e-test-server] listening on :${PORT} (admin dist: ${adminDist})`);
    });
}

main().catch(err => {
  console.error('[e2e-test-server] failed to start:', err);
  process.exit(1);
});
