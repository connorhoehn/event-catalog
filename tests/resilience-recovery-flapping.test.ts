// tests/resilience-recovery-flapping.test.ts
//
// What happens AFTER a dependency stops being healthy: partial
// deliveries, alert delivery that itself fails, a dependency that
// flaps inside the alert cooldown, and — the failure this repo has
// shipped more than once — a gauge that never comes back off its last
// reading once the dependency returns.
//
// The assertions are on what a caller gets back, what `/metrics`
// renders, and which alert payloads actually reached the webhook.
// "the mock was called twice" is not evidence of anything.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertManager } from '../src/server/alerting.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { MetricsObserver } from '../src/server/metrics-observer.js';
import { Registry } from '../src/registry/index.js';
import type { SignalTransport } from '../src/client/signal.js';
import type { DurableTransport } from '../src/client/durable.js';

const WEBHOOK = 'http://alerts.internal/hook';

/** Collect the alert payloads a webhook actually received. */
function webhookRecorder(respond: () => { ok: boolean; status: number }) {
  const delivered: Array<{ title: string; severity: string; metadata: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const res = respond();
    if (res.ok) delivered.push(JSON.parse(String(init?.body)));
    return { ok: res.ok, status: res.status, json: async () => ({}), text: async () => '' };
  });
  return { delivered, fetchMock };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The alert channel is itself a dependency, and it can be degraded
// ---------------------------------------------------------------------------

describe('AlertManager — the webhook is degraded during the transition', () => {
  it('retries a transition whose webhook delivery failed instead of losing the incident', async () => {
    // Regression: fire() skips the cooldown on a delivery failure so the next
    // attempt can retry immediately — but observeHealth used to advance
    // previousHealthState first, so every later probe short-circuited at
    // `status === previous` and there was no next attempt. One webhook hiccup
    // at the moment of transition meant the operator was never told, for as
    // long as the dependency stayed down.
    let failing = true;
    const { delivered, fetchMock } = webhookRecorder(() =>
      failing ? { ok: false, status: 503 } : { ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const alerts = new AlertManager({ webhookUrl: WEBHOOK, healthConfirmations: 1 });

    await alerts.observeHealth('redis', 'connected');
    // The transition is not reported, so it is not treated as reported.
    expect(await alerts.observeHealth('redis', 'disconnected')).toBe('pending');
    expect(delivered).toHaveLength(0);

    // Redis stays down; the transition keeps being retried rather than lost.
    for (let i = 0; i < 3; i++) {
      expect(await alerts.observeHealth('redis', 'disconnected')).toBe('pending');
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    // Webhook recovers — the still-open incident finally lands.
    failing = false;
    expect(await alerts.observeHealth('redis', 'disconnected')).toBe('alerted');
    expect(delivered).toHaveLength(1);

    // And once delivered it settles: no repeat paging for the same state.
    expect(await alerts.observeHealth('redis', 'disconnected')).toBe('ignored');
    expect(delivered).toHaveLength(1);
  });

  it('a webhook that fails on the RECOVERY leaves the incident open, not falsely green', async () => {
    let failNext = false;
    const { delivered, fetchMock } = webhookRecorder(() =>
      failNext ? { ok: false, status: 500 } : { ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const alerts = new AlertManager({ webhookUrl: WEBHOOK, healthConfirmations: 1 });

    await alerts.observeHealth('redis', 'connected');
    await alerts.observeHealth('redis', 'disconnected');
    expect(delivered.map(d => d.severity)).toEqual(['critical']);

    failNext = true;
    await alerts.observeHealth('redis', 'connected');
    // The "resolved" never landed. That is the safe direction to fail:
    // a stale open incident is noise, a phantom green is an outage
    // nobody is looking at.
    expect(delivered.map(d => d.severity)).toEqual(['critical']);

    // The incident is still OPEN, so redis being observed down again is not a
    // new transition and must not page a second time — the operator already
    // has an unresolved critical for exactly this component. Re-paging here
    // would be the alert-fatigue mirror of the phantom-green bug.
    failNext = false;
    await alerts.observeHealth('redis', 'disconnected');
    expect(delivered.map(d => d.severity)).toEqual(['critical']);

    // Once the webhook is healthy again, a real recovery closes the incident.
    expect(await alerts.observeHealth('redis', 'connected')).toBe('recovered');
    expect(delivered.map(d => d.severity)).toEqual(['critical', 'resolved']);
  });
});

// ---------------------------------------------------------------------------
// Flapping
// ---------------------------------------------------------------------------

describe('AlertManager — a dependency that flaps inside the cooldown', () => {
  it('down → recovered → down inside one cooldown window alerts BOTH times', async () => {
    const { delivered, fetchMock } = webhookRecorder(() => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // A five-minute cooldown, and the whole flap happens inside it.
    const alerts = new AlertManager({
      webhookUrl: WEBHOOK,
      healthConfirmations: 1,
      cooldownMs: 300_000,
    });

    await alerts.observeHealth('redis', 'connected');
    await alerts.observeHealth('redis', 'degraded');
    await alerts.observeHealth('redis', 'connected');
    await alerts.observeHealth('redis', 'degraded');

    // The second failure is the one that used to be swallowed by the
    // cooldown left over from the first — the operator was holding a
    // green page over a broken dependency.
    expect(delivered.map(d => `${d.severity}:${d.metadata.to ?? 'recovered'}`))
      .toEqual(['warning:degraded', 'resolved:recovered', 'warning:degraded']);
  });

  it('degraded → disconnected → degraded never emits a resolved', async () => {
    const { delivered, fetchMock } = webhookRecorder(() => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alerts = new AlertManager({ webhookUrl: WEBHOOK, healthConfirmations: 1 });

    await alerts.observeHealth('message-queue', 'connected');
    await alerts.observeHealth('message-queue', 'degraded');
    await alerts.observeHealth('message-queue', 'disconnected');
    await alerts.observeHealth('message-queue', 'degraded');

    // A dependency oscillating between two kinds of broken has never
    // recovered, so no "resolved" may be sent — that is the assertion
    // that matters, because a phantom resolve closes the page.
    expect(delivered.map(d => d.severity)).not.toContain('resolved');
    // The escalation to `disconnected` pages; the de-escalation back to
    // `degraded` is suppressed by that key's own cooldown, which is
    // correct — the incident is already open and nothing new has
    // happened.
    expect(delivered.map(d => d.metadata.to)).toEqual(['degraded', 'disconnected']);
    expect(delivered.map(d => d.severity)).toEqual(['warning', 'critical']);
  });

  it('a flap that never holds for two probes is not an incident at all', async () => {
    const { delivered, fetchMock } = webhookRecorder(() => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // The production default: two consecutive confirmations.
    const alerts = new AlertManager({ webhookUrl: WEBHOOK, healthConfirmations: 2 });

    await alerts.observeHealth('redis', 'connected');
    for (let i = 0; i < 6; i++) {
      await alerts.observeHealth('redis', i % 2 === 0 ? 'degraded' : 'connected');
    }

    expect(delivered).toHaveLength(0);
  });

  it('errors that stop during a flap stop the alert, and a fresh burst restarts it', async () => {
    const { delivered, fetchMock } = webhookRecorder(() => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const alerts = new AlertManager({
      webhookUrl: WEBHOOK,
      errorRateThreshold: 5,
      cooldownMs: 0,
    });

    // Burst of 6 new errors → alert.
    await alerts.onErrorThreshold('orders:created', 6);
    // Dependency recovers; the lifetime counter stays high but stops moving.
    await alerts.onErrorThreshold('orders:created', 6);
    await alerts.onErrorThreshold('orders:created', 6);
    expect(delivered).toHaveLength(1);

    // It breaks again — a rate alert has to be able to fire twice.
    await alerts.onErrorThreshold('orders:created', 12);
    expect(delivered).toHaveLength(2);
    expect(delivered[1].metadata.newErrors).toBe(6);
    expect(delivered[1].metadata.errorCount).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Gauges must come back off their last reading
// ---------------------------------------------------------------------------

/**
 * Read one gauge out of the Prometheus exposition. Gauges render as
 * `name{labels} value [timestamp]`, so the value is the token right
 * after the closing brace — not the last token on the line.
 */
function gaugeValue(text: string, metric: string, labels: string): number | undefined {
  const prefix = `${metric}{${labels}}`;
  for (const line of text.split('\n')) {
    if (!line.startsWith(prefix)) continue;
    const value = line.slice(prefix.length).trim().split(/\s+/)[0];
    return Number(value);
  }
  return undefined;
}

describe('PromMetrics — transport gauges after a dependency returns', () => {
  it('transport_up goes back to 1, and the latency gauge re-reads', () => {
    const prom = new PromMetrics();

    prom.setTransportUp('redis', true);
    prom.setTransportProbeLatencySeconds('redis', 0.002);
    expect(gaugeValue(prom.renderProm(), 'event_catalog_transport_up', 'transport="redis"')).toBe(1);

    // Outage.
    prom.setTransportUp('redis', false);
    prom.setTransportProbeLatencySeconds('redis', 2);
    expect(gaugeValue(prom.renderProm(), 'event_catalog_transport_up', 'transport="redis"')).toBe(0);

    // Recovery.
    prom.setTransportUp('redis', true);
    prom.setTransportProbeLatencySeconds('redis', 0.001);
    const after = prom.renderProm();
    expect(gaugeValue(after, 'event_catalog_transport_up', 'transport="redis"')).toBe(1);
    expect(gaugeValue(after, 'event_catalog_transport_probe_latency_seconds', 'transport="redis"'))
      .toBe(0.001);
    // The other transport is untouched by redis's incident.
    expect(gaugeValue(after, 'event_catalog_transport_up', 'transport="message-queue"'))
      .toBeUndefined();
  });

  it('DLQ depth gauges survive a DynamoDB outage stale, then return to the truth', () => {
    const prom = new PromMetrics();

    prom.syncDLQEntries(new Map([['orders:created', 4], ['payments:failed', 1]]));
    let text = prom.renderProm();
    expect(gaugeValue(text, 'event_catalog_dlq_entries', 'event="orders:created"')).toBe(4);

    // During the outage the /metrics route deliberately does not call
    // syncDLQEntries at all — publishing "the DLQ is empty" mid-incident
    // is worse than publishing a stale depth.
    text = prom.renderProm();
    expect(gaugeValue(text, 'event_catalog_dlq_entries', 'event="orders:created"')).toBe(4);

    // DynamoDB returns and the queue has been drained. A gauge that only
    // ever gets `set` for events present in the scan would report 4
    // forever; sync has to zero what it no longer sees.
    prom.syncDLQEntries(new Map([['payments:failed', 2]]));
    text = prom.renderProm();
    expect(gaugeValue(text, 'event_catalog_dlq_entries', 'event="orders:created"')).toBe(0);
    expect(gaugeValue(text, 'event_catalog_dlq_entries', 'event="payments:failed"')).toBe(2);
  });
});

describe('MetricsObserver — durable stats across a message-queue outage', () => {
  function harness() {
    const registry = new Registry();
    registry.declare({
      name: 'orders:created',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      transport: 'durable',
      producer: 'orders-api',
    });
    const metrics = new MetricsCollector();
    const state = {
      attrs: null as Record<string, unknown> | null,
      queueMetrics: { sent: 0, received: 0, failed: 0, inFlight: 0 },
    };
    const durable = {
      getQueueAttributes: async () => state.attrs,
      getMetrics: () => state.queueMetrics,
    } as unknown as DurableTransport;
    const signal = {
      isConnected: () => false,
      subscribe: async () => async () => {},
    } as unknown as SignalTransport;
    const observer = new MetricsObserver({
      registry, signal, durable, metrics, durablePollIntervalMs: 5_000,
    });
    return { registry, metrics, state, observer };
  }

  it('holds the last queue depth during the outage and re-reads it on recovery', async () => {
    vi.useFakeTimers();
    const { metrics, state, observer } = harness();
    await observer.start();

    state.attrs = { ApproximateNumberOfMessages: 120, ApproximateAgeOfOldestMessage: 30 };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metrics.getStats('orders:created')?.queueDepth).toBe(120);

    // message-queue degraded: getQueueAttributes returns null.
    state.attrs = null;
    await vi.advanceTimersByTimeAsync(15_000);
    // Stale, deliberately — not zeroed into "the queue is empty".
    expect(metrics.getStats('orders:created')?.queueDepth).toBe(120);

    // Recovered, and the backlog grew while it was gone.
    state.attrs = { ApproximateNumberOfMessages: 900, ApproximateAgeOfOldestMessage: 610 };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metrics.getStats('orders:created')?.queueDepth).toBe(900);
    // The reading an operator most needs after an outage: how stuck is
    // the head of the queue.
    expect(metrics.getStats('orders:created')?.oldestMessageAge).toBe(610);

    await observer.stop();
  });

  it('publishes that happened during the outage are counted once on recovery, not twice', async () => {
    vi.useFakeTimers();
    const { metrics, state, observer } = harness();
    await observer.start();

    state.attrs = { ApproximateNumberOfMessages: 0 };
    state.queueMetrics = { sent: 5, received: 0, failed: 0, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metrics.getStats('orders:created')?.publishCount).toBe(5);

    // Outage: attributes stop answering but the transport's own counter
    // keeps climbing, because publishes are still being attempted.
    state.attrs = null;
    state.queueMetrics = { sent: 9, received: 0, failed: 2, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    // Recovery.
    state.attrs = { ApproximateNumberOfMessages: 3 };
    await vi.advanceTimersByTimeAsync(5_000);

    // 9 sends total, counted exactly once each — the delta baseline has
    // to survive the attribute failures, or the recovery poll replays
    // the whole backlog into the publish rate.
    expect(metrics.getStats('orders:created')?.publishCount).toBe(9);
    expect(metrics.getStats('orders:created')?.errorCount).toBe(2);
    expect(metrics.getStats('orders:created')?.queueDepth).toBe(3);

    await observer.stop();
  });

  it('a restarted transport re-baselines instead of going silent', async () => {
    vi.useFakeTimers();
    const { metrics, state, observer } = harness();
    await observer.start();

    state.attrs = { ApproximateNumberOfMessages: 0 };
    state.queueMetrics = { sent: 40, received: 0, failed: 0, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metrics.getStats('orders:created')?.publishCount).toBe(40);

    // The message-queue client reconnected and its counters restarted.
    state.queueMetrics = { sent: 3, received: 0, failed: 0, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(5_000);
    // 40 + 3: the reset is treated as a fresh baseline, so the three
    // post-restart publishes are recorded rather than swallowed until
    // the counter climbs back past 40.
    expect(metrics.getStats('orders:created')?.publishCount).toBe(43);

    state.queueMetrics = { sent: 4, received: 0, failed: 0, inFlight: 0 };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metrics.getStats('orders:created')?.publishCount).toBe(44);

    await observer.stop();
  });

  it('a hung getQueueAttributes does not stall the subscriber gauge', async () => {
    vi.useFakeTimers();
    const registry = new Registry();
    registry.declare({
      name: 'orders:created',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      transport: 'durable',
      producer: 'orders-api',
    });
    const metrics = new MetricsCollector();
    const observer = new MetricsObserver({
      registry,
      signal: { isConnected: () => false } as unknown as SignalTransport,
      // Slow, not dead: never answers.
      durable: {
        getQueueAttributes: () => new Promise(() => {}),
        getMetrics: () => undefined,
      } as unknown as DurableTransport,
      metrics,
      durablePollIntervalMs: 5_000,
    });
    await observer.start();

    registry.addSubscriber('orders:created', 'billing-worker');
    await vi.advanceTimersByTimeAsync(5_000);

    // syncSubscriberCounts runs outside the poll's re-entrancy guard, so
    // a wedged message-queue round-trip cannot freeze the topology view.
    expect(metrics.getStats('orders:created')?.subscriberCount).toBe(1);

    await observer.stop();
  });
});
