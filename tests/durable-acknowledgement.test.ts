import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableTransport } from '../src/client/durable';

const message = { message_id: 'one', receipt_handle: 'receipt', body: JSON.stringify({
  eventName: 'test:event', payload: {}, metadata: { id: 'one', producer: 'test', timestamp: 1 },
}) };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable acknowledgement result', () => {
  it.each(['http', 'network'])('does not count %s acknowledgement failure as processing success or poison', async failure => {
    let polled = false;
    let recovered = false;
    const handler = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return { ok: true, status: 201 };
      if (url.endsWith('/health')) return { ok: true };
      if (opts?.method === 'DELETE') {
        if (recovered) return { ok: true };
        if (failure === 'network') throw Error('offline');
        return { ok: false, status: 503 };
      }
      const messages = polled ? [] : [message]; polled = true;
      return { ok: true, json: async () => ({ messages }) };
    }));
    const transport = new DurableTransport({ url: 'http://queue', maxProcessingAttempts: 1,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } });
    await transport.connect();
    transport.subscribe('test', handler, { pollingInterval: 1 });
    try {
      await vi.waitFor(() => expect(transport.getMetrics('test')).toMatchObject({ failed: 1, inFlight: 0 }));
      expect(transport.getMetrics('test')).toMatchObject({ received: 0 });
      expect(transport.getOverflowStats().handlerFailures).toBe(0);
      expect(transport.getDLQ()).toEqual([]);
      // The queue redelivers after visibility expiry; an idempotent handler runs again.
      recovered = true; polled = false;
      await vi.waitFor(() => expect(transport.getMetrics('test')).toMatchObject({ received: 1, inFlight: 0 }));
      expect(handler).toHaveBeenCalledTimes(2);
      expect(transport.getDLQ()).toEqual([]);
    } finally { await transport.disconnect(); }
  });
});

it.each(['deadline', 'disconnect'])('a stalled acknowledgement is cancelled by %s', async reason => {
  let polled = false;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
    if (opts?.method === 'PUT') return { ok: true, status: 201 };
    if (url.endsWith('/health')) return { ok: true };
    if (opts?.method === 'DELETE') {
      started();
      return new Promise((_, reject) => {
        const signal = opts.signal!;
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    const messages = polled ? [] : [message]; polled = true;
    return { ok: true, json: async () => ({ messages }) };
  }));
  const transport = new DurableTransport({ url: 'http://queue', acknowledgementTimeoutMs: reason === 'deadline' ? 20 : 10000,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } });
  await transport.connect();
  transport.subscribe('test', async () => {}, { pollingInterval: 1 });
  try {
    await pending;
    if (reason === 'disconnect') await transport.disconnect();
    await vi.waitFor(() => expect(transport.getMetrics('test')).toMatchObject({ received: 0, failed: 1, inFlight: 0 }));
    expect(transport.getOverflowStats().handlerFailures).toBe(0);
    expect(transport.getDLQ()).toEqual([]);
  } finally { await transport.disconnect(); }
});
