import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertManager } from '../src/server/alerting.js';

const makeFetch = (ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500 });

describe('AlertManager', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = makeFetch();
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('enabled', () => {
    it('is false without webhookUrl', () => {
      const mgr = new AlertManager({});
      expect(mgr.enabled).toBe(false);
    });

    it('is true when webhookUrl is provided', () => {
      const mgr = new AlertManager({ webhookUrl: 'http://example.com/hook' });
      expect(mgr.enabled).toBe(true);
    });
  });

  describe('getPreviousState / setPreviousState', () => {
    it('round-trips component state', () => {
      const mgr = new AlertManager({});
      expect(mgr.getPreviousState('redis')).toBeUndefined();
      mgr.setPreviousState('redis', 'connected');
      expect(mgr.getPreviousState('redis')).toBe('connected');
    });
  });

  describe('onHealthChange', () => {
    it('does not fetch when disabled', async () => {
      const mgr = new AlertManager({});
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fires POST with critical severity on disconnected', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert' });
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://hook/alert');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body.severity).toBe('critical');
      expect(body.metadata).toMatchObject({ component: 'redis', from: 'connected', to: 'disconnected' });
    });

    it('fires warning severity for non-disconnected state change', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert' });
      await mgr.onHealthChange('mq', 'connected', 'degraded');
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.severity).toBe('warning');
    });
  });

  describe('onErrorThreshold', () => {
    it('does not fetch when disabled', async () => {
      const mgr = new AlertManager({});
      await mgr.onErrorThreshold('my.event', 100);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not fetch below threshold', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert', errorRateThreshold: 10 });
      await mgr.onErrorThreshold('my.event', 9);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fires at exactly the threshold', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert', errorRateThreshold: 10 });
      await mgr.onErrorThreshold('my.event', 10);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.severity).toBe('warning');
      expect(body.metadata).toMatchObject({ eventName: 'my.event', errorCount: 10, threshold: 10 });
    });
  });

  describe('onRecovery', () => {
    it('fires resolved severity', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert' });
      await mgr.onRecovery('redis');
      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.severity).toBe('resolved');
      expect(body.metadata).toMatchObject({ component: 'redis' });
    });
  });

  describe('cooldown', () => {
    it('suppresses duplicate key within cooldownMs', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert', cooldownMs: 60_000 });
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('allows re-fire after cooldownMs has elapsed', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert', cooldownMs: 60_000 });
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      vi.advanceTimersByTime(61_000);
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('different keys do not share cooldown', async () => {
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert', cooldownMs: 60_000 });
      await mgr.onHealthChange('redis', 'connected', 'disconnected');
      await mgr.onHealthChange('mq', 'connected', 'disconnected');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error resilience', () => {
    it('does not throw when fetch rejects', async () => {
      fetchSpy = vi.fn().mockRejectedValue(new Error('network error'));
      vi.stubGlobal('fetch', fetchSpy);
      const mgr = new AlertManager({ webhookUrl: 'http://hook/alert' });
      await expect(mgr.onHealthChange('redis', 'connected', 'disconnected')).resolves.toBeUndefined();
    });
  });
});
