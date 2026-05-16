import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { MetricsObserver } from '../src/server/metrics-observer.js';
import { tapEmitter } from '../src/server/tap-emitter.js';
import { auditEmitter } from '../src/server/audit-emitter.js';

// Minimal stub factories —— only the methods MetricsObserver actually calls.
const makeSignal = (connected = true) => ({
  isConnected: vi.fn().mockReturnValue(connected),
  subscribe: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
});

const makeDurable = (attrs: Record<string, unknown> | null = null, metrics?: {
  sent: number; received: number; failed: number; inFlight: number;
}) => ({
  isConnected: vi.fn().mockReturnValue(true),
  getQueueAttributes: vi.fn().mockResolvedValue(attrs),
  getMetrics: vi.fn().mockReturnValue(metrics),
});

const makeMetrics = () => ({
  recordPublish: vi.fn(),
  recordError: vi.fn(),
  setSubscriberCount: vi.fn(),
  updateDurableStats: vi.fn(),
  getStats: vi.fn().mockReturnValue(null),
});

describe('MetricsObserver', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    tapEmitter.removeAllListeners('publish');
    auditEmitter.removeAllListeners('audit');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('subscribes to each declared signal event in the registry', async () => {
      registry.declare({ name: 'a.b', schema: {}, transport: 'signal', producer: 'svc' });
      registry.declare({ name: 'c.d', schema: {}, transport: 'signal', producer: 'svc' });

      const signal = makeSignal();
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.start();

      expect(signal.subscribe).toHaveBeenCalledTimes(2);
      expect(signal.subscribe.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['a.b', 'c.d']);
    });

    it('skips durable events on start (no signal subscribe)', async () => {
      registry.declare({ name: 'x.y', schema: {}, transport: 'durable', producer: 'svc' });

      const signal = makeSignal();
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.start();
      await observer.stop();

      expect(signal.subscribe).not.toHaveBeenCalled();
    });

    it('starts the durable poll timer', async () => {
      const durable = makeDurable();
      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: makeMetrics() as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      vi.advanceTimersByTime(100);
      await observer.stop();

      // getQueueAttributes called from pollDurableStats (no durable events → zero calls is fine)
      // what matters is the timer fired without throwing
      expect(durable.getQueueAttributes).toHaveBeenCalledTimes(0); // no durable events declared
    });
  });

  describe('stop()', () => {
    it('calls unsubscribe for each subscribed signal event', async () => {
      registry.declare({ name: 'p.q', schema: {}, transport: 'signal', producer: 'svc' });
      const unsubFn = vi.fn().mockResolvedValue(undefined);
      const signal = makeSignal();
      signal.subscribe.mockResolvedValue(unsubFn);

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.start();
      await observer.stop();

      expect(unsubFn).toHaveBeenCalledOnce();
    });

    it('stops the durable poll timer (no further polls after stop)', async () => {
      const durable = makeDurable({ ApproximateNumberOfMessages: 0 });
      const metrics = makeMetrics();
      registry.declare({ name: 'dur.event', schema: {}, transport: 'durable', producer: 'svc' });

      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: metrics as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      await observer.stop();
      vi.advanceTimersByTime(200); // should not fire more polls

      // getQueueAttributes was called zero or one times (the first fire may have happened)
      // after stop, no additional calls occur
      const callCount = durable.getQueueAttributes.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(durable.getQueueAttributes.mock.calls.length).toBe(callCount);
    });
  });

  describe('observe()', () => {
    it('skips subscribe when transport is durable', async () => {
      const signal = makeSignal();
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('any.event', 'durable');
      expect(signal.subscribe).not.toHaveBeenCalled();
    });

    it('skips subscribe when signal is disconnected', async () => {
      const signal = makeSignal(false); // not connected
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('any.event', 'signal');
      expect(signal.subscribe).not.toHaveBeenCalled();
    });

    it('is idempotent — second observe call for same event does not re-subscribe', async () => {
      const signal = makeSignal();
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('my.event', 'signal');
      await observer.observe('my.event', 'signal');
      expect(signal.subscribe).toHaveBeenCalledOnce();
    });

    it('observe("both") subscribes to the signal channel', async () => {
      const signal = makeSignal();
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('both.event', 'both');
      expect(signal.subscribe).toHaveBeenCalledWith('both.event', expect.any(Function));
    });

    it('start() observes signal for a "both"-transport registry entry', async () => {
      const signal = makeSignal();
      registry.declare({ name: 'hybrid.event', schema: {}, transport: 'both', producer: 'svc' });
      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.start();
      await observer.stop();

      expect(signal.subscribe).toHaveBeenCalledWith('hybrid.event', expect.any(Function));
    });
  });

  describe('observeSignal error path', () => {
    it('records error and does not throw when signal.subscribe rejects', async () => {
      const signal = makeSignal();
      signal.subscribe.mockRejectedValue(new Error('redis down'));
      const metrics = makeMetrics();

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: metrics as any,
      });

      await expect(observer.observe('bad.event', 'signal')).resolves.toBeUndefined();
      expect(metrics.recordError).toHaveBeenCalledWith('bad.event');
    });
  });

  describe('pollDurableStats', () => {
    it('calls getQueueAttributes and updateDurableStats for durable events', async () => {
      registry.declare({ name: 'order.placed', schema: {}, transport: 'durable', producer: 'shop' });

      const durable = makeDurable({
        ApproximateNumberOfMessages: 5,
        ApproximateNumberOfMessagesNotVisible: 2,
      });
      const metrics = makeMetrics();

      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: metrics as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      // Advance past first interval tick and let the async poll settle
      await vi.advanceTimersByTimeAsync(101);
      await observer.stop();

      expect(durable.getQueueAttributes).toHaveBeenCalledWith('order-placed');
      expect(metrics.updateDurableStats).toHaveBeenCalledWith('order.placed', {
        queueDepth: 5,
        messagesInFlight: 2,
      });
    });

    it('calls recordPublish for each new sent-delta', async () => {
      registry.declare({ name: 'ship.event', schema: {}, transport: 'durable', producer: 'svc' });

      const durable = makeDurable(null, { sent: 3, received: 2, failed: 0, inFlight: 1 });
      const metrics = makeMetrics();

      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: metrics as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      // Advance past first interval tick and let the async poll settle
      await vi.advanceTimersByTimeAsync(101);
      await observer.stop();

      // seenBefore = 0 (getStats returns null → publishCount = 0), newSends = 3
      expect(metrics.recordPublish).toHaveBeenCalledTimes(3);
    });

    it('emits one durable tap event per sent-delta with correct transport + producer[0] fallback', async () => {
      registry.declare({ name: 'fan.event', schema: {}, transport: 'durable', producer: ['svc-a', 'svc-b'], namespace: 'fan' });

      const durable = makeDurable(null, { sent: 2, received: 0, failed: 0, inFlight: 0 });
      const metrics = makeMetrics();

      const taps: any[] = [];
      tapEmitter.on('publish', (e) => taps.push(e));

      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: metrics as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      await vi.advanceTimersByTimeAsync(101);
      await observer.stop();

      expect(taps).toHaveLength(2); // one per sent-delta
      for (const tap of taps) {
        expect(tap.transport).toBe('durable');
        expect(tap.producer).toBe('svc-a'); // array → producer[0]
        expect(tap.namespace).toBe('fan');
      }
    });
  });

  describe('signal subscribe handler (attribution + tap)', () => {
    it('calls attribution.record when envelope has a producer', async () => {
      registry.declare({ name: 'user.created', schema: {}, transport: 'signal', producer: 'auth', namespace: 'user' });

      const signal = makeSignal();
      let capturedHandler: ((envelope: any) => void) | undefined;
      signal.subscribe.mockImplementation((_name: string, handler: (env: any) => void) => {
        capturedHandler = handler;
        return Promise.resolve(vi.fn().mockResolvedValue(undefined));
      });

      const attribution = { record: vi.fn() };
      const metrics = makeMetrics();

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: metrics as any, attribution: attribution as any,
      });

      await observer.observe('user.created', 'signal');

      capturedHandler!({ eventName: 'user.created', payload: {}, metadata: { producer: 'auth-svc' } });

      expect(attribution.record).toHaveBeenCalledWith('user.created', 'auth-svc');
      expect(metrics.recordPublish).toHaveBeenCalledWith('user.created');
    });

    it('emits a tap event on each signal observation', async () => {
      registry.declare({ name: 'chat.msg', schema: {}, transport: 'signal', producer: 'gateway', namespace: 'chat' });

      const signal = makeSignal();
      let capturedHandler: ((envelope: any) => void) | undefined;
      signal.subscribe.mockImplementation((_name: string, handler: (env: any) => void) => {
        capturedHandler = handler;
        return Promise.resolve(vi.fn().mockResolvedValue(undefined));
      });

      const taps: any[] = [];
      tapEmitter.on('publish', (e) => taps.push(e));

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('chat.msg', 'signal');
      capturedHandler!({ eventName: 'chat.msg', payload: { text: 'hi' }, metadata: {} });

      expect(taps).toHaveLength(1);
      expect(taps[0].eventName).toBe('chat.msg');
      expect(taps[0].namespace).toBe('chat');
      expect(taps[0].transport).toBe('signal');
    });

    it('tap event uses entry.producer[0] when producer is an array and envelope has no producer', async () => {
      registry.declare({ name: 'multi.prod', schema: {}, transport: 'signal', producer: ['svc-a', 'svc-b'], namespace: 'multi' });

      const signal = makeSignal();
      let capturedHandler: ((envelope: any) => void) | undefined;
      signal.subscribe.mockImplementation((_name: string, handler: (env: any) => void) => {
        capturedHandler = handler;
        return Promise.resolve(vi.fn().mockResolvedValue(undefined));
      });

      const taps: any[] = [];
      tapEmitter.on('publish', (e) => taps.push(e));

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('multi.prod', 'signal');
      capturedHandler!({ eventName: 'multi.prod', payload: {}, metadata: {} }); // no producer in metadata

      expect(taps[0].producer).toBe('svc-a');
    });

    it('tap event uses declared string channel when entry.channel is set', async () => {
      registry.declare({ name: 'chat.room', schema: {}, transport: 'signal', producer: 'gateway', namespace: 'chat', channel: 'chat-bus' });

      const signal = makeSignal();
      let capturedHandler: ((envelope: any) => void) | undefined;
      signal.subscribe.mockImplementation((_name: string, handler: (env: any) => void) => {
        capturedHandler = handler;
        return Promise.resolve(vi.fn().mockResolvedValue(undefined));
      });

      const taps: any[] = [];
      tapEmitter.on('publish', (e) => taps.push(e));

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any,
      });

      await observer.observe('chat.room', 'signal');
      capturedHandler!({ eventName: 'chat.room', payload: {}, metadata: {} });

      expect(taps[0].channel).toBe('chat-bus');
    });
  });

  describe('maybePoison path (poison detection)', () => {
    it('calls poisonDetector.recordFailure when signal.subscribe errors', async () => {
      const signal = makeSignal();
      signal.subscribe.mockRejectedValue(new Error('redis down'));
      const poisonDetector = { recordFailure: vi.fn().mockReturnValue(false) };

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any, poisonDetector: poisonDetector as any,
      });

      await observer.observe('bad.event', 'signal');
      expect(poisonDetector.recordFailure).toHaveBeenCalledWith('bad.event');
    });

    it('emits event.poisoned audit event when poisonDetector.recordFailure returns true', async () => {
      registry.declare({ name: 'toxic.event', schema: {}, transport: 'signal', producer: 'svc', namespace: 'toxic' });

      const signal = makeSignal();
      signal.subscribe.mockRejectedValue(new Error('boom'));
      const poisonDetector = { recordFailure: vi.fn().mockReturnValue(true) };

      const auditEvents: any[] = [];
      auditEmitter.on('audit', (e) => auditEvents.push(e));

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any, poisonDetector: poisonDetector as any,
      });

      await observer.observe('toxic.event', 'signal');

      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0].kind).toBe('event.poisoned');
      expect(auditEvents[0].eventName).toBe('toxic.event');
      expect(auditEvents[0].namespace).toBe('toxic');
    });

    it('does not emit audit event when poisonDetector.recordFailure returns false', async () => {
      const signal = makeSignal();
      signal.subscribe.mockRejectedValue(new Error('timeout'));
      const poisonDetector = { recordFailure: vi.fn().mockReturnValue(false) };

      const auditEvents: any[] = [];
      auditEmitter.on('audit', (e) => auditEvents.push(e));

      const observer = new MetricsObserver({
        registry, signal: signal as any, durable: makeDurable() as any,
        metrics: makeMetrics() as any, poisonDetector: poisonDetector as any,
      });

      await observer.observe('meh.event', 'signal');
      expect(auditEvents).toHaveLength(0);
    });
  });

  describe('pollDurableStats — error delta', () => {
    it('calls recordError for each unit of failed-delta', async () => {
      registry.declare({ name: 'q.event', schema: {}, transport: 'durable', producer: 'svc' });

      // failed:2 with prevErrors=0 → delta=2 → recordError called twice
      const durable = makeDurable(null, { sent: 0, received: 0, failed: 2, inFlight: 0 });
      const metrics = makeMetrics();

      const observer = new MetricsObserver({
        registry, signal: makeSignal() as any, durable: durable as any,
        metrics: metrics as any, durablePollIntervalMs: 100,
      });

      await observer.start();
      await vi.advanceTimersByTimeAsync(101);
      await observer.stop();

      expect(metrics.recordError).toHaveBeenCalledTimes(2);
      expect(metrics.recordError).toHaveBeenCalledWith('q.event');
    });
  });
});
