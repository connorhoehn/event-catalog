// tests/signal-circuit-breaker.test.ts
//
// SignalTransport wraps every Redis write in a distributed-core
// CircuitBreaker so a wedged Redis stops being hammered on the publish
// hot path. tests/signal.test.ts replaces that breaker with a pass-through
// stub, so the actual open / half-open / closed transitions were never
// exercised. This suite uses the REAL breaker and only mocks `redis`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '../src/types/index.js';

const redisClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  sMembers: vi.fn().mockResolvedValue([]),
  xAdd: vi.fn().mockResolvedValue('1-0'),
  xRange: vi.fn().mockResolvedValue([]),
  ping: vi.fn().mockResolvedValue('PONG'),
  on: vi.fn(),
};

vi.mock('redis', () => ({
  createClient: vi.fn(() => redisClient),
}));

// NOTE: distributed-core/transport is deliberately NOT mocked here.
import { SignalTransport } from '../src/client/signal.js';

function envelope(): EventEnvelope {
  return {
    eventName: 'ws:typing',
    payload: { userId: 'u1' },
    metadata: { id: 'm-1', producer: 'test', timestamp: 1_700_000_000_000 },
  };
}

/** The breaker's failureThreshold, hard-coded in SignalTransport's ctor. */
const FAILURE_THRESHOLD = 5;

describe('SignalTransport circuit breaker (real distributed-core breaker)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    redisClient.connect.mockResolvedValue(undefined);
    redisClient.publish.mockResolvedValue(1);
    redisClient.xAdd.mockResolvedValue('1-0');
    redisClient.sMembers.mockResolvedValue([]);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('opens after the failure threshold and then rejects WITHOUT touching Redis', async () => {
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    redisClient.publish.mockRejectedValue(new Error('ECONNRESET'));

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(t.publish('ws:typing', envelope())).rejects.toThrow('ECONNRESET');
    }

    const callsWhileClosed = redisClient.publish.mock.calls.length;
    expect(callsWhileClosed).toBe(FAILURE_THRESHOLD);

    // Circuit is now OPEN: the next publish must fail fast rather than
    // adding another doomed round-trip to a Redis that is already down.
    await expect(t.publish('ws:typing', envelope())).rejects.toThrow(/OPEN/i);
    expect(redisClient.publish.mock.calls.length).toBe(callsWhileClosed);
  });

  it('does not count a publish toward the metrics when the breaker rejects it', async () => {
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    redisClient.publish.mockRejectedValue(new Error('ECONNRESET'));
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await t.publish('ws:typing', envelope()).catch(() => {});
    }
    await t.publish('ws:typing', envelope()).catch(() => {});

    // incrementMetrics runs only after a successful breaker execution.
    expect(t.getMetrics('ws:typing')).toBeUndefined();
  });

  it('shares one breaker across publish() and publishChannelMessage()', async () => {
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    redisClient.publish.mockRejectedValue(new Error('ECONNRESET'));
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await t.publish('ws:typing', envelope()).catch(() => {});
    }

    // The channel-message path must inherit the open state — otherwise a
    // gateway broadcast would keep hitting a Redis the breaker already
    // gave up on.
    await expect(
      t.publishChannelMessage('room-1', {
        type: 'channel_message',
        channel: 'room-1',
        message: { eventName: 'ws:typing', channel: 'room-1', payload: {}, timestamp: '2026-01-01T00:00:00.000Z' },
        fromNode: 'test',
        timestamp: '2026-01-01T00:00:00.000Z',
      } as never),
    ).rejects.toThrow(/OPEN/i);
    expect(redisClient.sMembers).not.toHaveBeenCalled();
  });

  it('half-opens after resetTimeout and closes again on a successful probe', async () => {
    vi.useFakeTimers();
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    redisClient.publish.mockRejectedValue(new Error('ECONNRESET'));
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await t.publish('ws:typing', envelope()).catch(() => {});
    }
    await expect(t.publish('ws:typing', envelope())).rejects.toThrow(/OPEN/i);

    // resetTimeout is 30_000ms in SignalTransport's breaker config.
    await vi.advanceTimersByTimeAsync(30_001);

    // Redis recovered — the half-open probe should be let through and
    // should re-close the circuit.
    redisClient.publish.mockResolvedValue(1);
    await expect(t.publish('ws:typing', envelope())).resolves.toBeUndefined();
    expect(t.getMetrics('ws:typing')).toMatchObject({ publishCount: 1 });

    // And normal traffic flows again.
    await expect(t.publish('ws:typing', envelope())).resolves.toBeUndefined();
    expect(t.getMetrics('ws:typing')).toMatchObject({ publishCount: 2 });
  });

  it('re-opens when the half-open probe fails again', async () => {
    vi.useFakeTimers();
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    redisClient.publish.mockRejectedValue(new Error('ECONNRESET'));
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await t.publish('ws:typing', envelope()).catch(() => {});
    }

    await vi.advanceTimersByTimeAsync(30_001);

    // Probe hits a still-broken Redis: the raw error surfaces...
    await expect(t.publish('ws:typing', envelope())).rejects.toThrow('ECONNRESET');
    const afterProbe = redisClient.publish.mock.calls.length;

    // ...and the circuit trips straight back to OPEN rather than
    // admitting a second probe.
    await expect(t.publish('ws:typing', envelope())).rejects.toThrow(/OPEN/i);
    expect(redisClient.publish.mock.calls.length).toBe(afterProbe);
  });

  it('a ring-buffer (xAdd) failure alone does not trip the breaker', async () => {
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    await t.connect();

    // xAdd rejections are swallowed by an inner .catch — history is
    // best-effort and must never take down the publish path.
    redisClient.xAdd.mockRejectedValue(new Error('stream write failed'));

    for (let i = 0; i < FAILURE_THRESHOLD + 3; i++) {
      await expect(t.publish('ws:typing', envelope())).resolves.toBeUndefined();
    }
    expect(t.getMetrics('ws:typing')).toMatchObject({ publishCount: FAILURE_THRESHOLD + 3 });
  });

  it('connect() surfaces a breaker rejection instead of marking itself connected', async () => {
    const t = new SignalTransport({ url: 'redis://localhost:6379' });
    redisClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(t.connect()).rejects.toThrow('ECONNREFUSED');
    expect(t.isConnected()).toBe(false);

    // A transport that failed to connect must degrade, not throw, on publish.
    await expect(t.publish('ws:typing', envelope())).resolves.toBeUndefined();
    expect(await t.publishChannelMessage('room-1', {} as never)).toBe(0);
    expect(await t.getHistory('ws:typing')).toEqual([]);
    await expect(t.subscribe('ws:typing', () => {})).rejects.toThrow('not connected');
    expect(await t.healthCheck()).toEqual({ status: 'disconnected', latencyMs: 0 });
  });
});
