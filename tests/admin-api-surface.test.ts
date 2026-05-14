import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Lightweight surface test for the admin API client. We don't mount
 * React (no jsdom in this repo) — we validate that the API methods
 * the new UI components depend on exist, hit the right paths, and
 * thread the right query params. Mount-correctness for the new
 * components is covered indirectly: each component imports `api.*`
 * methods exercised here, and a TS build of the admin bundle would
 * fail if those imports drift.
 */
describe('admin api surface', () => {
  let originalFetch: typeof globalThis.fetch;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        text: async () => '{}',
        json: async () => ({ messages: [], total: 0 }),
      } as unknown as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exposes the DLQ + declarations + prom-metrics endpoints needed by the new components', async () => {
    const mod = await import('../src/admin/src/api.ts');
    const { api } = mod as {
      api: {
        getDLQ: (event?: string, limit?: number) => Promise<unknown>;
        replayDLQ: (id: string) => Promise<unknown>;
        deleteDLQ: (id: string) => Promise<unknown>;
        getEvents: () => Promise<unknown>;
        getTopology: () => Promise<unknown>;
        getPromMetrics: () => Promise<string>;
      };
    };

    expect(typeof api.getDLQ).toBe('function');
    expect(typeof api.replayDLQ).toBe('function');
    expect(typeof api.deleteDLQ).toBe('function');
    expect(typeof api.getEvents).toBe('function');
    expect(typeof api.getTopology).toBe('function');
    expect(typeof api.getPromMetrics).toBe('function');

    await api.getDLQ('svc:evt', 25);
    expect(calls[0].url).toBe('/api/transports/durable/dlq?eventName=svc%3Aevt&limit=25');

    await api.replayDLQ('abc');
    expect(calls[1].url).toBe('/api/transports/durable/dlq/abc/replay');
    expect(calls[1].init?.method).toBe('POST');

    await api.deleteDLQ('abc');
    expect(calls[2].url).toBe('/api/transports/durable/dlq/abc');
    expect(calls[2].init?.method).toBe('DELETE');

    await api.getEvents();
    expect(calls[3].url).toBe('/api/events');

    await api.getTopology();
    expect(calls[4].url).toBe('/api/topology');

    await api.getPromMetrics();
    expect(calls[5].url).toBe('/metrics');
  });
});
