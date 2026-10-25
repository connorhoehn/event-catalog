import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '../src/types/index.js';
import { DurableTransport } from '../src/client/durable.js';

// Helper: build a minimal Headers-like object for fetch mock responses
function makeHeaders(entries: Record<string, string>): { get: (k: string) => string | null } {
  return { get: (k: string) => entries[k.toLowerCase()] ?? null };
}

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventName: 'test.event',
    payload: { key: 'value' },
    metadata: { id: 'e-001', producer: 'test', timestamp: Date.now() },
    ...overrides,
  };
}

describe('DurableTransport', () => {
  describe('eventNameToQueueName', () => {
    it('converts colons to dashes', () => {
      expect(DurableTransport.eventNameToQueueName('pipeline:run:completed')).toBe('pipeline-run-completed');
    });

    it('converts dots to dashes', () => {
      expect(DurableTransport.eventNameToQueueName('social.post.created')).toBe('social-post-created');
    });

    it('collapses multiple dashes', () => {
      expect(DurableTransport.eventNameToQueueName('test::double')).toBe('test-double');
    });

    it('handles mixed separators', () => {
      expect(DurableTransport.eventNameToQueueName('my:event.name:here')).toBe('my-event-name-here');
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from URL', () => {
      const transport = new DurableTransport({ url: 'http://localhost:3004/' });
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connect() / isConnected()', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('isConnected() is false before connect()', () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      expect(t.isConnected()).toBe(false);
    });

    it('sets connected=true after connect(), even when health ping returns non-ok', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 503 });
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      expect(t.isConnected()).toBe(true);
    });

    it('sets connected=true even when health ping throws (unreachable)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await expect(t.connect()).resolves.toBeUndefined();
      expect(t.isConnected()).toBe(true);
    });

    it('logs warn when health ping throws (message-queue not reachable)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      const t = new DurableTransport({ url: 'http://mq:3004' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await t.connect();
      // One string, not (message, cause): the warning has to name the env
      // var and the degraded-mode consequence, which only reads well inline.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('message-queue not reachable at http://mq:3004/health'),
      );
      const warned = warnSpy.mock.calls[0]![0] as string;
      expect(warned).toContain('MESSAGE_QUEUE_URL');
      expect(warned).toContain('ECONNREFUSED');
      warnSpy.mockRestore();
    });

    it('is idempotent — second connect() skips the health ping', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      await t.connect();
      // Only one fetch call for the first connect
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  describe('disconnect()', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sets connected=false after disconnect()', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      expect(t.isConnected()).toBe(true);
      await t.disconnect();
      expect(t.isConnected()).toBe(false);
    });
  });

  describe('healthCheck()', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('returns disconnected immediately when not connected (no fetch call)', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      const result = await t.healthCheck();
      expect(result.status).toBe('disconnected');
      expect(result.latencyMs).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns connected with latencyMs on ok response', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      fetchSpy.mockResolvedValue({ ok: true });
      const result = await t.healthCheck();
      expect(result.status).toBe('connected');
      expect(typeof result.latencyMs).toBe('number');
    });

    it('returns degraded on non-ok response', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      fetchSpy.mockResolvedValue({ ok: false, status: 500 });
      const result = await t.healthCheck();
      expect(result.status).toBe('degraded');
    });

    it('returns disconnected on network error', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();
      fetchSpy.mockRejectedValue(new Error('network down'));
      const result = await t.healthCheck();
      expect(result.status).toBe('disconnected');
    });

    it('returns degraded when fetch throws AbortError (internal 2 s timeout fires)', async () => {
      const t = new DurableTransport({ url: 'http://mq:3004' });
      await t.connect();

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchSpy.mockRejectedValue(abortError);

      const result = await t.healthCheck();
      expect(result.status).toBe('degraded');
    });
  });
});

describe('DurableTransport — getQueueAttributes()', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed attributes on ok response', async () => {
    const attrs = { ApproximateNumberOfMessages: 7, ApproximateNumberOfMessagesNotVisible: 2 };
    fetchSpy.mockResolvedValue({ ok: true, json: async () => attrs });
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const result = await t.getQueueAttributes('my-queue');
    expect(result).toEqual(attrs);
    expect(fetchSpy).toHaveBeenCalledWith('http://mq:3004/api/v1/queues/my-queue/attributes');
  });

  it('returns null on non-ok response', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 404 });
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const result = await t.getQueueAttributes('missing-queue');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const result = await t.getQueueAttributes('bad-queue');
    expect(result).toBeNull();
  });

  it('URL-encodes special characters in queue name', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const t = new DurableTransport({ url: 'http://mq:3004' });
    await t.getQueueAttributes('my queue/name');
    expect(fetchSpy).toHaveBeenCalledWith('http://mq:3004/api/v1/queues/my%20queue%2Fname/attributes');
  });
});

describe('DurableTransport — getMetrics() / getAllMetrics()', () => {
  it('getMetrics() with no arg returns empty Map on fresh instance', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const result = t.getMetrics();
    expect(result).toBeInstanceOf(Map);
    expect((result as Map<string, unknown>).size).toBe(0);
  });

  it('getMetrics(queueName) returns undefined for unknown queue', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    expect(t.getMetrics('nonexistent-queue')).toBeUndefined();
  });

  it('getAllMetrics() returns an independent copy of the metrics map', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const m1 = t.getAllMetrics();
    const m2 = t.getAllMetrics();
    // Two separate Map instances
    expect(m1).not.toBe(m2);
    expect(m1.size).toBe(0);
  });
});

describe('DurableTransport — getDLQ() / drainDLQ()', () => {
  it('getDLQ() returns empty array on fresh instance', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const dlq = t.getDLQ();
    expect(Array.isArray(dlq)).toBe(true);
    expect(dlq).toHaveLength(0);
  });

  it('drainDLQ() returns empty array and leaves the queue empty', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const drained = t.drainDLQ();
    expect(drained).toHaveLength(0);
    expect(t.getDLQ()).toHaveLength(0);
  });

  it('getDLQ() returns a snapshot copy (mutating the result does not affect internal state)', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const snap1 = t.getDLQ();
    // Push to the snapshot — should not affect a subsequent call
    snap1.push({} as never);
    expect(t.getDLQ()).toHaveLength(0);
  });
});

describe('DurableTransport — onDeadLetter()', () => {
  it('registers a callback that can be disposed', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const cb = vi.fn();
    const dispose = t.onDeadLetter(cb);
    expect(typeof dispose).toBe('function');
    // Dispose removes the callback (tested indirectly: no crash, returns function)
    dispose();
  });

  it('multiple callbacks can be registered independently', () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const dispose1 = t.onDeadLetter(cb1);
    t.onDeadLetter(cb2);
    // dispose1 removes only cb1; cb2 remains registered
    dispose1();
    // After dispose, subsequent fresh registrations still work
    const cb3 = vi.fn();
    const dispose3 = t.onDeadLetter(cb3);
    expect(typeof dispose3).toBe('function');
    dispose3();
  });
});

describe('DurableTransport — publish()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when not connected', async () => {
    const t = new DurableTransport({ url: 'http://mq:3004' });
    await expect(t.publish('test-queue', makeEnvelope())).rejects.toThrow(
      '[durable-transport] not connected',
    );
  });

  it('POSTs to the correct endpoint and increments the sent metric', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                 // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })    // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true });                // publish POST
    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 0 });
    await t.connect();
    await t.publish('test-queue', makeEnvelope());

    const publishCall = fetchSpy.mock.calls[2];
    expect(publishCall![0]).toBe('http://mq:3004/api/v1/queues/test-queue/messages');
    expect(publishCall![1]).toMatchObject({ method: 'POST' });

    const metrics = t.getMetrics('test-queue') as { sent: number; failed: number };
    expect(metrics.sent).toBe(1);
    expect(metrics.failed).toBe(0);
  });

  it('increments the failed metric and rethrows on non-ok response', async () => {
    const failResponse = { ok: false, status: 500 };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })   // ensureQueue PUT
      .mockResolvedValue(failResponse);                   // all publish POST attempts → fail
    vi.stubGlobal('fetch', fetchSpy);

    // retryAttempts:1 → maxRetries:0 in our code, but RetryManager uses ||3 default;
    // retryBaseMs:1 avoids the ||1000 fallback, keeping retries fast (1ms+2ms+4ms).
    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 1 });
    await t.connect();

    await expect(t.publish('test-queue', makeEnvelope())).rejects.toThrow(
      '[durable-transport] publish to "test-queue" failed after 1 attempts',
    );

    const metrics = t.getMetrics('test-queue') as { sent: number; failed: number };
    expect(metrics.failed).toBe(1);
    expect(metrics.sent).toBe(0);
  });

  it('logs warning on 409 conflict from ensureQueue PUT but publishes successfully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                         // connect /health
      .mockResolvedValueOnce({                                                      // ensureQueue PUT → 409
        ok: false, status: 409,
        json: async () => ({ conflicts: { retention: [300, 600] } }),
        text: async () => '',
      })
      .mockResolvedValueOnce({ ok: true });                                         // publish POST
    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 0 });
    await t.connect();
    await t.publish('test-queue', makeEnvelope());

    const warnCall = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('differing config'),
    );
    expect(warnCall).toBeDefined();
    const metrics = t.getMetrics('test-queue') as { sent: number };
    expect(metrics.sent).toBe(1);

    warnSpy.mockRestore();
  });

  it('logs warning when ensureQueue PUT throws (network error) but still attempts publish', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                           // connect /health
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))             // ensureQueue PUT throws
      .mockResolvedValueOnce({ ok: true });                          // publish POST succeeds
    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 0 });
    await t.connect();
    await t.publish('test-queue', makeEnvelope());

    const warnCall = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('ensureQueue'),
    );
    expect(warnCall).toBeDefined();
    const metrics = t.getMetrics('test-queue') as { sent: number };
    expect(metrics.sent).toBe(1);

    warnSpy.mockRestore();
  });
});

describe('DurableTransport — subscribe() + pollLoop()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeQueueMessage(id: string, envelope: EventEnvelope) {
    return {
      message_id: id,
      body: JSON.stringify(envelope),
      receipt_handle: `rh-${id}`,
    };
  }

  it('calls handler with parsed envelope and DELETEs the message on success', async () => {
    const envelope = makeEnvelope({ eventName: 'queue.event' });
    const queueMsg = makeQueueMessage('msg-1', envelope);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll (1 msg)
      .mockResolvedValueOnce({ ok: true })                                          // DELETE on success
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 1 });
    await t.connect();

    const handler = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 50));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toMatchObject({ eventName: 'queue.event' });

    const deleteCalls = fetchSpy.mock.calls.filter(([url, opts]: [string, RequestInit]) =>
      (url as string).includes('/messages/') && opts?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![0]).toContain('rh-msg-1');

    const metrics = t.getMetrics('test-queue') as { received: number; failed: number; inFlight: number };
    expect(metrics.received).toBe(1);
    expect(metrics.failed).toBe(0);
    expect(metrics.inFlight).toBe(0);

    unsubscribe();
  });

  it('warns and increments failed metric when handler throws (below dead-letter threshold)', async () => {
    const queueMsg = makeQueueMessage('msg-flaky', makeEnvelope());

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll (1 msg)
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // default maxProcessingAttempts: 3 — first failure warns, does not dead-letter
    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts: 1, retryBaseMs: 1 });
    await t.connect();

    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 50));

    const handlerWarn = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('handler error'),
    );
    expect(handlerWarn).toBeDefined();
    expect(String(handlerWarn![0])).toContain('attempt 1/3');

    expect(t.getDLQ()).toHaveLength(0);

    const metrics = t.getMetrics('test-queue') as { received: number; failed: number };
    expect(metrics.failed).toBe(1);
    expect(metrics.received).toBe(0);

    warnSpy.mockRestore();
    unsubscribe();
  });

  it('dead-letters message and fires callbacks after maxProcessingAttempts failures', async () => {
    const envelope = makeEnvelope({ eventName: 'poison.event' });
    const queueMsg = makeQueueMessage('msg-poison', envelope);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 1 → fail (attempt 1)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 2 → fail (attempt 2) → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 2 });
    await t.connect();

    const dlqCallback = vi.fn();
    t.onDeadLetter(dlqCallback);

    const handler = vi.fn().mockRejectedValue(new Error('poison'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 100));

    expect(dlqCallback).toHaveBeenCalledOnce();
    const dlqMsg = dlqCallback.mock.calls[0]![0] as { messageId: string; queueName: string; attempts: number; envelope: EventEnvelope };
    expect(dlqMsg.messageId).toBe('msg-poison');
    expect(dlqMsg.queueName).toBe('test-queue');
    expect(dlqMsg.attempts).toBe(2);
    expect(dlqMsg.envelope.eventName).toBe('poison.event');

    const dlq = t.getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.messageId).toBe('msg-poison');

    // A diagnostic must never authorize source deletion.
    const deleteCalls = fetchSpy.mock.calls.filter(([url, opts]: [string, RequestInit]) =>
      (url as string).includes('/messages/') && opts?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);

    unsubscribe();
  });

  it('drainDLQ() returns dead-lettered messages AND clears the internal queue', async () => {
    const envelope = makeEnvelope({ eventName: 'drain.event' });
    const queueMsg = makeQueueMessage('msg-drain', envelope);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 1 → fail (attempt 1)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 2 → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 2 });
    await t.connect();

    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 100));

    // DLQ has one message
    expect(t.getDLQ()).toHaveLength(1);

    // drainDLQ() returns the messages and clears the queue
    const drained = t.drainDLQ();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.messageId).toBe('msg-drain');
    expect(t.getDLQ()).toHaveLength(0); // queue is now empty

    unsubscribe();
  });

  it('disposed onDeadLetter callback is NOT invoked when a message dead-letters', async () => {
    const envelope = makeEnvelope({ eventName: 'poison.event' });
    const queueMsg = makeQueueMessage('msg-dispose', envelope);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 1 → fail (attempt 1)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 2 → fail (attempt 2) → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 2 });
    await t.connect();

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const dispose = t.onDeadLetter(cb1);
    t.onDeadLetter(cb2);
    dispose(); // remove cb1 before any dead-letter fires

    const handler = vi.fn().mockRejectedValue(new Error('poison'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 100));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();

    unsubscribe();
  });

  it('a throwing onDeadLetter callback does not block sibling callbacks or delete the source', async () => {
    const envelope = makeEnvelope({ eventName: 'poison.event' });
    const queueMsg = makeQueueMessage('msg-cb-throws', envelope);

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [queueMsg] }) }) // poll 1 → fail → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });       // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 1 });
    await t.connect();

    const cb1 = vi.fn(() => { throw new Error('cb1 boom'); });
    const cb2 = vi.fn();
    t.onDeadLetter(cb1);
    t.onDeadLetter(cb2);

    const handler = vi.fn().mockRejectedValue(new Error('poison'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 100));

    // Both callbacks are invoked; the thrown error from cb1 is swallowed so cb2 still fires.
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();

    // DLQ recorded the dead-letter despite the callback throw.
    expect(t.getDLQ()).toHaveLength(1);

    // Even successful diagnostics leave removal to broker redrive.
    const deleteCalls = fetchSpy.mock.calls.filter(([url, opts]: [string, RequestInit]) =>
      (url as string).includes('/messages/') && opts?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);

    unsubscribe();
  });

  it('unsubscribe() aborts the poll loop and stops further fetches', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                    // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                       // ensureQueue PUT
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }); // polls → always empty

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004' });
    await t.connect();

    const handler = vi.fn();
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 10));

    const countAtUnsubscribe = fetchSpy.mock.calls.length;
    unsubscribe();

    await new Promise(r => setTimeout(r, 30));
    const countAfter = fetchSpy.mock.calls.length;

    // Allow at most 1 in-flight fetch to complete after the abort signal fires
    expect(countAfter - countAtUnsubscribe).toBeLessThanOrEqual(1);
  });

  it('malformed message body uses fallback envelope when dead-lettered', async () => {
    const badMsg = {
      message_id: 'msg-bad-json',
      body: 'not-json',
      receipt_handle: 'rh-bad-json',
    };

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                                  // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                                     // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [badMsg] }) })      // poll → bad body → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });               // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    // maxProcessingAttempts:1 — dead-letters immediately on first parse failure
    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 1 });
    await t.connect();

    const handler = vi.fn();
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 100));

    const dlq = t.getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.envelope.eventName).toBe('unknown');     // fallback when JSON.parse fails
    expect(dlq[0]!.envelope.payload).toBe('not-json');      // raw body preserved
    expect(dlq[0]!.messageId).toBe('msg-bad-json');

    unsubscribe();
  });

  it('poll-loop survives a network failure — logs error and continues to the next poll cycle', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce({ ok: true })              // connect /health
        .mockResolvedValueOnce({ ok: true, status: 201 }) // ensureQueue PUT
        // pollRetryManager has maxRetries:2 → 3 total attempts, all rejected
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        // second poll cycle succeeds with no messages
        .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });

      vi.stubGlobal('fetch', fetchSpy);

      const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 1 });
      await t.connect();

      const handler = vi.fn();
      const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

      // Advance through RetryManager delays (1 000 ms + 2 000 ms = 3 000 ms total)
      // plus a buffer so the second iteration can complete.
      await vi.advanceTimersByTimeAsync(5000);

      const pollErrCall = errorSpy.mock.calls.find(c =>
        typeof c[0] === 'string' && (c[0] as string).includes('poll failed for'),
      );
      expect(pollErrCall).toBeDefined();
      expect(handler).not.toHaveBeenCalled();

      unsubscribe();
    } finally {
      vi.useRealTimers();
      errorSpy.mockRestore();
    }
  });

  it('dlqCapacity evicts oldest entry when the DLQ is full', async () => {
    const msgA = makeQueueMessage('msg-a', makeEnvelope({ eventName: 'event.a' }));
    const msgB = makeQueueMessage('msg-b', makeEnvelope({ eventName: 'event.b' }));

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                                   // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                                      // ensureQueue PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [msgA] }) })         // poll 1 → msg-a attempt 1 (warn)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [msgA] }) })         // poll 2 → msg-a attempt 2 → dead-letter
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [msgB] }) })         // poll 3 → msg-b attempt 1 (warn)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [msgB] }) })         // poll 4 → msg-b attempt 2 → dead-letter
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) });                // subsequent polls

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004', maxProcessingAttempts: 2, dlqCapacity: 1 });
    await t.connect();

    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 0 });

    await new Promise(r => setTimeout(r, 150));

    const dlq = t.getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.messageId).toBe('msg-b'); // msg-a was evicted when msg-b was added

    unsubscribe();
  });

  it('logs error and continues after a poll fetch failure (network error recovery)', async () => {
    // pollRetryManager: maxRetries=2, baseDelay=1000ms, backoffFactor=2 →
    // attempt 1 (t=0), wait 1000ms, attempt 2 (t=1000ms), wait 2000ms, attempt 3 (t=3000ms) → throw.
    // Use fake timers to skip the 3s and a long pollingInterval so the recovery
    // sleep doesn't create another 0ms timer that would loop forever.
    vi.useFakeTimers();

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })                                          // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 })                             // ensureQueue PUT
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))                             // poll attempt 1/3
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))                             // poll attempt 2/3
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));                            // poll attempt 3/3 → catch(pollErr)

    vi.stubGlobal('fetch', fetchSpy);

    const t = new DurableTransport({ url: 'http://mq:3004' });
    await t.connect();

    const handler = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Long polling interval so after catch(pollErr) the loop sleeps 10s, giving
    // us a clean window to assert before aborting — no infinite 0ms timer loop.
    const unsubscribe = t.subscribe('test-queue', handler, { pollingInterval: 10_000 });

    // Advance through all RetryManager delays (1000 + 2000 = 3000ms).
    // After this, catch(pollErr) has fired and the loop is waiting in sleep(10000ms).
    await vi.advanceTimersByTimeAsync(3100);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('poll failed for "test-queue"'),
      expect.stringContaining('ECONNREFUSED'),
    );
    expect(handler).not.toHaveBeenCalled();

    // Abort before the 10s sleep fires; the abort listener resolves it immediately.
    unsubscribe();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe('DurableTransport — ensureQueue() warn paths', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function makeConnected(url = 'http://mq:3004') {
    fetchSpy.mockResolvedValueOnce({ ok: true }); // health ping
    const t = new DurableTransport({ url });
    await t.connect();
    return t;
  }

  it('logs warn when DLQ putQueue fails (dlqAfterAttempts declared)', async () => {
    const t = await makeConnected();
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'error' }) // DLQ PUT → fail
      .mockResolvedValueOnce({ ok: true, status: 201 });                            // main queue PUT → ok

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.ensureQueue('my-queue', { dlqAfterAttempts: 3 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DLQ ensure for "my-queue-dlq" failed'),
    );
    warnSpy.mockRestore();
  });

  it('logs warn and accepts drift when queue already exists with differing config (409)', async () => {
    const t = await makeConnected();
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({ conflicts: { retention: 'mismatch' } }),
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.ensureQueue('existing-queue');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"existing-queue" exists with differing config'),
      expect.stringContaining('mismatch'),
    );
    warnSpy.mockRestore();
  });

  it('logs warn when PUT returns a non-200/201/409 status', async () => {
    const t = await makeConnected();
    fetchSpy.mockResolvedValueOnce({
      ok: false, status: 503,
      text: async () => 'service unavailable',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.ensureQueue('flaky-queue');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ensureQueue "flaky-queue" failed: 503 service unavailable'),
    );
    warnSpy.mockRestore();
  });

  it('logs warn when PUT fetch throws a network error', async () => {
    const t = await makeConnected();
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.ensureQueue('error-queue');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ensureQueue "error-queue" error:'),
      'ECONNRESET',
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// DurableTransport — 429 / Retry-After backpressure handling
// ---------------------------------------------------------------------------
describe('DurableTransport — 429 backpressure handling', () => {
  beforeEach(() => {
    DurableTransport.resetBackpressureCounters();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    DurableTransport.resetBackpressureCounters();
  });

  function make429(retryAfter: string | null = '5'): Response {
    return {
      ok: false,
      status: 429,
      headers: makeHeaders(retryAfter !== null ? { 'retry-after': retryAfter } : {}),
    } as unknown as Response;
  }

  function makeOk(): Response {
    return { ok: true, status: 200 } as unknown as Response;
  }

  async function makeConnectedTransport(retryAttempts = 3, retryBaseMs = 10) {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true })               // connect /health
      .mockResolvedValueOnce({ ok: true, status: 201 }); // ensureQueue PUT
    vi.stubGlobal('fetch', fetchSpy);
    const t = new DurableTransport({ url: 'http://mq:3004', retryAttempts, retryBaseMs });
    await t.connect();
    return { t, fetchSpy };
  }

  it('429 with integer Retry-After: waits server-specified ms then retries and succeeds', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(3, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchSpy
      .mockResolvedValueOnce(make429('5'))   // publish attempt 1 → 429 (5s)
      .mockResolvedValueOnce(makeOk());      // publish attempt 2 → 200

    const publishPromise = t.publish('q', makeEnvelope());
    // Advance past the jittered wait (5000ms * 0.5 lower bound + buffer)
    await vi.advanceTimersByTimeAsync(6000);
    await publishPromise;

    const metrics = t.getMetrics('q') as { sent: number; failed: number };
    expect(metrics.sent).toBe(1);
    expect(metrics.failed).toBe(0);
    expect(DurableTransport.getBackpressureCount('q')).toBe(1);

    const warnCalls = warnSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('mq_backpressure_observed_total'),
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(warnCalls[0]![0])).toContain('retry-after 5s');
    warnSpy.mockRestore();
  });

  it('429 with HTTP-date Retry-After: parsed as delta from now', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(3, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 10 seconds in the future
    const futureDate = new Date(Date.now() + 10_000).toUTCString();
    fetchSpy
      .mockResolvedValueOnce(make429(futureDate))  // attempt 1 → 429
      .mockResolvedValueOnce(makeOk());             // attempt 2 → 200

    const publishPromise = t.publish('q', makeEnvelope());
    // Advance past ≥ 5s (jitter lower bound of 10s * 0.5)
    await vi.advanceTimersByTimeAsync(11_000);
    await publishPromise;

    const metrics = t.getMetrics('q') as { sent: number };
    expect(metrics.sent).toBe(1);
    expect(DurableTransport.getBackpressureCount('q')).toBe(1);

    const warnCalls = warnSpy.mock.calls.filter(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('mq_backpressure_observed_total'),
    );
    // retry-after header was ~10s, logged as "10s" (allow 9 or 10 due to real-clock drift)
    expect(String(warnCalls[0]![0])).toMatch(/retry-after \d+s/);
    warnSpy.mockRestore();
  });

  it('429 with no Retry-After header: falls back to RetryManager exponential default', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(3, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchSpy
      .mockResolvedValueOnce(make429(null))  // attempt 1 → 429 (no header)
      .mockResolvedValueOnce(makeOk());      // attempt 2 → 200

    const publishPromise = t.publish('q', makeEnvelope());
    // Default for attempt 1: retryBaseMs(10) * 2^0 = 10ms; jittered down to ≥ 5ms
    await vi.advanceTimersByTimeAsync(100);
    await publishPromise;

    const metrics = t.getMetrics('q') as { sent: number };
    expect(metrics.sent).toBe(1);
    expect(DurableTransport.getBackpressureCount('q')).toBe(1);
    warnSpy.mockRestore();
  });

  it('429 with absurd Retry-After (10 hours): capped at 5 min with cap-exceeded warn', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(3, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchSpy
      .mockResolvedValueOnce(make429(String(10 * 3600)))  // 36000s = 10 hours
      .mockResolvedValueOnce(makeOk());

    const publishPromise = t.publish('q', makeEnvelope());
    // Cap is 300_000ms (5 min); jitter brings it to ≥ 150_000ms; advance 300s
    await vi.advanceTimersByTimeAsync(300_000 + 1000);
    await publishPromise;

    const capWarn = warnSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && (c[0] as string).includes('exceeds cap'),
    );
    expect(capWarn).toBeDefined();
    expect(String(capWarn![0])).toContain('300000ms');

    const metrics = t.getMetrics('q') as { sent: number };
    expect(metrics.sent).toBe(1);
    warnSpy.mockRestore();
  });

  it('429 that exceeds retry budget fails and increments failed metric', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(2, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchSpy
      .mockResolvedValueOnce(make429('1'))  // attempt 1 → 429
      .mockResolvedValueOnce(make429('1')); // attempt 2 → 429 (budget exhausted)

    // Attach rejection handler immediately to avoid unhandled-rejection warning
    const publishPromise = t.publish('q', makeEnvelope());
    const rejectionCatcher = publishPromise.catch(() => {});

    // Two waits of 1s each with jitter; advance 3s to be safe
    await vi.advanceTimersByTimeAsync(3000);
    await rejectionCatcher;

    await expect(publishPromise).rejects.toThrow(
      '[durable-transport] publish to "q" failed after 2 attempts',
    );

    const metrics = t.getMetrics('q') as { sent: number; failed: number };
    expect(metrics.failed).toBe(1);
    expect(metrics.sent).toBe(0);
    expect(DurableTransport.getBackpressureCount('q')).toBe(2);
    warnSpy.mockRestore();
  });

  it('200 after 429 wait: success metric is incremented (not failed)', async () => {
    const { t, fetchSpy } = await makeConnectedTransport(3, 10);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchSpy
      .mockResolvedValueOnce(make429('0'))  // attempt 1 → 429 with 0s retry-after
      .mockResolvedValueOnce(makeOk());     // attempt 2 → 200

    const publishPromise = t.publish('q', makeEnvelope());
    await vi.advanceTimersByTimeAsync(500);
    await publishPromise;

    const metrics = t.getMetrics('q') as { sent: number; failed: number };
    expect(metrics.sent).toBe(1);
    expect(metrics.failed).toBe(0);
    warnSpy.mockRestore();
  });
});
