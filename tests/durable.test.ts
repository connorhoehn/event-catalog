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
