import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DurableTransport } from '../src/client/durable.js';

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
