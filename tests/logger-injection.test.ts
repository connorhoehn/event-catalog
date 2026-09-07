import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEnvelope } from '../src/types/index.js';
import type { CatalogLogger, LogFields } from '../src/utils/logger.js';
import { consoleLogger } from '../src/utils/logger.js';

/**
 * The point of this file is one claim: **a consumer that passes no logger
 * sees exactly the console output it saw before the logger existed.** Every
 * `expect(warn.mock.calls).toEqual([...])` below is a full argument-list
 * assertion — call count, argument count, and each argument's exact value —
 * so a stray field object appended to a console call, or a message rewritten
 * into a template, fails here.
 *
 * The mirror-image tests then run the same scenarios with an injected sink
 * and assert console is silent, the structured fields arrive, and the
 * LogThrottle still sits *in front* of the sink.
 */

// ---------------------------------------------------------------------------
// redis + circuit-breaker mocks (same shape as tests/signal.test.ts)
// ---------------------------------------------------------------------------

const mockPublishClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  xAdd: vi.fn().mockResolvedValue('1234-0'),
  sMembers: vi.fn().mockResolvedValue([]),
  ping: vi.fn().mockResolvedValue('PONG'),
  on: vi.fn(),
};

const mockSubscribeClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  xAdd: vi.fn().mockResolvedValue('1234-0'),
  ping: vi.fn().mockResolvedValue('PONG'),
  on: vi.fn(),
};

let clientCallCount = 0;

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    clientCallCount++;
    return clientCallCount % 2 === 1 ? mockPublishClient : mockSubscribeClient;
  }),
}));

vi.mock('distributed-core/transport', () => ({
  CircuitBreaker: class MockCircuitBreaker {
    async execute<R>(fn: () => Promise<R>): Promise<R> {
      return fn();
    }
  },
  RetryManager: class MockRetryManager {
    async execute<R>(fn: () => Promise<R>): Promise<R> {
      return fn();
    }
  },
}));

import { SignalTransport } from '../src/client/signal.js';
import { DurableTransport } from '../src/client/durable.js';
import { EventCatalog } from '../src/client/index.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Captured {
  level: 'warn' | 'error';
  message: string;
  fields?: LogFields;
}

function recordingLogger(): { logger: CatalogLogger; lines: Captured[] } {
  const lines: Captured[] = [];
  return {
    lines,
    logger: {
      warn: (message, fields) => { lines.push({ level: 'warn', message, fields }); },
      error: (message, fields) => { lines.push({ level: 'error', message, fields }); },
    },
  };
}

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventName: 'test:event',
    payload: { key: 'value' },
    metadata: { id: 'e-001', producer: 'test', timestamp: 1 },
    ...overrides,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clientCallCount = 0;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. default sink — byte-identical console output
// ---------------------------------------------------------------------------

describe('default logger reproduces the pre-logger console output exactly', () => {
  it('SignalTransport: disconnected publish drop is one console.warn with one argument', async () => {
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });

    await transport.publish('room:1', envelope());

    expect(warnSpy.mock.calls).toEqual([
      [
        '[signal-transport] not connected, skipping publish to room:1 — '
        + 'the event is LOST. Call connect() (or EventCatalog.connect()) and wait for it '
        + 'to resolve before publishing.',
      ],
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('SignalTransport: disconnected channel-message drop keeps its exact wording', async () => {
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });

    await transport.publishChannelMessage('chan-9', {
      channelId: 'chan-9',
    } as never);

    expect(warnSpy.mock.calls).toEqual([
      [
        '[signal-transport] not connected, skipping channel-message publish to chan-9 — '
        + 'the message is LOST. Call connect() (or EventCatalog.connect()) and wait for it '
        + 'to resolve before publishing.',
      ],
    ]);
  });

  it('SignalTransport: ring-buffer failure still passes err.message as a second console argument', async () => {
    mockPublishClient.xAdd.mockRejectedValueOnce(new Error('OOM command not allowed'));
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });
    await transport.connect();

    await transport.publish('room:1', envelope());

    expect(warnSpy.mock.calls).toEqual([
      [
        '[signal-transport] ring buffer write failed for room:1 (1 total this process):',
        'OOM command not allowed',
      ],
    ]);
  });

  it('SignalTransport: handler errors still pass the raw Error object to console.error', async () => {
    const transport = new SignalTransport({ url: 'redis://localhost:6379' });
    await transport.connect();
    const boom = new Error('handler blew up');
    let deliver: ((message: string) => void) | undefined;
    mockSubscribeClient.subscribe.mockImplementationOnce(
      async (_channel: string, cb: (message: string) => void) => { deliver = cb; },
    );

    await transport.subscribe('room:1', () => { throw boom; });
    deliver?.(JSON.stringify(envelope()));

    expect(errorSpy.mock.calls).toEqual([
      ['[signal-transport] handler error on room:1:', boom],
    ]);
  });

  it('DurableTransport: an unreachable message-queue warns with the same single string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const transport = new DurableTransport({ url: 'http://localhost:3004' });

    await transport.connect();

    expect(warnSpy.mock.calls).toEqual([
      [
        '[durable-transport] message-queue not reachable at http://localhost:3004/health '
        + '(check MESSAGE_QUEUE_URL): ECONNREFUSED. Continuing in degraded mode — '
        + 'durable publishes will retry and then throw until it recovers.',
      ],
    ]);
  });

  it('DurableTransport: a queue-config 409 still logs the conflicts JSON as a second argument', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 409,
      ok: false,
      json: async () => ({ conflicts: ['fifo_queue'] }),
    }));
    const transport = new DurableTransport({ url: 'http://localhost:3004' });

    await transport.ensureQueue('orders');

    expect(warnSpy.mock.calls).toEqual([
      [
        '[durable-transport] queue "orders" exists with differing config — accepting drift:',
        '["fifo_queue"]',
      ],
    ]);
  });

  it('DurableTransport: an ensureQueue non-2xx is still a single-argument warn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      text: async () => 'boom',
      json: async () => ({}),
    }));
    const transport = new DurableTransport({ url: 'http://localhost:3004' });

    await transport.ensureQueue('orders');

    expect(warnSpy.mock.calls).toEqual([
      ['[durable-transport] ensureQueue "orders" failed: 500 boom'],
    ]);
  });

  it('EventCatalog: the undeclared publishSignal warning is unchanged', async () => {
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://localhost:3004' },
      serviceName: 'test-service',
    });

    await catalog.publishSignal('room:1', 'never:declared', { a: 1 });

    expect(warnSpy.mock.calls[0]).toEqual([
      '[event-catalog] publishSignal called with undeclared event "never:declared" — '
      + 'emitting without schema validation. Declare it via catalog.declare() to enforce schema.'
      + ' (further occurrences of this event name are not logged)',
    ]);
  });

  it('passing consoleLogger explicitly is identical to passing nothing', async () => {
    const implicit = new SignalTransport({ url: 'redis://localhost:6379' });
    await implicit.publish('room:1', envelope());
    const implicitCalls = warnSpy.mock.calls.map(args => [...args]);

    warnSpy.mockClear();

    const explicit = new SignalTransport({ url: 'redis://localhost:6379', logger: consoleLogger });
    await explicit.publish('room:1', envelope());

    expect(warnSpy.mock.calls).toEqual(implicitCalls);
  });
});

// ---------------------------------------------------------------------------
// 2. injected sink — console silent, fields structured
// ---------------------------------------------------------------------------

describe('injected logger', () => {
  it('takes every line off console for the signal transport', async () => {
    const { logger, lines } = recordingLogger();
    const transport = new SignalTransport({ url: 'redis://localhost:6379', logger });

    await transport.publish('room:1', envelope({ eventName: 'chat:message' }));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].message).toContain('not connected, skipping publish to room:1');
    expect(lines[0].fields).toMatchObject({
      channel: 'room:1',
      eventName: 'chat:message',
      kind: 'publish',
      dropped: 1,
      suppressed: 0,
    });
  });

  it('carries queue, status and body on an ensureQueue failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      text: async () => 'unavailable',
      json: async () => ({}),
    }));
    const { logger, lines } = recordingLogger();
    const transport = new DurableTransport({ url: 'http://localhost:3004', logger });

    await transport.ensureQueue('orders');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(lines[0].fields).toMatchObject({
      queue: 'orders',
      status: 503,
      body: 'unavailable',
      ensureQueueFailures: 1,
    });
  });

  it('carries attempt/maxAttempts and the error on a durable handler failure', async () => {
    const messages = [{ message_id: 'm-1', body: JSON.stringify(envelope()), receipt_handle: 'r-1' }];
    let polled = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/messages?')) {
        const body = polled ? { messages: [] } : { messages };
        polled = true;
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }));

    const { logger, lines } = recordingLogger();
    const transport = new DurableTransport({ url: 'http://localhost:3004', logger });
    const cancel = transport.subscribe(
      'orders',
      async () => { throw new Error('handler exploded'); },
      { pollingInterval: 5 },
    );
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0), { timeout: 2000 });
    cancel();

    const handlerLine = lines.find(l => l.message.includes('handler error'));
    expect(handlerLine).toBeDefined();
    expect(handlerLine!.fields).toMatchObject({
      queue: 'orders',
      messageId: 'm-1',
      attempt: 1,
      maxAttempts: 3,
      error: 'handler exploded',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('threads from EventCatalog options into both transports', async () => {
    const { logger, lines } = recordingLogger();
    const catalog = new EventCatalog({
      redis: { url: 'redis://localhost:6379' },
      messageQueue: { url: 'http://localhost:3004' },
      serviceName: 'test-service',
      logger,
    });

    await catalog.publishSignal('room:1', 'never:declared', { a: 1 });

    expect(warnSpy).not.toHaveBeenCalled();
    const undeclared = lines.find(l => l.message.includes('undeclared event'));
    expect(undeclared?.fields).toMatchObject({
      eventName: 'never:declared',
      channelId: 'room:1',
      suppressed: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. throttling stays in front of the sink
// ---------------------------------------------------------------------------

describe('LogThrottle semantics survive injection', () => {
  it('warn-once-per-channel still holds — the sink is not called per drop', async () => {
    const { logger, lines } = recordingLogger();
    const transport = new SignalTransport({ url: 'redis://localhost:6379', logger });

    for (let i = 0; i < 25; i++) {
      await transport.publish('room:1', envelope());
    }

    expect(lines).toHaveLength(1);
    expect(transport.getDroppedCount('room:1')).toBe(25);
  });

  it('the suppressed count reaches the sink as a field and stays in the message', async () => {
    const { logger, lines } = recordingLogger();
    const transport = new SignalTransport({ url: 'redis://localhost:6379', logger });

    await transport.publish('room:1', envelope());
    await transport.publish('room:1', envelope());
    await transport.publish('room:2', envelope());

    expect(lines).toHaveLength(2);
    expect(lines[1].fields).toMatchObject({ channel: 'room:2', suppressed: 1 });
    expect(lines[1].message).toContain('(+1 similar suppressed)');
  });
});
