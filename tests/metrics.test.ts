import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../src/server/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector(60);
  });

  describe('recordPublish', () => {
    it('increments publish count', () => {
      metrics.recordPublish('test:event');
      metrics.recordPublish('test:event');
      metrics.recordPublish('test:event');

      const stats = metrics.getStats('test:event');
      expect(stats!.publishCount).toBe(3);
    });

    it('updates lastPublishedAt', () => {
      metrics.recordPublish('test:event');
      const stats = metrics.getStats('test:event');
      expect(stats!.lastPublishedAt).not.toBeNull();
    });

    it('calculates publish rate within window', () => {
      for (let i = 0; i < 10; i++) {
        metrics.recordPublish('test:event');
      }

      const stats = metrics.getStats('test:event');
      // 10 messages in 60s window = ~0.17/s
      expect(stats!.publishRate).toBeCloseTo(10 / 60, 1);
    });
  });

  describe('recordError', () => {
    it('increments error count', () => {
      metrics.recordError('test:event');
      metrics.recordError('test:event');

      const stats = metrics.getStats('test:event');
      expect(stats!.errorCount).toBe(2);
    });
  });

  describe('setSubscriberCount', () => {
    it('sets subscriber count', () => {
      metrics.setSubscriberCount('test:event', 5);
      const stats = metrics.getStats('test:event');
      expect(stats!.subscriberCount).toBe(5);
    });
  });

  describe('updateDurableStats', () => {
    it('stores queue-level metrics', () => {
      metrics.updateDurableStats('pipeline:completed', {
        queueDepth: 42,
        messagesInFlight: 3,
        oldestMessageAge: 120,
      });

      const stats = metrics.getStats('pipeline:completed');
      expect(stats!.queueDepth).toBe(42);
      expect(stats!.messagesInFlight).toBe(3);
      expect(stats!.oldestMessageAge).toBe(120);
    });

    // "We measured it and it is empty" and "we never measured it" are
    // different answers. A drained queue used to have its field vanish
    // from the JSON rather than report the drop to 0, so the admin UI
    // could not distinguish a queue that emptied from a signal-only
    // event, and `oldestMessageAge: 0` — the "nothing is stuck" reading
    // — was not expressible at all.
    it('reports a drained queue as 0 rather than dropping the field', () => {
      metrics.updateDurableStats('pipeline:completed', {
        queueDepth: 42, messagesInFlight: 3, oldestMessageAge: 120,
      });
      metrics.updateDurableStats('pipeline:completed', {
        queueDepth: 0, messagesInFlight: 0, oldestMessageAge: 0,
      });

      const stats = metrics.getStats('pipeline:completed')!;
      expect(stats.queueDepth).toBe(0);
      expect(stats.messagesInFlight).toBe(0);
      expect(stats.oldestMessageAge).toBe(0);
    });

    it('omits durable fields that have never been measured', () => {
      metrics.recordPublish('signal.only');
      const stats = metrics.getStats('signal.only')!;
      expect(stats.queueDepth).toBeUndefined();
      expect(stats.messagesInFlight).toBeUndefined();
      expect(stats.oldestMessageAge).toBeUndefined();
    });

    it('reports a zero measurement even on the first observation', () => {
      metrics.updateDurableStats('fresh.queue', { queueDepth: 0 });
      const stats = metrics.getStats('fresh.queue')!;
      expect(stats.queueDepth).toBe(0);
      // Fields the same call said nothing about stay absent.
      expect(stats.messagesInFlight).toBeUndefined();
    });
  });

  describe('snapshot', () => {
    it('returns all events metrics', () => {
      metrics.recordPublish('event:a');
      metrics.recordPublish('event:b');
      metrics.recordPublish('event:b');

      const snap = metrics.snapshot();
      expect(Object.keys(snap)).toHaveLength(2);
      expect(snap['event:a'].publishCount).toBe(1);
      expect(snap['event:b'].publishCount).toBe(2);
    });

    it('returns empty object when no events tracked', () => {
      expect(metrics.snapshot()).toEqual({});
    });
  });

  describe('reset', () => {
    it('resets a specific event', () => {
      metrics.recordPublish('event:a');
      metrics.recordPublish('event:b');
      metrics.reset('event:a');

      expect(metrics.getStats('event:a')).toBeNull();
      expect(metrics.getStats('event:b')).not.toBeNull();
    });

    it('resets all events when no name given', () => {
      metrics.recordPublish('event:a');
      metrics.recordPublish('event:b');
      metrics.reset();

      expect(metrics.snapshot()).toEqual({});
    });
  });

  describe('getStats', () => {
    it('returns null for unknown event', () => {
      expect(metrics.getStats('nonexistent')).toBeNull();
    });
  });

  describe('tickRateHistory / getHistory (wave26-a)', () => {
    it('getHistory returns empty for an untracked event', () => {
      expect(metrics.getHistory('event:x')).toEqual({ 'event:x': [] });
    });

    it('getHistory returns all events when no name given', () => {
      metrics.recordPublish('event:a');
      metrics.tickRateHistory();
      const all = metrics.getHistory();
      expect(Object.keys(all)).toContain('event:a');
      expect(Array.isArray(all['event:a'])).toBe(true);
    });

    it('tickRateHistory accumulates one sample per tick', () => {
      metrics.recordPublish('event:a');
      metrics.tickRateHistory();
      metrics.tickRateHistory();
      const hist = metrics.getHistory('event:a');
      expect(hist['event:a']).toHaveLength(2);
    });

    it('caps the buffer at 60 samples', () => {
      metrics.recordPublish('event:a');
      for (let i = 0; i < 65; i++) metrics.tickRateHistory();
      const hist = metrics.getHistory('event:a');
      expect(hist['event:a']!.length).toBe(60);
    });
  });

  describe('snapshotToRedis / restoreFromRedis', () => {
    function makeRedis(store: Record<string, string> = {}) {
      return {
        set: async (key: string, value: string) => { store[key] = value; },
        get: async (key: string) => store[key] ?? null,
        _store: store,
      };
    }

    it('snapshotToRedis writes JSON with publishCount and errorCount', async () => {
      metrics.recordPublish('order.created');
      metrics.recordPublish('order.created');
      metrics.recordError('order.created');

      const redis = makeRedis();
      await metrics.snapshotToRedis(redis as never);

      const raw = Object.values(redis._store)[0]!;
      const data = JSON.parse(raw) as Record<string, { publishCount: number; errorCount: number }>;
      expect(data['order.created'].publishCount).toBe(2);
      expect(data['order.created'].errorCount).toBe(1);
    });

    it('snapshotToRedis includes all tracked events', async () => {
      metrics.recordPublish('ev.a');
      metrics.recordPublish('ev.b');
      metrics.recordPublish('ev.b');

      const redis = makeRedis();
      await metrics.snapshotToRedis(redis as never);

      const raw = Object.values(redis._store)[0]!;
      const data = JSON.parse(raw) as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(['ev.a', 'ev.b']);
    });

    it('restoreFromRedis is a no-op when no snapshot exists', async () => {
      const redis = makeRedis();
      await metrics.restoreFromRedis(redis as never);
      expect(metrics.snapshot()).toEqual({});
    });

    it('restoreFromRedis is a no-op when snapshot is corrupt JSON', async () => {
      const redis = makeRedis({ 'event-catalog:metrics:snapshot': 'not-valid-json{{{' });
      await expect(metrics.restoreFromRedis(redis as never)).resolves.toBeUndefined();
      expect(metrics.snapshot()).toEqual({});
    });

    it('restoreFromRedis rehydrates publishCount and errorCount', async () => {
      const store: Record<string, string> = {};
      const redis = makeRedis(store);

      // Write a synthetic snapshot (mimic what snapshotToRedis would write)
      metrics.recordPublish('ship.event');
      metrics.recordPublish('ship.event');
      metrics.recordError('ship.event');
      await metrics.snapshotToRedis(redis as never);

      // Start fresh and restore
      const fresh = new MetricsCollector(60);
      await fresh.restoreFromRedis(redis as never);

      const stats = fresh.getStats('ship.event');
      expect(stats).not.toBeNull();
      expect(stats!.publishCount).toBe(2);
      expect(stats!.errorCount).toBe(1);
    });

    it('restoreFromRedis round-trips multiple events', async () => {
      const redis = makeRedis();

      metrics.recordPublish('ev.x');
      metrics.recordPublish('ev.x');
      metrics.recordPublish('ev.y');
      await metrics.snapshotToRedis(redis as never);

      const fresh = new MetricsCollector(60);
      await fresh.restoreFromRedis(redis as never);

      expect(fresh.getStats('ev.x')!.publishCount).toBe(2);
      expect(fresh.getStats('ev.y')!.publishCount).toBe(1);
    });
  });
});
