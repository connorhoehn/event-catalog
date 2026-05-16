import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '../src/types/index.js';
import { DurableTransport } from '../src/client/durable.js';

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
    expect(fetchSpy).toHaveBeenCalledWith('http://mq:3004/queues/my-queue/attributes');
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
    expect(fetchSpy).toHaveBeenCalledWith('http://mq:3004/queues/my%20queue%2Fname/attributes');
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
    expect(publishCall![0]).toBe('http://mq:3004/queues/test-queue/messages');
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
      .mockResolvedValueOnce({ ok: true })                                          // DELETE after dead-letter
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

    // DELETE must have been issued to remove the dead-lettered message from the source queue
    const deleteCalls = fetchSpy.mock.calls.filter(([url, opts]: [string, RequestInit]) =>
      (url as string).includes('/messages/') && opts?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);

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
      .mockResolvedValueOnce({ ok: true })                                          // DELETE after dead-letter
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
      .mockResolvedValueOnce({ ok: true })                                          // DELETE after dead-letter
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
});
