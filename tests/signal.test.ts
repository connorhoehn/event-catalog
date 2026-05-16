import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '../src/types/index';

// Mock redis module
const mockPublishClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  xAdd: vi.fn().mockResolvedValue('1234-0'),
  xRange: vi.fn().mockResolvedValue([]),
  ping: vi.fn().mockResolvedValue('PONG'),
  on: vi.fn(),
};

const mockSubscribeClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  xAdd: vi.fn().mockResolvedValue('1234-0'),
  xRange: vi.fn().mockResolvedValue([]),
  on: vi.fn(),
};

let clientCallCount = 0;

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    clientCallCount++;
    // First call is publish client, second is subscribe client
    return clientCallCount % 2 === 1 ? mockPublishClient : mockSubscribeClient;
  }),
}));

vi.mock('distributed-core/dist/transport/CircuitBreaker', () => ({
  CircuitBreaker: class MockCircuitBreaker {
    private _forceOpen = false;

    async execute<R>(fn: () => Promise<R>): Promise<R> {
      if (this._forceOpen) {
        throw new Error("Circuit breaker 'signal-redis' is OPEN");
      }
      return fn();
    }

    forceOpen() {
      this._forceOpen = true;
    }

    reset() {
      this._forceOpen = false;
    }
  },
}));

import { SignalTransport } from '../src/client/signal.js';

function makeEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventName: 'test.event',
    payload: { foo: 'bar' },
    metadata: {
      id: 'evt-001',
      producer: 'test-service',
      timestamp: Date.now(),
    },
    ...overrides,
  };
}

describe('SignalTransport', () => {
  let transport: SignalTransport;

  beforeEach(() => {
    clientCallCount = 0;
    vi.clearAllMocks();
    transport = new SignalTransport({ url: 'redis://localhost:6379' });
  });

  afterEach(async () => {
    try {
      await transport.disconnect();
    } catch {
      // ignore
    }
  });

  describe('connect/disconnect lifecycle', () => {
    it('connects both publish and subscribe Redis clients', async () => {
      await transport.connect();

      expect(mockPublishClient.connect).toHaveBeenCalledOnce();
      expect(mockSubscribeClient.connect).toHaveBeenCalledOnce();
      expect(transport.isConnected()).toBe(true);
    });

    it('disconnects both clients on disconnect', async () => {
      await transport.connect();
      await transport.disconnect();

      expect(mockPublishClient.quit).toHaveBeenCalledOnce();
      expect(mockSubscribeClient.quit).toHaveBeenCalledOnce();
      expect(transport.isConnected()).toBe(false);
    });

    it('does not reconnect if already connected', async () => {
      await transport.connect();
      await transport.connect();

      expect(mockPublishClient.connect).toHaveBeenCalledOnce();
    });
  });

  describe('publish', () => {
    it('calls Redis PUBLISH on the correct channel with JSON-serialized envelope', async () => {
      await transport.connect();
      const envelope = makeEnvelope();

      await transport.publish('events:pipeline', envelope);

      expect(mockPublishClient.publish).toHaveBeenCalledWith(
        'events:pipeline',
        JSON.stringify(envelope),
      );
    });

    it('skips publish when not connected', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const envelope = makeEnvelope();

      await transport.publish('events:pipeline', envelope);

      expect(mockPublishClient.publish).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('publish with CircuitBreaker open', () => {
    it('rejects when circuit breaker is open', async () => {
      await transport.connect();

      // Access internal circuit breaker via forcing open state
      // We need to trigger the circuit breaker to open by accessing it
      // Since our mock CB has forceOpen, we access it via the prototype trick
      const envelope = makeEnvelope();

      // Force the circuit breaker open by accessing the private field
      const breaker = (transport as any).circuitBreaker;
      breaker.forceOpen();

      await expect(transport.publish('events:test', envelope)).rejects.toThrow(
        /Circuit breaker.*is OPEN/,
      );
    });
  });

  describe('subscribe', () => {
    it('subscribes to Redis channel and calls handler when message arrives', async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const handler = vi.fn();
      await transport.subscribe('events:test', handler);

      expect(mockSubscribeClient.subscribe).toHaveBeenCalledWith(
        'events:test',
        expect.any(Function),
      );

      // Simulate incoming message
      const envelope = makeEnvelope();
      subscribeCb!(JSON.stringify(envelope));

      expect(handler).toHaveBeenCalledWith(envelope);
    });

    it('throws when not connected', async () => {
      const handler = vi.fn();
      await expect(transport.subscribe('events:test', handler)).rejects.toThrow(
        /not connected/,
      );
    });
  });

  describe('subscribe handler receives parsed EventEnvelope', () => {
    it('parses the JSON message into an EventEnvelope and passes to handler', async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const handler = vi.fn();
      await transport.subscribe('events:parsed', handler);

      const envelope: EventEnvelope = {
        eventName: 'user.created',
        payload: { userId: '123', name: 'Test User' },
        metadata: {
          id: 'evt-parsed-001',
          producer: 'user-service',
          timestamp: 1700000000000,
          correlationId: 'corr-abc',
        },
      };

      subscribeCb!(JSON.stringify(envelope));

      expect(handler).toHaveBeenCalledOnce();
      const received = handler.mock.calls[0][0];
      expect(received.eventName).toBe('user.created');
      expect(received.payload).toEqual({ userId: '123', name: 'Test User' });
      expect(received.metadata.correlationId).toBe('corr-abc');
    });
  });

  describe('unsubscribe', () => {
    it('calling returned unsubscribe function removes the subscription', async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const handler = vi.fn();
      const unsubscribe = await transport.subscribe('events:unsub', handler);

      // Unsubscribe
      await unsubscribe();

      // Simulate incoming message after unsubscribe
      const envelope = makeEnvelope();
      subscribeCb!(JSON.stringify(envelope));

      // Handler should NOT be called since we unsubscribed
      expect(handler).not.toHaveBeenCalled();
      expect(mockSubscribeClient.unsubscribe).toHaveBeenCalledWith('events:unsub');
    });

    it('does not unsubscribe from Redis channel if other handlers remain', async () => {
      await transport.connect();

      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, _cb: (message: string) => void) => {
          return Promise.resolve();
        },
      );

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsub1 = await transport.subscribe('events:multi', handler1);
      await transport.subscribe('events:multi', handler2);

      // Only remove first handler
      await unsub1();

      // Channel should still be subscribed since handler2 remains
      expect(mockSubscribeClient.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('ring buffer write', () => {
    it('publish also XADDs to a stream with MAXLEN', async () => {
      await transport.connect();
      const envelope = makeEnvelope();

      await transport.publish('events:ring', envelope);

      expect(mockPublishClient.xAdd).toHaveBeenCalledWith(
        'events:ring:history',
        '*',
        { payload: JSON.stringify(envelope) },
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 100 } },
      );
    });

    it('swallows xAdd failure and logs a warning — publish still resolves', async () => {
      await transport.connect();
      mockPublishClient.xAdd.mockRejectedValueOnce(new Error('Stream full'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(transport.publish('events:ring-fail', makeEnvelope())).resolves.toBeUndefined();

      const ringWarn = warnSpy.mock.calls.find(c =>
        typeof c[0] === 'string' && (c[0] as string).includes('ring buffer write failed'),
      );
      expect(ringWarn).toBeDefined();

      warnSpy.mockRestore();
    });

    it('uses custom ring buffer size from config', async () => {
      const customTransport = new SignalTransport({
        url: 'redis://localhost:6379',
        ringBufferSize: 500,
      });
      await customTransport.connect();
      const envelope = makeEnvelope();

      await customTransport.publish('events:custom', envelope);

      expect(mockPublishClient.xAdd).toHaveBeenCalledWith(
        'events:custom:history',
        '*',
        { payload: JSON.stringify(envelope) },
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 500 } },
      );

      await customTransport.disconnect();
    });
  });

  describe('ring buffer read (getHistory)', () => {
    it('XRANGE returns recent messages as parsed envelopes', async () => {
      await transport.connect();

      const envelope1 = makeEnvelope({ eventName: 'event.one' });
      const envelope2 = makeEnvelope({ eventName: 'event.two' });

      mockPublishClient.xRange.mockResolvedValue([
        { id: '1-0', message: { payload: JSON.stringify(envelope1) } },
        { id: '2-0', message: { payload: JSON.stringify(envelope2) } },
      ]);

      const history = await transport.getHistory('events:history');

      expect(mockPublishClient.xRange).toHaveBeenCalledWith(
        'events:history:history',
        '-',
        '+',
      );
      expect(history).toHaveLength(2);
      expect(history[0].eventName).toBe('event.one');
      expect(history[1].eventName).toBe('event.two');
    });

    it('returns empty array when not connected', async () => {
      const history = await transport.getHistory('events:test');
      expect(history).toEqual([]);
    });

    it('limits results to the count parameter', async () => {
      await transport.connect();

      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}-0`,
        message: { payload: JSON.stringify(makeEnvelope({ eventName: `event.${i}` })) },
      }));

      mockPublishClient.xRange.mockResolvedValue(entries);

      const history = await transport.getHistory('events:limited', 3);

      expect(history).toHaveLength(3);
      // Should return the most recent (last) 3 entries
      expect(history[0].eventName).toBe('event.7');
      expect(history[1].eventName).toBe('event.8');
      expect(history[2].eventName).toBe('event.9');
    });
  });

  describe('subscribe handler error isolation', () => {
    it('throwing handler is caught — other handlers on the same channel still fire', async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementationOnce(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const throwingHandler = vi.fn().mockImplementation(() => { throw new Error('handler boom'); });
      const safeHandler = vi.fn();

      await transport.subscribe('events:isolated', throwingHandler);
      await transport.subscribe('events:isolated', safeHandler);

      const envelope = makeEnvelope({ eventName: 'isolated.event' });
      expect(() => subscribeCb!(JSON.stringify(envelope))).not.toThrow();

      expect(safeHandler).toHaveBeenCalledOnce();
      const handlerErr = errorSpy.mock.calls.find(c =>
        typeof c[0] === 'string' && (c[0] as string).includes('handler error'),
      );
      expect(handlerErr).toBeDefined();

      errorSpy.mockRestore();
    });
  });

  describe('malformed message on subscribe', () => {
    it("doesn't crash and logs error on malformed JSON", async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = vi.fn();
      await transport.subscribe('events:malformed', handler);

      // Send malformed JSON - should not throw
      expect(() => subscribeCb!('not valid json {')).not.toThrow();

      // Handler should not be called
      expect(handler).not.toHaveBeenCalled();
      // Should log the error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('deserialize error'),
        expect.anything(),
      );

      errorSpy.mockRestore();
    });
  });

  describe('handler error isolation', () => {
    it("logs error and doesn't crash when a handler throws synchronously", async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const throwingHandler = vi.fn().mockImplementation(() => {
        throw new Error('handler boom');
      });
      await transport.subscribe('events:handler-error', throwingHandler);

      const msg = JSON.stringify(makeEnvelope({ eventName: 'events:handler-error' }));
      expect(() => subscribeCb!(msg)).not.toThrow();

      expect(throwingHandler).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('handler error on events:handler-error'),
        expect.any(Error),
      );

      errorSpy.mockRestore();
    });

    it('continues fan-out to remaining handlers when first handler throws', async () => {
      await transport.connect();

      let subscribeCb: ((message: string) => void) | undefined;
      mockSubscribeClient.subscribe.mockImplementation(
        (_channel: string, cb: (message: string) => void) => {
          subscribeCb = cb;
          return Promise.resolve();
        },
      );

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const throwingHandler = vi.fn().mockImplementation(() => {
        throw new Error('first handler fails');
      });
      const goodHandler = vi.fn();

      await transport.subscribe('events:fan-out', throwingHandler);
      await transport.subscribe('events:fan-out', goodHandler);

      const envelope = makeEnvelope({ eventName: 'events:fan-out' });
      subscribeCb!(JSON.stringify(envelope));

      expect(throwingHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'events:fan-out' }));

      errorSpy.mockRestore();
    });
  });

  describe('isConnected()', () => {
    it('returns false before connect', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('returns true after connect', async () => {
      await transport.connect();
      expect(transport.isConnected()).toBe(true);
    });

    it('returns false after disconnect', async () => {
      await transport.connect();
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('healthCheck()', () => {
    it('returns disconnected when not connected (no ping call)', async () => {
      const result = await transport.healthCheck();
      expect(result.status).toBe('disconnected');
      expect(result.latencyMs).toBe(0);
      expect(mockPublishClient.ping).not.toHaveBeenCalled();
    });

    it('returns connected with latencyMs when ping returns PONG', async () => {
      await transport.connect();
      mockPublishClient.ping.mockResolvedValue('PONG');
      const result = await transport.healthCheck();
      expect(result.status).toBe('connected');
      expect(typeof result.latencyMs).toBe('number');
    });

    it('returns degraded when ping returns non-PONG value', async () => {
      await transport.connect();
      mockPublishClient.ping.mockResolvedValue('OK');
      const result = await transport.healthCheck();
      expect(result.status).toBe('degraded');
    });

    it('returns disconnected when ping throws a non-timeout error', async () => {
      await transport.connect();
      mockPublishClient.ping.mockRejectedValue(new Error('redis down'));
      const result = await transport.healthCheck();
      expect(result.status).toBe('disconnected');
    });

    it('returns degraded when ping times out (Promise.race timeout wins)', async () => {
      await transport.connect();
      // ping never resolves — simulates a hung Redis connection
      mockPublishClient.ping.mockReturnValue(new Promise(() => {}));

      vi.useFakeTimers();
      const healthCheckPromise = transport.healthCheck();
      // Advance past the 2000ms internal timeout
      await vi.advanceTimersByTimeAsync(2100);
      const result = await healthCheckPromise;
      vi.useRealTimers();

      expect(result.status).toBe('degraded');
    });
  });

  describe('getMetrics() / getAllMetrics()', () => {
    it('getMetrics() with no arg returns empty Map on fresh instance', () => {
      const result = transport.getMetrics();
      expect(result).toBeInstanceOf(Map);
      expect((result as Map<string, unknown>).size).toBe(0);
    });

    it('getMetrics(channel) returns undefined for unknown channel', () => {
      expect(transport.getMetrics('unknown.channel')).toBeUndefined();
    });

    it('getAllMetrics() returns an independent copy of the metrics map', () => {
      const m1 = transport.getAllMetrics();
      const m2 = transport.getAllMetrics();
      expect(m1).not.toBe(m2);
      expect(m1.size).toBe(0);
    });

    it('getMetrics(channel) returns metrics after publish populates them', async () => {
      await transport.connect();
      const envelope = {
        eventName: 'user.created',
        payload: {},
        metadata: { id: 'e1', producer: 'auth', timestamp: Date.now() },
      };
      await transport.publish('user.created', envelope);
      const metrics = transport.getMetrics('user.created') as { publishCount: number; lastPublishedAt: string | null; subscriberCount: number };
      expect(metrics).toBeDefined();
      expect(metrics.publishCount).toBe(1);
      expect(metrics.lastPublishedAt).not.toBeNull();
    });
  });
});
