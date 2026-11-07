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

  it('wave25/26 — event CRUD, deprecation, namespace, health, transport, attribution endpoints', async () => {
    const { api } = await import('../src/admin/src/api.ts') as { api: Record<string, (...args: unknown[]) => unknown> };

    // Event single-item reads
    await api.getEvent('order.placed');
    expect(calls[0].url).toBe('/admin-api/events/order.placed');

    await api.getEventStats('order.placed');
    expect(calls[1].url).toBe('/admin-api/events/order.placed/stats');

    await api.getEventHistory('order.placed', 10);
    expect(calls[2].url).toBe('/admin-api/events/order.placed/history?count=10');

    // Event mutations
    await api.declareEvent({ name: 'order.placed', transport: 'durable', producer: 'orders' });
    expect(calls[3].url).toBe('/admin-api/events');
    expect(calls[3].init?.method).toBe('POST');

    await api.deleteEvent('order.placed');
    expect(calls[4].url).toBe('/admin-api/events/order.placed');
    expect(calls[4].init?.method).toBe('DELETE');

    // Deprecation lifecycle
    await api.deprecateEvent('order.placed', { reason: 'replaced', by: 'ops' });
    expect(calls[5].url).toBe('/admin-api/events/order.placed/deprecate');
    expect(calls[5].init?.method).toBe('POST');

    await api.undeprecateEvent('order.placed');
    expect(calls[6].url).toBe('/admin-api/events/order.placed/deprecate');
    expect(calls[6].init?.method).toBe('DELETE');

    await api.listDeprecated();
    expect(calls[7].url).toBe('/admin-api/deprecated');

    // Namespace browser
    await api.getNamespacesSummary('summary');
    expect(calls[8].url).toBe('/admin-api/namespaces/summary');

    await api.getNamespacesSummary('full');
    expect(calls[9].url).toBe('/admin-api/namespaces/summary?detail=full');

    await api.getNamespaces();
    expect(calls[10].url).toBe('/admin-api/namespaces');

    // Health
    await api.getHealth();
    expect(calls[11].url).toBe('/admin-api/health');

    await api.getRegistryHealth();
    expect(calls[12].url).toBe('/admin-api/health/registry');

    // Metrics history
    await api.getMetricsHistory();
    expect(calls[13].url).toBe('/admin-api/metrics/history');

    await api.getMetricsHistory('order.placed');
    expect(calls[14].url).toBe('/admin-api/metrics/history?eventName=order.placed');

    // Transport lists
    await api.getSignalChannels();
    expect(calls[15].url).toBe('/admin-api/transports/signal/channels');

    await api.getDurableQueues();
    expect(calls[16].url).toBe('/admin-api/transports/durable/queues');

    // Batch DLQ replay
    await api.batchReplayDLQ(['id-1', 'id-2']);
    expect(calls[17].url).toBe('/admin-api/transports/durable/dlq/replay');
    expect(calls[17].init?.method).toBe('POST');

    // Bulk operations
    await api.bulkDeprecate(['a.event', 'b.event'], { reason: 'retired' });
    expect(calls[18].url).toBe('/admin-api/events/bulk/deprecate');
    expect(calls[18].init?.method).toBe('POST');

    const exportUrl = api.bulkExportUrl(['a.event', 'b.event']) as string;
    expect(exportUrl).toBe('/admin-api/events/bulk/export?names=a.event,b.event');

    // Poison event operations
    await api.getPoisonedEvents();
    expect(calls[19].url).toBe('/admin-api/events/poisoned');

    await api.clearPoison('order.placed');
    expect(calls[20].url).toBe('/admin-api/events/order.placed/poison');
    expect(calls[20].init?.method).toBe('DELETE');

    // Producer attribution
    await api.getObservedProducers('order.placed');
    expect(calls[21].url).toBe('/admin-api/events/order.placed/producers/observed');

    // Subscriber listing
    await api.getSubscribers();
    expect(calls[22].url).toBe('/admin-api/subscribers');

    await api.getSubscribers(30);
    expect(calls[23].url).toBe('/admin-api/subscribers?staleAfter=30');
  });

  it('exposes the DLQ + declarations + prom-metrics endpoints needed by the new components', async () => {
    const mod = await import('../src/admin/src/api.ts');
    const { api } = mod as {
      api: {
        getDLQ: (event?: string, limit?: number) => Promise<unknown>;
        replayDLQ: (id: string) => Promise<unknown>;
        deleteDLQ: (id: string) => Promise<unknown>;
        clearDLQ: (eventName?: string) => Promise<unknown>;
        getEvents: () => Promise<unknown>;
        getTopology: () => Promise<unknown>;
        getPromMetrics: () => Promise<string>;
      };
    };

    expect(typeof api.getDLQ).toBe('function');
    expect(typeof api.replayDLQ).toBe('function');
    expect(typeof api.deleteDLQ).toBe('function');
    expect(typeof api.clearDLQ).toBe('function');
    expect(typeof api.getEvents).toBe('function');
    expect(typeof api.getTopology).toBe('function');
    expect(typeof api.getPromMetrics).toBe('function');

    await api.getDLQ('svc:evt', 25);
    expect(calls[0].url).toBe('/admin-api/transports/durable/dlq?eventName=svc%3Aevt&limit=25');

    await api.replayDLQ('abc');
    expect(calls[1].url).toBe('/admin-api/transports/durable/dlq/abc/replay');
    expect(calls[1].init?.method).toBe('POST');

    await api.deleteDLQ('abc');
    expect(calls[2].url).toBe('/admin-api/transports/durable/dlq/abc');
    expect(calls[2].init?.method).toBe('DELETE');

    await api.clearDLQ('orders.failed');
    expect(calls[3].url).toBe('/admin-api/transports/durable/dlq/clear?eventName=orders.failed');
    expect(calls[3].init?.method).toBe('POST');

    await api.clearDLQ();
    expect(calls[4].url).toBe('/admin-api/transports/durable/dlq/clear');
    expect(calls[4].init?.method).toBe('POST');

    await api.getEvents();
    expect(calls[5].url).toBe('/admin-api/events');

    await api.getTopology();
    expect(calls[6].url).toBe('/admin-api/topology');

    await api.getPromMetrics();
    expect(calls[7].url).toBe('/metrics');
  });
});
