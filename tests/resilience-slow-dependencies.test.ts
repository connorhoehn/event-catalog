// tests/resilience-slow-dependencies.test.ts
//
// Dependencies that are SLOW rather than dead, and failures that land
// mid-flight — after validation, after the POST was accepted, between
// the two legs of a `transport: 'both'` fan-out.
//
// Everything here is driven on fake timers. A resilience test that
// sleeps for real is a resilience test that flakes on a loaded CI box,
// so nothing below waits on wall-clock time; `advanceTimersByTimeAsync`
// is the only clock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DurableTransport } from '../src/client/durable.js';
import { makeHealthHandler } from '../src/server/health.js';
import type { Request, Response } from '../src/server/http-router.js';
import type { EventEnvelope } from '../src/types/index.js';
import { httpResponse, messageQueueFetch, neverSettles } from './helpers/degraded-deps.js';

function envelope(): EventEnvelope {
  return {
    eventName: 'orders:created',
    payload: { orderId: 'o-1' },
    metadata: { id: 'e-1', producer: 'orders-api', timestamp: 1_700_000_000_000 },
  };
}

/** Track whether a promise has settled without ever awaiting it. */
function watch<T>(p: Promise<T>): { state: () => 'pending' | 'resolved' | 'rejected'; error: () => unknown } {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  let error: unknown;
  p.then(
    () => { state = 'resolved'; },
    (e: unknown) => { state = 'rejected'; error = e; },
  );
  return { state: () => state, error: () => error };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// message-queue that accepts the connection and never answers
// ---------------------------------------------------------------------------

describe('DurableTransport.publish — message-queue slow, not dead', () => {
  it('bounds a hung publish even when the fetch implementation ignores cancellation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', messageQueueFetch(() => neverSettles()));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 1 });
    await transport.connect();

    const pending = watch(transport.publish('orders-created', envelope()));

    // Ten simulated minutes — far past any retry budget, any plausible
    // request timeout, and any operator's patience.
    await vi.advanceTimersByTimeAsync(600_000);

    expect(pending.state()).toBe('rejected');
    expect((pending.error() as Error).message).toContain('Timeout');
    expect(transport.getMetrics('orders-created')).toMatchObject({ sent: 0, failed: 1 });
    expect(transport.getInFlightPublishCount().current).toBe(0);
  });

  it('healthCheck DOES bound itself, so the transport is still reportable while publishes hang', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      // Honour the abort signal the way a real fetch does.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }));

    const transport = new DurableTransport({ url: 'http://mq:3004' });
    // connect() probes /ready with no timeout either, so it hangs too —
    // but it is fire-and-forget at boot, not on the request path.
    const connecting = watch(transport.connect());
    await vi.advanceTimersByTimeAsync(10);
    expect(connecting.state()).toBe('pending');

    // healthCheck reads `connected`, which connect() has not set yet, so
    // drive it against a transport that HAS connected.
    const probed = new DurableTransport({ url: 'http://mq:3004' });
    Object.assign(probed as unknown as { connected: boolean }, { connected: true });

    let status: string | undefined;
    const probing = probed.healthCheck().then(h => { status = h.status; });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(status).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    await probing;

    // Degraded, not disconnected: the socket opened, the answer never
    // came. That distinction is what /ready reports as 200-degraded
    // rather than 503.
    expect(status).toBe('degraded');
  });
});

// ---------------------------------------------------------------------------
// message-queue that accepts the POST and then fails it
// ---------------------------------------------------------------------------

describe('DurableTransport.publish — accepted, then 500', () => {
  it('rejects with the status the server returned, after the full retry budget', async () => {
    vi.useFakeTimers();
    let posts = 0;
    vi.stubGlobal('fetch', messageQueueFetch(() => {
      posts++;
      return httpResponse(500, 'internal error');
    }));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 10 });
    await transport.connect();

    const publishing = watch(transport.publish('orders-created', envelope()));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(publishing.state()).toBe('rejected');
    expect(String((publishing.error() as Error).message)).toContain('request failed (500');
    expect(posts).toBe(3);
    // One publish that failed is one failure, not one per HTTP attempt —
    // otherwise the error rate reads 3x during any message-queue wobble.
    expect(transport.getMetrics('orders-created')).toEqual({
      sent: 0, received: 0, failed: 1, inFlight: 0,
    });
  });

  it('a 500 on the first attempt that clears on the second is a clean success', async () => {
    vi.useFakeTimers();
    let posts = 0;
    vi.stubGlobal('fetch', messageQueueFetch(() => {
      posts++;
      return posts === 1 ? httpResponse(500) : httpResponse(200, { message_id: 'm-1' });
    }));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 10 });
    await transport.connect();

    const publishing = watch(transport.publish('orders-created', envelope()));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(publishing.state()).toBe('resolved');
    // The transient 500 must not leave a phantom failure behind.
    expect(transport.getMetrics('orders-created')).toEqual({
      sent: 1, received: 0, failed: 0, inFlight: 0,
    });
  });

  it('a failed queue-ensure is retried on the next publish once the queue service recovers', async () => {
    vi.useFakeTimers();
    let ensureShouldFail = true;
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.endsWith('/ready')) return httpResponse(200, { status: 'ready' });
      if (init?.method === 'PUT') {
        puts.push(s);
        return ensureShouldFail ? httpResponse(503) : httpResponse(201, { status: 'created' });
      }
      return httpResponse(200, { message_id: 'm' });
    }));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 1 });
    await transport.connect();

    // Degraded: refuse to send until the declared queue policy is accepted.
    await vi.advanceTimersByTimeAsync(0);
    const first = watch(transport.publish('orders-created', envelope()));
    await vi.advanceTimersByTimeAsync(100);
    expect(first.state()).toBe('rejected');
    expect(puts).toHaveLength(1);

    // Recovered: because the failed ensure was never cached, the next
    // publish re-ensures and the queue config finally lands.
    ensureShouldFail = false;
    const second = watch(transport.publish('orders-created', envelope()));
    await vi.advanceTimersByTimeAsync(100);
    expect(second.state()).toBe('resolved');
    expect(puts).toHaveLength(2);

    // …and once it has landed, it is not re-sent on every publish.
    const third = watch(transport.publish('orders-created', envelope()));
    await vi.advanceTimersByTimeAsync(100);
    expect(third.state()).toBe('resolved');
    expect(puts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Backpressure: a message-queue asking for an unreasonable wait
// ---------------------------------------------------------------------------

describe('DurableTransport.publish — backpressure that would park the caller', () => {
  it('clamps an hour-long Retry-After so a publish cannot be parked for an hour', async () => {
    vi.useFakeTimers();

    vi.stubGlobal('fetch', messageQueueFetch(() =>
      httpResponse(429, 'slow down', { 'retry-after': '3600' })));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 10 });
    await transport.connect();

    const publishing = watch(transport.publish('orders-created', envelope()));

    // Two capped five-minute waits precede the third and final attempt.
    // Honor the server's requested minimum up to that cap; do not jitter early.
    await vi.advanceTimersByTimeAsync(600_001);
    expect(publishing.state()).toBe('rejected');
    expect(String((publishing.error() as Error).message)).toContain('429');

    // It was still pending at 400s — i.e. the retries really did wait,
    // this is not an accidental immediate failure.
    expect(transport.getMetrics('orders-created')).toEqual({
      sent: 0, received: 0, failed: 1, inFlight: 0,
    });

  });

  it('does not settle early: the clamped waits are actually observed', async () => {
    vi.useFakeTimers();

    vi.stubGlobal('fetch', messageQueueFetch(() =>
      httpResponse(429, 'slow down', { 'retry-after': '3600' })));

    const transport = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 10 });
    await transport.connect();
    const publishing = watch(transport.publish('orders-created', envelope()));

    await vi.advanceTimersByTimeAsync(400_000);
    expect(publishing.state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(200_001);
    expect(publishing.state()).toBe('rejected');

  });
});

// ---------------------------------------------------------------------------
// /ready must answer even when a dependency probe does not
// ---------------------------------------------------------------------------

describe('makeHealthHandler — one check that never answers', () => {
  function fakeRes() {
    const out = { code: 0, body: undefined as unknown };
    const res = {
      status(code: number) { out.code = code; return this; },
      json(body: unknown) { out.body = body; },
    } as unknown as Response;
    return { res, out };
  }

  it('answers on its own timeout instead of hanging with the dependency', async () => {
    vi.useFakeTimers();
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.0.0',
      checks: [
        { id: 'redis', check: () => neverSettles() },
        { id: 'registry', check: async () => ({ status: 'healthy', details: { eventCount: 3 } }) },
      ],
      timeoutMs: 5_000,
    });
    const { res, out } = fakeRes();
    const handling = watch(handler({} as Request, res));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(handling.state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    expect(handling.state()).toBe('resolved');

    const body = out.body as {
      status: string;
      checks: Array<{ id: string; status: string; details?: { error?: string } }>;
    };
    expect(out.code).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(body.checks.find(c => c.id === 'redis')?.details?.error).toMatch(/timed out after 5000ms/);
    // The sibling check still reports its own truth — one slow
    // dependency does not blank the whole report.
    expect(body.checks.find(c => c.id === 'registry')?.status).toBe('healthy');
  });

  it('a check that resolves quickly leaves no timer behind', async () => {
    vi.useFakeTimers();
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.0.0',
      checks: [{ id: 'registry', check: async () => ({ status: 'healthy' }) }],
      timeoutMs: 5_000,
    });
    const { res } = fakeRes();
    await handler({} as Request, res);

    // A leaked 5s timer per health probe, at one probe every 15s, is how
    // a process ends up holding thousands of them.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a check that rejects is unhealthy with the reason, not a thrown handler', async () => {
    const handler = makeHealthHandler({
      service: 'event-catalog',
      version: '0.0.0',
      checks: [{ id: 'redis', check: async () => { throw new Error('Connection is closed.'); } }],
    });
    const { res, out } = fakeRes();
    await handler({} as Request, res);

    const body = out.body as { status: string; checks: Array<{ details?: { error?: string } }> };
    expect(out.code).toBe(503);
    expect(body.status).toBe('unhealthy');
    expect(body.checks[0].details?.error).toBe('Connection is closed.');
  });
});
