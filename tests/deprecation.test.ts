// tests/deprecation.test.ts
//
// wave25-a — schema deprecation lifecycle. Covers Registry methods,
// HTTP endpoints, audit emission, and the AsyncAPI tag annotation.

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { auditEmitter, type AuditEvent } from '../src/server/audit-emitter.js';
import { buildAsyncApiSpec } from '../src/server/asyncapi.js';

function makeApp() {
  const reg = new Registry();
  const metrics = new MetricsCollector(60);
  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes({
    registry: reg,
    metrics,
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
    durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
    dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  }));
  return { app, registry: reg };
}

describe('wave25-a — Registry.deprecate / undeprecate', () => {
  it('deprecate() stamps deprecation metadata; entry stays publishable', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    expect(reg.deprecate('a.x', { reason: 'replaced by a.y', by: 'connor' })).toBe(true);
    const entry = reg.get('a.x');
    expect(entry?.deprecation?.reason).toBe('replaced by a.y');
    expect(entry?.deprecation?.by).toBe('connor');
    expect(entry?.deprecation?.deprecatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // Validation still succeeds — deprecation doesn't block publish.
    expect(reg.validate('a.x', {}).valid).toBe(true);
  });

  it('undeprecate() removes the flag', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.deprecate('a.x');
    expect(reg.get('a.x')?.deprecation).toBeDefined();
    expect(reg.undeprecate('a.x')).toBe(true);
    expect(reg.get('a.x')?.deprecation).toBeUndefined();
  });

  it('deprecate() returns false for unknown event; undeprecate() false on no-op', () => {
    const reg = new Registry();
    expect(reg.deprecate('nope')).toBe(false);
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    expect(reg.undeprecate('a.x')).toBe(false);
  });

  it('listDeprecated() returns only deprecated entries', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.deprecate('b.y', { reason: 'old' });
    const dep = reg.listDeprecated();
    expect(dep.map(e => e.name)).toEqual(['b.y']);
  });
});

describe('wave25-a — HTTP routes', () => {
  it('POST /api/events/:name/deprecate marks the event and emits audit', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });

    const audits: AuditEvent[] = [];
    const handler = (e: AuditEvent) => audits.push(e);
    auditEmitter.on('audit', handler);

    const res = await request(app)
      .post('/api/events/a.x/deprecate')
      .send({ reason: 'replaced', by: 'connor' });

    auditEmitter.off('audit', handler);

    expect(res.status).toBe(200);
    expect(res.body.deprecated).toBe('a.x');
    expect(res.body.deprecation.reason).toBe('replaced');
    expect(audits.find(a => a.kind === 'event.deprecated')?.eventName).toBe('a.x');
    expect(audits.find(a => a.kind === 'event.deprecated')?.reason).toBe('replaced');
  });

  it('POST /api/events/:name/deprecate returns 404 for unknown event', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/events/nope/deprecate').send({});
    expect(res.status).toBe(404);
  });

  it('DELETE /api/events/:name/deprecate clears the flag', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    registry.deprecate('a.x');

    const res = await request(app).delete('/api/events/a.x/deprecate');
    expect(res.status).toBe(200);
    expect(res.body.undeprecated).toBe('a.x');
    expect(registry.get('a.x')?.deprecation).toBeUndefined();
  });

  it('GET /api/deprecated lists deprecated entries with metadata', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    registry.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    registry.deprecate('b.y', { reason: 'eol' });

    const res = await request(app).get('/api/deprecated');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0].name).toBe('b.y');
    expect(res.body.items[0].deprecation.reason).toBe('eol');
  });
});

describe('wave25-a — AsyncAPI export', () => {
  it('annotates deprecated events with a deprecated tag and x-deprecated extension', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 's' });
    reg.deprecate('a.x', { reason: 'replaced by a.y' });

    const spec = buildAsyncApiSpec(reg, { title: 't', version: '1' }) as Record<string, any>;
    const messages = spec.components.messages;
    const messageKey = Object.keys(messages)[0]!;
    const msg = messages[messageKey];

    expect(msg.tags).toContainEqual({ name: 'deprecated', description: 'replaced by a.y' });
    expect(msg['x-deprecated']).toBeDefined();
    expect(msg['x-deprecated'].reason).toBe('replaced by a.y');
  });
});
