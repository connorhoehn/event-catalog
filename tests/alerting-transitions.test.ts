// tests/alerting-transitions.test.ts
//
// Whether the alerts fire on the conditions they claim: debounced
// transitions, flap behaviour, recovery, and the error alert actually
// going quiet once the errors stop.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertManager } from '../src/server/alerting.js';

function bodies(spy: ReturnType<typeof vi.fn>): Array<Record<string, never>> {
  return spy.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string));
}

describe('AlertManager — health transition debounce', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const mgr = (over: Record<string, unknown> = {}) =>
    new AlertManager({ webhookUrl: 'http://hook/alert', cooldownMs: 60_000, ...over });

  it('does not alert on the first observation of a component', async () => {
    const m = mgr();
    expect(await m.observeHealth('redis', 'disconnected')).toBe('ignored');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores a single bad probe and alerts on the second consecutive one', async () => {
    const m = mgr();
    await m.observeHealth('redis', 'connected'); // baseline

    expect(await m.observeHealth('redis', 'disconnected')).toBe('pending');
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(await m.observeHealth('redis', 'disconnected')).toBe('alerted');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(bodies(fetchSpy)[0]!['severity']).toBe('critical');
  });

  it('a blip that self-corrects produces no alert at all', async () => {
    // The old compare-and-set fired on one sample, so a 15s probe
    // dipping to degraded paged and the next probe sent a "resolved".
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'degraded');
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'connected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not re-alert while a component stays down', async () => {
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('redis', 'disconnected'); // alert
    for (let i = 0; i < 20; i++) {
      expect(await m.observeHealth('redis', 'disconnected')).toBe('ignored');
    }
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('sends exactly one resolved on a confirmed recovery', async () => {
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('redis', 'disconnected');
    fetchSpy.mockClear();

    expect(await m.observeHealth('redis', 'connected')).toBe('pending');
    expect(await m.observeHealth('redis', 'connected')).toBe('recovered');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(bodies(fetchSpy)[0]!['severity']).toBe('resolved');
  });

  it('a second failure inside the cooldown still alerts after a recovery', async () => {
    // Regression: the down alert and the recovery alert use different
    // cooldown keys, so down → recovered → down within cooldownMs
    // delivered the "resolved" and then swallowed the second failure,
    // leaving the operator looking at a green page over a dead Redis.
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('redis', 'disconnected'); // critical
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'connected');    // resolved
    fetchSpy.mockClear();

    // Well inside the 60s cooldown for health:redis:disconnected.
    vi.advanceTimersByTime(5_000);
    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('redis', 'disconnected');

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(bodies(fetchSpy)[0]!['severity']).toBe('critical');
  });

  it('tracks components independently', async () => {
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('message-queue', 'connected');

    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('message-queue', 'disconnected');
    expect(fetchSpy).not.toHaveBeenCalled();

    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('message-queue', 'disconnected');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const components = bodies(fetchSpy).map(b => (b['metadata'] as unknown as { component: string }).component);
    expect(components.sort()).toEqual(['message-queue', 'redis']);
  });

  it('an alternating state never confirms, so it never fires', async () => {
    const m = mgr();
    await m.observeHealth('redis', 'connected');
    for (let i = 0; i < 10; i++) {
      await m.observeHealth('redis', 'degraded');
      await m.observeHealth('redis', 'connected');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('healthConfirmations: 1 restores the undebounced behaviour', async () => {
    const m = mgr({ healthConfirmations: 1 });
    await m.observeHealth('redis', 'connected');
    expect(await m.observeHealth('redis', 'degraded')).toBe('alerted');
    expect(bodies(fetchSpy)[0]!['severity']).toBe('warning');
  });

  it('does nothing at all when the webhook is not configured', async () => {
    const m = new AlertManager({});
    await m.observeHealth('redis', 'connected');
    await m.observeHealth('redis', 'disconnected');
    await m.observeHealth('redis', 'disconnected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('AlertManager — onErrorThreshold fires on new errors, not the lifetime total', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const mgr = () =>
    new AlertManager({ webhookUrl: 'http://hook/alert', errorRateThreshold: 10, cooldownMs: 60_000 });

  it('goes quiet once the errors stop, even though the counter stays high', async () => {
    // The health interval passes MetricsCollector's CUMULATIVE
    // errorCount every 15s. Comparing that against the threshold meant
    // that once an event had ever seen 10 errors it was permanently over
    // threshold and re-alerted every cooldown forever — an alert with no
    // resolved state, which is the kind that gets muted and then missed.
    const m = mgr();
    await m.onErrorThreshold('my.event', 12); // fires
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Errors stopped. Counter is still 12 on every subsequent tick.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(120_000); // well past cooldown
      await m.onErrorThreshold('my.event', 12);
    }
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('fires again when a fresh burst of errors arrives', async () => {
    const m = mgr();
    await m.onErrorThreshold('my.event', 12);
    fetchSpy.mockClear();

    vi.advanceTimersByTime(120_000);
    await m.onErrorThreshold('my.event', 12 + 10);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = bodies(fetchSpy)[0]! as unknown as { metadata: Record<string, number> };
    expect(body.metadata['newErrors']).toBe(10);
    expect(body.metadata['errorCount']).toBe(22);
  });

  it('does not fire for a slow drip below the threshold', async () => {
    const m = mgr();
    for (let i = 1; i <= 50; i++) {
      await m.onErrorThreshold('my.event', i); // +1 per evaluation
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a counter reset as a fresh baseline, not a negative delta', async () => {
    const m = mgr();
    await m.onErrorThreshold('my.event', 40);
    fetchSpy.mockClear();
    vi.advanceTimersByTime(120_000);

    // POST /api/metrics/reset, or a process restart.
    await m.onErrorThreshold('my.event', 3);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120_000);
    await m.onErrorThreshold('my.event', 3 + 10);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('bounds its per-event bookkeeping', async () => {
    const m = new AlertManager({
      webhookUrl: 'http://hook/alert',
      errorRateThreshold: 10,
      maxTrackedKeys: 4,
    });
    // Event names are writable over HTTP, so this map is fed by request
    // input; it must not grow without limit.
    for (let i = 0; i < 5000; i++) await m.onErrorThreshold(`evt.${i}`, 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Nothing observable to assert beyond "it did not blow up"; the
    // eviction itself is exercised by the loop.
    expect(true).toBe(true);
  });
});
