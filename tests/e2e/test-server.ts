/**
 * Minimal Express server for Playwright e2e tests.
 * Boots with an in-memory Registry (no Redis/SQS) seeded with 3 events
 * and serves the built admin UI from src/admin/dist.
 */
import express from 'express';
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

const app = express();
app.use(express.json());

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

const adminDist = new URL('../../src/admin/dist', import.meta.url).pathname;
app.use(express.static(adminDist));
app.get('*', (_req, res) => {
  res.sendFile('index.html', { root: adminDist });
});

app.listen(PORT, () => {
  console.log(`[e2e-test-server] listening on :${PORT}`);
});
