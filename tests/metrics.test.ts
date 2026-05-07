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
});
