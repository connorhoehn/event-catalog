// tests/metrics-correctness.test.ts
//
// Counter/gauge semantics on the JSON stats surface, and the durable
// poll's counter arithmetic. These are the cases where a metric was
// quietly wrong rather than absent — the worse failure mode, because a
// wrong number reads as an answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCollector, DEFAULT_MAX_TRACKED_EVENTS } from '../src/server/metrics.js';
import { MetricsObserver } from '../src/server/metrics-observer.js';
import { Registry } from '../src/registry/index.js';
import { tapEmitter } from '../src/server/tap-emitter.js';
import { PoisonEventDetector } from '../src/server/poison-detector.js';

describe('MetricsCollector — reset actually resets', () => {
  it('a reset event restarts at 1, not at its pre-reset total', () => {
    // MetricsRegistry keys its store by (name, labels) and hands back the
    // EXISTING instance for a repeated key, so deleting the handle from
    // the collector's own map left the counter alive underneath. The next
    // publish re-fetched it and the count resumed from where it left off:
    // POST /api/metrics/reset looked like it worked (getStats went null)
    // and then silently un-reset itself.
    const metrics = new MetricsCollector(60);
    for (let i = 0; i < 7; i++) metrics.recordPublish('event:a');
    metrics.recordError('event:a');
    expect(metrics.getStats('event:a')!.publishCount).toBe(7);

    metrics.reset('event:a');
    expect(metrics.getStats('event:a')).toBeNull();

    metrics.recordPublish('event:a');
    const stats = metrics.getStats('event:a')!;
    expect(stats.publishCount).toBe(1);
    expect(stats.errorCount).toBe(0);
  });

  it('a full reset restarts every event', () => {
    const metrics = new MetricsCollector(60);
    metrics.recordPublish('event:a');
    metrics.recordPublish('event:b');
    metrics.recordPublish('event:b');
    metrics.reset();

    metrics.recordPublish('event:b');
    expect(metrics.getStats('event:b')!.publishCount).toBe(1);
    expect(metrics.getStats('event:a')).toBeNull();
  });

  it('clears gauges as well as counters', () => {
    const metrics = new MetricsCollector(60);
    metrics.updateDurableStats('q.event', { queueDepth: 42, messagesInFlight: 3, oldestMessageAge: 99 });
    metrics.setSubscriberCount('q.event', 6);
    metrics.reset('q.event');

    metrics.recordPublish('q.event');
    const stats = metrics.getStats('q.event')!;
    expect(stats.subscriberCount).toBe(0);
    expect(stats.queueDepth).toBeUndefined();
    expect(stats.oldestMessageAge).toBeUndefined();
  });

  it('drops the rate history with the event', () => {
    const metrics = new MetricsCollector(60);
    metrics.recordPublish('event:a');
    metrics.tickRateHistory();
    expect(metrics.getHistory('event:a')['event:a']).toHaveLength(1);
    metrics.reset('event:a');
    expect(metrics.getHistory('event:a')['event:a']).toEqual([]);
  });
});

describe('MetricsCollector — counters never move backwards', () => {
  function makeRedis(store: Record<string, string> = {}) {
    return {
      set: async (key: string, value: string) => { store[key] = value; },
      get: async (key: string) => store[key] ?? null,
      _store: store,
    };
  }

  it('a stale snapshot does not rewind a live counter', async () => {
    // A counter that decreases reads to Prometheus as a process restart,
    // so `rate()` treats the drop as a wrap and reports a phantom spike.
    const store: Record<string, string> = {
      'event-catalog:metrics:snapshot': JSON.stringify({
        'ship.event': { publishCount: 2, errorCount: 0, lastPublishedAt: null },
      }),
    };
    const metrics = new MetricsCollector(60);
    for (let i = 0; i < 10; i++) metrics.recordPublish('ship.event');

    await metrics.restoreFromRedis(makeRedis(store) as never);
    expect(metrics.getStats('ship.event')!.publishCount).toBe(10);
  });

  it('still rehydrates onto a cold collector', async () => {
    const store: Record<string, string> = {
      'event-catalog:metrics:snapshot': JSON.stringify({
        'ship.event': { publishCount: 12, errorCount: 4, lastPublishedAt: '2026-01-01T00:00:00.000Z' },
      }),
    };
    const metrics = new MetricsCollector(60);
    await metrics.restoreFromRedis(makeRedis(store) as never);
    const stats = metrics.getStats('ship.event')!;
    expect(stats.publishCount).toBe(12);
    expect(stats.errorCount).toBe(4);
    expect(stats.lastPublishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignores a negative or non-numeric persisted count', async () => {
    const store: Record<string, string> = {
      'event-catalog:metrics:snapshot': JSON.stringify({
        'weird.event': { publishCount: -5, errorCount: null, lastPublishedAt: null },
      }),
    };
    const metrics = new MetricsCollector(60);
    await metrics.restoreFromRedis(makeRedis(store) as never);
    const stats = metrics.getStats('weird.event')!;
    expect(stats.publishCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });
});

describe('MetricsCollector — bounded tracking', () => {
  it('stops minting handles past the cap and counts what it dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metrics = new MetricsCollector(60, 3);
    for (let i = 0; i < 100; i++) metrics.recordPublish(`flood.${i}`);

    expect(metrics.size()).toBe(3);
    expect(metrics.droppedEventCount).toBe(97);
    expect(Object.keys(metrics.snapshot())).toHaveLength(3);
    // One warning, not one per dropped event.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaves head-room far above the committed registry by default', () => {
    expect(DEFAULT_MAX_TRACKED_EVENTS).toBeGreaterThan(1000);
  });

  // A reset does NOT free a cap slot for a *new* name. `MetricsRegistry`
  // keys its store by (name, labels) and has no delete — `reset()` only
  // zeroes instances — so the memory the cap protects is still held after
  // `MetricsCollector.reset` drops its own map entry. Handing the slot
  // back would let reset + a fresh name grow the process without bound
  // while `size()` stayed under the cap forever.
  it('does not hand a cap slot to a new event after a reset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metrics = new MetricsCollector(60, 2);
    metrics.recordPublish('a');
    metrics.recordPublish('b');
    metrics.recordPublish('c');
    expect(metrics.getStats('c')).toBeNull();

    metrics.reset('a');
    metrics.recordPublish('c');
    expect(metrics.getStats('c')).toBeNull();
    expect(metrics.knownEventCount()).toBe(2);
    warn.mockRestore();
  });

  it('re-tracks a reset event, because its handles were never released', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metrics = new MetricsCollector(60, 2);
    metrics.recordPublish('a');
    metrics.recordPublish('b');
    metrics.reset('a');

    metrics.recordPublish('a');
    // Counter restarted at 1 (reset zeroed it) and the name cost no new
    // slot, so 'b' is untouched.
    expect(metrics.getStats('a')!.publishCount).toBe(1);
    expect(metrics.getStats('b')!.publishCount).toBe(1);
    expect(metrics.knownEventCount()).toBe(2);
    expect(metrics.droppedEventCount).toBe(0);
    warn.mockRestore();
  });

  it('a name churn behind resets cannot exceed the cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metrics = new MetricsCollector(60, 5);
    for (let i = 0; i < 500; i++) {
      metrics.recordPublish(`churn.${i}`);
      metrics.reset(`churn.${i}`);
    }
    expect(metrics.knownEventCount()).toBe(5);
    warn.mockRestore();
  });
});

describe('PoisonEventDetector — bounded failure window', () => {
  // Lives here rather than in poison-detector.test.ts because this is
  // about the same unbounded-map-fed-by-request-input class as the
  // collector cap above, not about poison semantics.
  it('does not grow without limit under a flood of distinct names', () => {
    const detector = new PoisonEventDetector({ maxTrackedEvents: 10, threshold: 3 });
    for (let i = 0; i < 5000; i++) detector.recordFailure(`junk.${i}`);
    expect(detector.trackedEventCount).toBeLessThanOrEqual(10);
  });

  it('reclaims slots from events whose failures aged out of the window', () => {
    vi.useFakeTimers();
    try {
      const detector = new PoisonEventDetector({ windowMs: 1000, maxTrackedEvents: 2, threshold: 99 });
      detector.recordFailure('old.a');
      detector.recordFailure('old.b');
      expect(detector.trackedEventCount).toBe(2);

      vi.advanceTimersByTime(2000);
      detector.recordFailure('new.c');
      expect(detector.failureCount('new.c')).toBe(1);
      expect(detector.failureCount('old.a')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never evicts a poisoned event to make room', () => {
    const detector = new PoisonEventDetector({ windowMs: 1000, maxTrackedEvents: 2, threshold: 1 });
    detector.recordFailure('poisoned.one');
    expect(detector.isPoisoned('poisoned.one')).toBe(true);
    for (let i = 0; i < 100; i++) detector.recordFailure(`noise.${i}`);
    expect(detector.isPoisoned('poisoned.one')).toBe(true);
  });
});

// ---------------------------------------------------------------------

const makeSignal = () => ({
  isConnected: vi.fn().mockReturnValue(false),
  subscribe: vi.fn(),
});

const makeMetrics = () => ({
  recordPublish: vi.fn(),
  recordError: vi.fn(),
  setSubscriberCount: vi.fn(),
  updateDurableStats: vi.fn(),
  getStats: vi.fn().mockReturnValue(null),
});

function durableEvent(registry: Registry, name = 'order.placed'): void {
  registry.declare({ name, transport: 'durable', producer: 'svc', schema: { type: 'object' } });
}

describe('MetricsObserver — durable poll arithmetic', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    tapEmitter.removeAllListeners('publish');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    tapEmitter.removeAllListeners('publish');
  });

  it('re-baselines after a transport counter reset instead of dropping publishes', async () => {
    // The transport's `sent` is a process-lifetime counter on the
    // DurableTransport instance; a reconnect restarts it at 0. The old
    // baseline only ever moved upward, so after a reset every publish was
    // discarded until the counter climbed back past the stale high-water
    // mark — an outage-shaped hole caused by the recovery, not the fault.
    durableEvent(registry);
    const metrics = makeMetrics();
    let transportMetrics = { sent: 100, received: 0, failed: 0, inFlight: 0 };
    const durable = {
      isConnected: () => true,
      getQueueAttributes: vi.fn().mockResolvedValue(null),
      getMetrics: vi.fn(() => transportMetrics),
    };
    const observer = new MetricsObserver({
      registry,
      signal: makeSignal() as never,
      durable: durable as never,
      metrics: metrics as never,
      durablePollIntervalMs: 1000,
    });

    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.recordPublish).toHaveBeenCalledTimes(100);
    metrics.recordPublish.mockClear();

    // Transport reconnects; counter restarts and climbs to 3.
    transportMetrics = { sent: 3, received: 0, failed: 0, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.recordPublish).toHaveBeenCalledTimes(3);

    await observer.stop();
  });

  it('does not double-count when a slow poll overruns its interval', async () => {
    // setInterval fires on the wall clock, not on completion. Two
    // interleaved passes read the same baseline before either writes it,
    // so the delta is applied twice and the publish rate reads double —
    // during exactly the message-queue slowdown you are investigating.
    durableEvent(registry);
    const metrics = makeMetrics();
    let release: (() => void) | null = null;
    const durable = {
      isConnected: () => true,
      getQueueAttributes: vi.fn(() => new Promise(resolve => { release = () => resolve(null); })),
      getMetrics: vi.fn(() => ({ sent: 50, received: 0, failed: 0, inFlight: 0 })),
    };
    const observer = new MetricsObserver({
      registry,
      signal: makeSignal() as never,
      durable: durable as never,
      metrics: metrics as never,
      durablePollIntervalMs: 1000,
    });

    await observer.start();
    // Three ticks fire while the first pass is still awaiting the queue.
    await vi.advanceTimersByTimeAsync(3000);
    expect(durable.getQueueAttributes).toHaveBeenCalledTimes(1);

    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(metrics.recordPublish).toHaveBeenCalledTimes(50);

    await observer.stop();
  });

  it('populates oldestMessageAge so a wedged queue is distinguishable from a busy one', async () => {
    durableEvent(registry);
    const metrics = makeMetrics();
    const durable = {
      isConnected: () => true,
      getQueueAttributes: vi.fn().mockResolvedValue({
        ApproximateNumberOfMessages: 12,
        ApproximateNumberOfMessagesNotVisible: 2,
        ApproximateAgeOfOldestMessage: 4200,
      }),
      getMetrics: vi.fn(() => undefined),
    };
    const observer = new MetricsObserver({
      registry,
      signal: makeSignal() as never,
      durable: durable as never,
      metrics: metrics as never,
      durablePollIntervalMs: 1000,
    });

    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(metrics.updateDurableStats).toHaveBeenCalledWith('order.placed', {
      queueDepth: 12,
      messagesInFlight: 2,
      oldestMessageAge: 4200,
    });

    await observer.stop();
  });

  it('caps the catch-up replay so a huge first delta cannot stall the tap', async () => {
    durableEvent(registry);
    const metrics = makeMetrics();
    const durable = {
      isConnected: () => true,
      getQueueAttributes: vi.fn().mockResolvedValue(null),
      getMetrics: vi.fn(() => ({ sent: 5_000_000, received: 0, failed: 0, inFlight: 0 })),
    };
    const observer = new MetricsObserver({
      registry,
      signal: makeSignal() as never,
      durable: durable as never,
      metrics: metrics as never,
      durablePollIntervalMs: 1000,
    });

    await observer.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.recordPublish.mock.calls.length).toBeLessThanOrEqual(10_000);

    // The baseline still advances to the observed value, so the next
    // poll reports the true delta rather than replaying the backlog again.
    metrics.recordPublish.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics.recordPublish).not.toHaveBeenCalled();

    await observer.stop();
  });
});
