import { queueResponse } from './helpers/queue-http';
// tests/durable-failure-paths.test.ts
//
// Operational failure behaviour of DurableTransport that tests/durable.test.ts
// leaves uncovered: the network-error retry arm of publish(), Retry-After
// parsing edge cases (unparseable header, HTTP-date already in the past),
// poller shutdown, the poll loop's non-2xx and malformed-JSON arms, and the
// dead-letter ring's capacity eviction boundary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DurableTransport } from '../src/client/durable.js';
import type { EventEnvelope } from '../src/types/index.js';

function headers(entries: Record<string, string> = {}): { get: (k: string) => string | null } {
  return { get: (k: string) => entries[k.toLowerCase()] ?? null };
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventName: 'job:queued',
    payload: { jobId: 'j-1' },
    metadata: { id: 'e-1', producer: 'test', timestamp: 1_700_000_000_000 },
    ...overrides,
  };
}

const okRes = queueResponse(200, { message_id: 'sent' });
const putOk = queueResponse(201, { status: 'created' });

/** Fetch mock that answers queue PUTs with 201 and delegates everything else. */
function fetchMock(handler: (url: string, init?: RequestInit) => unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return putOk;
    if (String(url).endsWith('/ready')) return queueResponse(200, { status: 'ready' });
    return handler(String(url), init);
  });
}

async function connected(config: Partial<ConstructorParameters<typeof DurableTransport>[0]> = {}): Promise<DurableTransport> {
  const t = new DurableTransport({ url: 'http://mq:3004', retryBaseMs: 1, ...config });
  await t.connect();
  return t;
}

describe('DurableTransport.publish — network-error retry arm', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('retries a transient network error and succeeds on a later attempt', async () => {
    let posts = 0;
    const f = fetchMock(() => {
      posts++;
      if (posts < 3) throw new Error('ECONNRESET');
      return okRes;
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 3 });
    await expect(t.publish('job-queued', envelope())).resolves.toBeUndefined();

    expect(posts).toBe(3);
    expect(t.getMetrics('job-queued')).toMatchObject({ sent: 1, failed: 0 });
  });

  it('exhausts retries on a persistent network error and reports the attempt count', async () => {
    const f = fetchMock(() => {
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 3 });
    await expect(t.publish('job-queued', envelope())).rejects.toThrow(
      /failed after 3 attempts: Queue request TransportError/,
    );
    expect(t.getMetrics('job-queued')).toMatchObject({ sent: 0, failed: 1 });
  });

  it('honours retryAttempts:1 — a network error fails immediately with no retry', async () => {
    let posts = 0;
    const f = fetchMock(() => {
      posts++;
      throw new Error('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 1 });
    await expect(t.publish('job-queued', envelope())).rejects.toThrow(/failed after 1 attempts/);
    expect(posts).toBe(1);
  });

  it('recovers from a network error followed by a 500 followed by success', async () => {
    const script: Array<'throw' | 'fail' | 'ok'> = ['throw', 'fail', 'ok'];
    let i = 0;
    const f = fetchMock(() => {
      const step = script[i++];
      if (step === 'throw') throw new Error('socket hang up');
      if (step === 'fail') return queueResponse(500, 'boom', {});
      return okRes;
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 3 });
    await expect(t.publish('job-queued', envelope())).resolves.toBeUndefined();
    expect(i).toBe(3);
    expect(t.getMetrics('job-queued')).toMatchObject({ sent: 1 });
  });

  it('refuses to publish before connect()', async () => {
    vi.stubGlobal('fetch', fetchMock(() => okRes));
    const t = new DurableTransport({ url: 'http://mq:3004' });
    await expect(t.publish('job-queued', envelope())).rejects.toThrow('not connected');
  });
});

describe('DurableTransport.publish — 429 backpressure / Retry-After parsing', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    DurableTransport.resetBackpressureCounters();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    DurableTransport.resetBackpressureCounters();
  });

  it('falls back to exponential backoff when Retry-After is unparseable', async () => {
    let posts = 0;
    const f = fetchMock(() => {
      posts++;
      if (posts === 1) return queueResponse(429, {}, { 'retry-after': 'whenever' });
      return okRes;
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 2, retryBaseMs: 1 });
    await expect(t.publish('job-queued', envelope())).resolves.toBeUndefined();

    // The garbage header must not become NaN ms — a NaN sleep would resolve
    // immediately and spin the retry loop, so assert the publish completed
    // and the backpressure was still observed.
    expect(posts).toBe(2);
    expect(DurableTransport.getBackpressureCount('job-queued')).toBe(1);
  });

  it('treats an HTTP-date Retry-After already in the past as zero wait', async () => {
    let posts = 0;
    const past = new Date(Date.now() - 60_000).toUTCString();
    const f = fetchMock(() => {
      posts++;
      if (posts === 1) return queueResponse(429, {}, { 'retry-after': past });
      return okRes;
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 2, retryBaseMs: 1 });
    const started = Date.now();
    await expect(t.publish('job-queued', envelope())).resolves.toBeUndefined();

    expect(posts).toBe(2);
    // Zero wait (times a [0.5,1) jitter) is still zero.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('counts backpressure per queue, and getBackpressureCount() with no arg returns the full map', async () => {
    const f = fetchMock(() => (queueResponse(429, {}, { 'retry-after': '0' })));
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 2, retryBaseMs: 1 });
    await t.publish('queue-a', envelope()).catch(() => {});
    await t.publish('queue-b', envelope()).catch(() => {});

    // retryAttempts:2 ⇒ two 429s observed per publish.
    expect(DurableTransport.getBackpressureCount('queue-a')).toBe(2);
    expect(DurableTransport.getBackpressureCount('never-published')).toBe(0);

    const all = DurableTransport.getBackpressureCount() as Map<string, number>;
    expect(all).toBeInstanceOf(Map);
    expect(all.get('queue-a')).toBe(2);
    expect(all.get('queue-b')).toBe(2);

    // The returned map is a snapshot — mutating it must not corrupt state.
    all.set('queue-a', 999);
    expect(DurableTransport.getBackpressureCount('queue-a')).toBe(2);
  });

  it('gives up after maxAttempts of sustained 429 and records a failure', async () => {
    const f = fetchMock(() => (queueResponse(429, {}, { 'retry-after': '0' })));
    vi.stubGlobal('fetch', f);

    const t = await connected({ retryAttempts: 2, retryBaseMs: 1 });
    await expect(t.publish('job-queued', envelope())).rejects.toThrow(
      /failed after 2 attempts: Queue POST request failed \(429/,
    );
    expect(t.getMetrics('job-queued')).toMatchObject({ failed: 1 });
  });
});

describe('DurableTransport.disconnect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborts in-flight pollers and drops them from the active set', async () => {
    const aborts: boolean[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit & { signal?: AbortSignal }) => {
      if (init?.method === 'PUT') return putOk;
      if (String(url).endsWith('/ready')) return queueResponse(200, { status: 'ready' });
      // Poll GET — record whether the signal was already aborted.
      aborts.push(Boolean(init?.signal?.aborted));
      return queueResponse(200, { messages: [] });
    });
    vi.stubGlobal('fetch', f);

    const t = await connected();
    t.subscribe('job-queued', async () => {});
    await new Promise(r => setImmediate(r));

    await t.disconnect();
    expect(t.isConnected()).toBe(false);

    // A second disconnect on an already-drained poller set is a no-op.
    await expect(t.disconnect()).resolves.toBeUndefined();
  });
});

describe('DurableTransport poll loop — failure arms', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('logs and keeps polling when the queue GET returns a non-2xx status', async () => {
    let polls = 0;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return putOk;
      if (String(url).endsWith('/ready')) return queueResponse(200, { status: 'ready' });
      polls++;
      return queueResponse(503, {});
    });
    vi.stubGlobal('fetch', f);

    const t = await connected();
    const cancel = t.subscribe('job-queued', async () => {}, { pollingInterval: 1 });

    // RetryManager burns 3 attempts per loop iteration before the loop
    // logs and sleeps; give it room for at least one full cycle.
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(3), { timeout: 8_000 });
    expect(errSpy.mock.calls.flat().join(' ')).toContain('poll failed');

    cancel();
    await t.disconnect();
  }, 15_000);

  it('records malformed JSON without deleting its source once attempts are exhausted', async () => {
    const deleted: string[] = [];
    let served = false;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PUT') return putOk;
      if (u.endsWith('/ready')) return queueResponse(200, { status: 'ready' });
      if (init?.method === 'DELETE') {
        deleted.push(u);
        return queueResponse(200, { success: true });
      }
      if (served) return queueResponse(200, { messages: [] });
      served = true;
      return queueResponse(200, {
          messages: [{ message_id: 'm-bad', body: '{not json', approximate_receive_count: 1, receipt_handle: 'r-1' }],
        });
    });
    vi.stubGlobal('fetch', f);

    // maxProcessingAttempts:1 ⇒ the first parse failure dead-letters.
    const t = await connected({ maxProcessingAttempts: 1 });
    const seen: EventEnvelope[] = [];
    const cancel = t.subscribe('job-queued', async e => { seen.push(e); }, { pollingInterval: 5 });

    await vi.waitFor(() => expect(t.getDLQ()).toHaveLength(1), { timeout: 5_000 });

    const [dead] = t.getDLQ();
    expect(seen).toHaveLength(0);
    expect(dead!.messageId).toBe('m-bad');
    expect(dead!.attempts).toBe(1);
    // Body was unparseable, so the synthesised envelope carries the raw text.
    expect(dead!.envelope.eventName).toBe('unknown');
    expect(dead!.envelope.payload).toBe('{not json');
    // Broker redrive owns removal; a diagnostic cannot commit that transfer.
    expect(deleted).toEqual([]);

    cancel();
    await t.disconnect();
  }, 15_000);

  it('evicts the oldest entries when the dead-letter ring hits dlqCapacity', async () => {
    let batch = 0;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return putOk;
      if (String(url).endsWith('/ready')) return queueResponse(200, { status: 'ready' });
      if (init?.method === 'DELETE') return queueResponse(200, { success: true });
      if (batch >= 4) return queueResponse(200, { messages: [] });
      const id = `m-${batch++}`;
      return queueResponse(200, {
          messages: [{ message_id: id, body: JSON.stringify(envelope()), approximate_receive_count: 1, receipt_handle: `r-${id}` }],
        });
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ maxProcessingAttempts: 1, dlqCapacity: 2 });
    const cancel = t.subscribe('job-queued', async () => {
      throw new Error('handler always fails');
    }, { pollingInterval: 5 });

    await vi.waitFor(() => expect(batch).toBe(4), { timeout: 5_000 });
    await vi.waitFor(() => expect(t.getDLQ().map(m => m.messageId)).toEqual(['m-2', 'm-3']), {
      timeout: 5_000,
    });

    // Ring stays bounded and keeps the NEWEST failures.
    expect(t.getDLQ()).toHaveLength(2);

    // drainDLQ empties the ring and hands back a detached copy.
    const drained = t.drainDLQ();
    expect(drained).toHaveLength(2);
    expect(t.getDLQ()).toHaveLength(0);
    drained.length = 0;
    expect(t.getDLQ()).toHaveLength(0);

    cancel();
    await t.disconnect();
  }, 15_000);

  it('a throwing dead-letter callback does not stop the other callbacks or the loop', async () => {
    let served = false;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return putOk;
      if (String(url).endsWith('/ready')) return queueResponse(200, { status: 'ready' });
      if (init?.method === 'DELETE') return queueResponse(200, { success: true });
      if (served) return queueResponse(200, { messages: [] });
      served = true;
      return queueResponse(200, {
          messages: [{ message_id: 'm-1', body: JSON.stringify(envelope()), approximate_receive_count: 1, receipt_handle: 'r-1' }],
        });
    });
    vi.stubGlobal('fetch', f);

    const t = await connected({ maxProcessingAttempts: 1 });
    const second = vi.fn();
    const unsubFirst = t.onDeadLetter(() => { throw new Error('sink exploded'); });
    t.onDeadLetter(second);

    const cancel = t.subscribe('job-queued', async () => { throw new Error('nope'); }, { pollingInterval: 5 });

    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(t.getDLQ()).toHaveLength(1);

    // The returned disposer actually detaches the callback.
    unsubFirst();
    expect(t.getMetrics('job-queued')).toMatchObject({ failed: 1, inFlight: 0 });

    cancel();
    await t.disconnect();
  }, 15_000);
});

describe('DurableTransport.getQueueAttributes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null on a non-2xx response and on a network error, and the body on success', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const t = new DurableTransport({ url: 'http://mq:3004' });

    f.mockResolvedValueOnce(queueResponse(200, { attributes: { approximate_number_of_messages: 7 } }));
    expect(await t.getQueueAttributes('q')).toEqual({ approximate_number_of_messages: 7 });

    f.mockResolvedValueOnce(queueResponse(404, {}));
    expect(await t.getQueueAttributes('q')).toBeNull();

    f.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await t.getQueueAttributes('q')).toBeNull();
  });
});
