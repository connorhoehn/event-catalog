import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeHealthHandler } from '../src/server/health.js';

function makeApp(handler: ReturnType<typeof makeHealthHandler>) {
  const app = express();
  app.get('/health', handler);
  return app;
}

describe('makeHealthHandler — tri-state', () => {
  it('returns 200 + status=healthy when every check is healthy', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.1',
      checks: [
        { id: 'redis', check: async () => ({ status: 'healthy', details: { latencyMs: 1 } }) },
        { id: 'message-queue', check: async () => ({ status: 'healthy', details: { latencyMs: 2 } }) },
      ],
    });
    const res = await request(makeApp(handler)).get('/health').expect(200);
    expect(res.body.service).toBe('event-catalog');
    expect(res.body.version).toBe('0.1.1');
    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.length).toBe(2);
    for (const check of res.body.checks) {
      expect(check.id).toBeTypeOf('string');
      expect(check.status).toBe('healthy');
      expect(typeof check.durationMs).toBe('number');
    }
  });

  it('returns 200 + status=degraded when any check is degraded (none unhealthy)', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.1',
      checks: [
        { id: 'redis', check: async () => ({ status: 'healthy' }) },
        { id: 'message-queue', check: async () => ({ status: 'degraded', details: { latencyMs: 9999 } }) },
      ],
    });
    const res = await request(makeApp(handler)).get('/health').expect(200);
    expect(res.body.status).toBe('degraded');
    const mq = res.body.checks.find((c: { id: string }) => c.id === 'message-queue');
    expect(mq.status).toBe('degraded');
    expect(mq.details).toEqual({ latencyMs: 9999 });
  });

  it('returns 503 + status=unhealthy when any check fails', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.1',
      checks: [
        { id: 'redis', check: async () => ({ status: 'healthy' }) },
        { id: 'message-queue', check: async () => ({ status: 'unhealthy', details: { reason: 'connection refused' } }) },
      ],
    });
    const res = await request(makeApp(handler)).get('/health').expect(503);
    expect(res.body.status).toBe('unhealthy');
    const mq = res.body.checks.find((c: { id: string }) => c.id === 'message-queue');
    expect(mq.status).toBe('unhealthy');
  });

  it('captures a thrown check as unhealthy + error detail', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.1',
      checks: [
        { id: 'redis', check: async () => { throw new Error('boom'); } },
      ],
    });
    const res = await request(makeApp(handler)).get('/health').expect(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.checks[0].id).toBe('redis');
    expect(res.body.checks[0].status).toBe('unhealthy');
    expect((res.body.checks[0].details as { error: string }).error).toBe('boom');
  });
});

describe('makeHealthHandler — timeout path', () => {
  it('marks a check unhealthy when it does not resolve within timeoutMs', async () => {
    // Use a real 2ms timeout and a check that takes 50ms — the timeout fires first.
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.0',
      checks: [
        {
          id: 'slow-check',
          check: () =>
            new Promise<{ status: 'healthy' }>((resolve) =>
              setTimeout(() => resolve({ status: 'healthy' }), 50),
            ),
        },
      ],
      timeoutMs: 2,
    });

    const res = await request(makeApp(handler)).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    const check = res.body.checks[0] as { id: string; status: string; details: { error: string } };
    expect(check.id).toBe('slow-check');
    expect(check.status).toBe('unhealthy');
    expect(check.details.error).toContain('timed out');
  }, 500);

  it('uses custom timeoutMs — fast check resolves well within timeout', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.0',
      checks: [
        { id: 'fast', check: async () => ({ status: 'healthy' as const }) },
      ],
      timeoutMs: 200,
    });

    const res = await request(makeApp(handler)).get('/health').expect(200);
    expect(res.body.status).toBe('healthy');
  });
});
