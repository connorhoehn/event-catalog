/**
 * Minimal HTTP server for Playwright e2e tests.
 * Boots with an in-memory Registry (no Redis/SQS) seeded with 3 events
 * and serves the built admin UI from src/admin/dist.
 */
import * as http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from 'distributed-core/server';
import { expressLikeApp } from '../helpers/test-app.js';
import { Registry } from '../../src/registry/index.js';
import { MetricsCollector } from '../../src/server/metrics.js';
import { PromMetrics } from '../../src/server/prom-metrics.js';
import { createRoutes } from '../../src/server/routes.js';

const PORT = 3099;

const registry = new Registry();
registry.declare({ name: 'test.alpha', schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, transport: 'signal', producer: 'test-svc' });
registry.declare({ name: 'test.beta', schema: { type: 'object', properties: { count: { type: 'number' } } }, transport: 'durable', producer: 'test-svc' });
registry.declare({ name: 'test.gamma', schema: { type: 'object', properties: { active: { type: 'boolean' } } }, transport: 'signal', producer: 'other-svc' });
registry.addSubscriber('test.alpha', 'consumer-svc');

const metrics = new MetricsCollector(60);
const prom = new PromMetrics();

const stubSignal = {
  isConnected: () => true,
  healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
  getAllMetrics: () => new Map([
    ['test.alpha', { publishCount: 5, lastPublishedAt: new Date().toISOString(), subscriberCount: 1 }],
    ['test.gamma', { publishCount: 2, lastPublishedAt: null, subscriberCount: 0 }],
  ]),
  getHistory: async () => [] as unknown[],
};

const stubDurable = {
  isConnected: () => true,
  healthCheck: async () => ({ status: 'connected' as const, latencyMs: 2 }),
  getAllMetrics: () => new Map([
    ['test.beta', { sent: 10, received: 9, failed: 1, inFlight: 0 }],
  ]),
  getDLQ: () => [] as unknown[],
};

const stubDlq = {
  list: async () => [] as never[],
  remove: async () => true,
  findById: async () => null,
  put: async () => ({ id: 'x', eventName: 'x', payload: {}, error: '', attempts: 0, deadAt: '0' }),
};

const app = expressLikeApp();

app.use('/api', createRoutes({
  registry,
  metrics,
  metricsObserver: { observe: async () => {} } as never,
  signal: stubSignal as never,
  durable: stubDurable as never,
  dlqStore: stubDlq as never,
  startedAt: Date.now(),
  promMetrics: prom,
}));

// Static admin UI + SPA fallback via distributed-core's serveStatic —
// same serving path production takes in src/server/index.ts.
const adminDist = new URL('../../src/admin/dist', import.meta.url).pathname;
const staticHandler = serveStatic({ staticDir: adminDist });
const spaIndex = join(adminDist, 'index.html');

http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/api' || path.startsWith('/api/')) {
    app(req, res);
    return;
  }
  if (staticHandler(req, res)) return;
  readFile(spaIndex)
    .then(html => {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      res.end(html);
    })
    .catch(() => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NotFound', detail: 'admin UI not built' }));
    });
}).listen(PORT, () => {
  console.log(`[e2e-test-server] listening on :${PORT}`);
});
