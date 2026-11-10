import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import {
  createMetricsHandler,
  createSingleFlightCache,
  createTokenBucket,
} from '../src/server/metrics-endpoint.js';
import type { DLQEntry } from '../src/server/dlq-store.js';

function entry(eventName: string): DLQEntry {
  return { eventName } as unknown as DLQEntry;
}

function setup(opts: { list?: () => Promise<DLQEntry[]>; burst?: number; perSecond?: number } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const list = vi.fn(opts.list ?? (async () => [entry('a'), entry('a'), entry('b')]));
  const promMetrics = new PromMetrics();
  const app = expressLikeApp();
  app.get('/metrics', createMetricsHandler({
    dlqStore: { list },
    promMetrics,
    now,
    rateLimitBurst: opts.burst ?? 1000,
    rateLimitPerSecond: opts.perSecond ?? 1000,
  }));
  return { app, list, advance: (ms: number) => { t += ms; } };
}

describe('/metrics — cached DLQ query', () => {
  it('serves repeat requests within 30 s from one query', async () => {
    const { app, list, advance } = setup();
    const first = await request(app).get('/metrics').expect(200);
    expect(first.text).toMatch(/event_catalog_dlq_entries\{[^}]*"a"[^}]*\} 2/);
    advance(10_000);
    await request(app).get('/metrics').expect(200);
    advance(19_000);
    await request(app).get('/metrics').expect(200);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the 30 s expiry', async () => {
    const { app, list, advance } = setup();
    await request(app).get('/metrics').expect(200);
    advance(30_000);
    await request(app).get('/metrics').expect(200);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers share one in-flight query', async () => {
    let release!: (v: DLQEntry[]) => void;
    const { app, list } = setup({ list: () => new Promise<DLQEntry[]>(r => { release = r; }) });
    const pending = Promise.all([1, 2, 3, 4, 5].map(() => request(app).get('/metrics').then(r => r)));
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    // Give the other requests time to arrive while the first is in flight.
    await new Promise(r => setTimeout(r, 50));
    release([entry('x')]);
    const responses = await pending;
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh still answers and is retried on the next request', async () => {
    let fail = true;
    const { app, list } = setup({
      list: async () => {
        if (fail) throw new Error('ddb down');
        return [entry('a')];
      },
    });
    await request(app).get('/metrics').expect(200);
    fail = false;
    const res = await request(app).get('/metrics').expect(200);
    expect(list).toHaveBeenCalledTimes(2);
    expect(res.text).toMatch(/event_catalog_dlq_entries\{[^}]*"a"[^}]*\} 1/);
  });
});

describe('/metrics — rate limit', () => {
  it('answers 429 once the bucket is empty, and recovers after refill', async () => {
    const { app, advance } = setup({ burst: 2, perSecond: 1 });
    await request(app).get('/metrics').expect(200);
    await request(app).get('/metrics').expect(200);
    const limited = await request(app).get('/metrics').expect(429);
    expect(limited.headers['retry-after']).toBe('1');
    advance(1_000);
    await request(app).get('/metrics').expect(200);
  });
});

describe('createSingleFlightCache / createTokenBucket', () => {
  it('does not keep a rejected load', async () => {
    let n = 0;
    const cache = createSingleFlightCache(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
      return n;
    }, 30_000, () => 0);
    await expect(cache.get()).rejects.toThrow('boom');
    await expect(cache.get()).resolves.toBe(2);
    await expect(cache.get()).resolves.toBe(2);
  });

  it('token bucket never exceeds its capacity', () => {
    let t = 0;
    const bucket = createTokenBucket(3, 1, () => t);
    t = 100_000;
    expect([1, 2, 3, 4].map(() => bucket.take())).toEqual([true, true, true, false]);
  });
});
