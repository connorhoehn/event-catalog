const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function requestText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }
  return res.text();
}

// Types matching the server API responses
export interface SchemaHistoryEntry {
  version: number;
  schema: Record<string, unknown>;
  /** Phase E6.5 — sha256 of the historical schema; optional on legacy entries. */
  fingerprint?: string;
  updatedAt: string;
}

export interface EventEntry {
  name: string;
  /** Phase E7 — always populated by the registry (auto-derived if not declared). */
  namespace?: string;
  transport: 'signal' | 'durable';
  producer: string | string[];
  description?: string;
  tags?: string[];
  schema: Record<string, unknown>;
  /** Phase E6 — sha256 of the canonical schema serialization. */
  schemaFingerprint?: string;
  version?: number;
  schemaHistory?: SchemaHistoryEntry[];
  subscribers: string[];
  metadata: {
    createdAt: string;
    lastPublishedAt: string | null;
    publishCount: number;
    errorCount: number;
  };
  /** wave25-a — present when event is currently deprecated. */
  deprecation?: {
    deprecatedAt: string;
    reason?: string;
    by?: string;
  };
  stats: EventStats | null;
}

export interface EventStats {
  publishCount: number;
  publishRate: number;
  lastPublishedAt: string | null;
  errorCount: number;
  subscriberCount: number;
  queueDepth?: number;
  messagesInFlight?: number;
  oldestMessageAge?: number;
}

export interface TopologyGraph {
  nodes: Array<{ id: string; type: 'service' | 'event'; metadata: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; relation: 'publishes' | 'subscribes' }>;
}

export interface ComponentHealth {
  /**
   * What GET /api/health actually reports per component. It is the transport's
   * own vocabulary ('connected'), NOT the service-runtime vocabulary
   * ('healthy') used by the root /health endpoint — this type claimed the
   * latter, so every `status === 'healthy'` comparison in the admin was
   * permanently false and both transports rendered as down on a healthy
   * system.
   */
  status: 'connected' | 'degraded' | 'disconnected' | 'healthy' | 'unhealthy';
  latencyMs?: number;
}

/** Component states that mean "this transport is working". */
export function isTransportUp(status: ComponentHealth['status']): boolean {
  return status === 'connected' || status === 'healthy';
}

/**
 * Chip tone for a component state. Degraded is a warning, not a failure —
 * collapsing it into the danger tone told an operator to page someone for a
 * slow Redis.
 */
export function transportTone(status: ComponentHealth['status']): 'success' | 'warning' | 'danger' {
  if (isTransportUp(status)) return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis: ComponentHealth;
  messageQueue: ComponentHealth;
  uptime: number;
  eventCount: number;
}

export interface ChannelInfo {
  channel: string;
  publishCount: number;
  lastPublishedAt: string | null;
  subscriberCount: number;
}

export interface QueueInfo {
  queue: string;
  sent: number;
  received: number;
  failed: number;
  inFlight: number;
}

// API methods
export const api = {
  getEvents(filter?: { transport?: string; producer?: string }) {
    const params = new URLSearchParams();
    if (filter?.transport) params.set('transport', filter.transport);
    if (filter?.producer) params.set('producer', filter.producer);
    const qs = params.toString();
    return request<{ events: EventEntry[]; total: number }>(`/events${qs ? `?${qs}` : ''}`);
  },

  getEvent(name: string) {
    return request<EventEntry>(`/events/${encodeURIComponent(name)}`);
  },

  getEventStats(name: string) {
    return request<EventStats>(`/events/${encodeURIComponent(name)}/stats`);
  },

  getEventHistory(name: string, count = 50) {
    return request<{ messages: unknown[]; transport: string }>(`/events/${encodeURIComponent(name)}/history?count=${count}`);
  },

  declareEvent(event: { name: string; transport: string; producer: string; schema?: Record<string, unknown>; description?: string; tags?: string[] }) {
    return request<{ declared: string }>('/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  deleteEvent(name: string) {
    return request<{ removed: string }>(`/events/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // wave25-a — schema deprecation lifecycle.
  deprecateEvent(name: string, body: { reason?: string; by?: string } = {}) {
    return request<{ deprecated: string; deprecation: { deprecatedAt: string; reason?: string; by?: string } }>(
      `/events/${encodeURIComponent(name)}/deprecate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  },

  undeprecateEvent(name: string) {
    return request<{ undeprecated: string }>(`/events/${encodeURIComponent(name)}/deprecate`, { method: 'DELETE' });
  },

  listDeprecated() {
    return request<{ count: number; items: Array<{ name: string; namespace?: string; transport: string; version: number; deprecation: { deprecatedAt: string; reason?: string; by?: string } }> }>(`/deprecated`);
  },

  // wave25-b — namespace browser.
  getNamespacesSummary(detail: 'summary' | 'full' = 'summary') {
    type Item = {
      namespace: string;
      eventCount: number;
      deprecatedCount: number;
      producerCount: number;
      subscriberCount: number;
      signalCount: number;
      durableCount: number;
      events?: Array<{ name: string; transport: string; version: number; deprecated: boolean }>;
    };
    const qs = detail === 'full' ? '?detail=full' : '';
    return request<{ count: number; items: Item[] }>(`/namespaces/summary${qs}`);
  },

  getTopology(filter?: { namespace?: string; producer?: string; consumer?: string; transport?: string }) {
    const params = new URLSearchParams();
    if (filter?.namespace) params.set('namespace', filter.namespace);
    if (filter?.producer) params.set('producer', filter.producer);
    if (filter?.consumer) params.set('consumer', filter.consumer);
    if (filter?.transport) params.set('transport', filter.transport);
    const qs = params.toString();
    return request<TopologyGraph>(`/topology${qs ? `?${qs}` : ''}`);
  },

  getHealth() {
    return request<HealthStatus>('/health');
  },

  /** wave26-b — richer registry health for the Dashboard health card. */
  getRegistryHealth() {
    type RegistryHealth = {
      registrySize: number;
      namespaceCount: number;
      deprecatedCount: number;
      orphanCount: number;
      manifestCount: number | null;
      signal: ComponentHealth;
      durable: ComponentHealth;
      capturedAt: string;
    };
    return request<RegistryHealth>('/health/registry');
  },

  /** Phase E7 — simple namespace list. */
  getNamespaces() {
    return request<{ count: number; items: Array<{ namespace: string; eventCount: number }> }>('/namespaces');
  },

  /** wave26-a — per-event publish rate history (last 60 samples). */
  getMetricsHistory(eventName?: string) {
    const qs = eventName ? `?eventName=${encodeURIComponent(eventName)}` : '';
    return request<Record<string, number[]>>(`/metrics/history${qs}`);
  },

  getMetrics() {
    return request<Record<string, EventStats>>('/metrics');
  },

  /** Raw Prometheus-format metrics from the root /metrics endpoint. */
  getPromMetrics() {
    return requestText('/metrics');
  },

  getSignalChannels() {
    return request<{ channels: ChannelInfo[]; total: number }>('/transports/signal/channels');
  },

  getDurableQueues() {
    return request<{ queues: QueueInfo[]; total: number }>('/transports/durable/queues');
  },

  getDLQ(eventName?: string, limit = 100) {
    const params = new URLSearchParams();
    if (eventName) params.set('eventName', eventName);
    params.set('limit', String(limit));
    return request<{ messages: DLQEntry[]; total: number; source?: string }>(`/transports/durable/dlq?${params.toString()}`);
  },

  replayDLQ(id: string) {
    return request<{ replayed: string; eventName: string }>(`/transports/durable/dlq/${encodeURIComponent(id)}/replay`, { method: 'POST' });
  },

  /** Phase E5.2 — redrive N DLQ entries in one call. Returns per-id outcomes. */
  batchReplayDLQ(ids: string[]) {
    return request<{
      replayed: Array<{ id: string; eventName: string }>;
      failed: Array<{ id: string; error: string }>;
      total: number;
    }>('/transports/durable/dlq/replay', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  deleteDLQ(id: string) {
    return request<{ removed: string }>(`/transports/durable/dlq/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Bulk-clear all DLQ entries, or all entries for one event when eventName is provided. */
  clearDLQ(eventName?: string) {
    const params = new URLSearchParams();
    if (eventName) params.set('eventName', eventName);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ cleared: number }>(`/transports/durable/dlq/clear${qs}`, { method: 'POST' });
  },

  /** wave26-f — bulk deprecate N events with a shared reason. */
  bulkDeprecate(names: string[], opts: { reason?: string; by?: string } = {}) {
    return request<{ deprecated: string[]; notFound: string[]; total: number }>(
      '/events/bulk/deprecate',
      { method: 'POST', body: JSON.stringify({ names, ...opts }) },
    );
  },

  /** wave26-f — returns the URL for a bulk JSON export (use as href or fetch). */
  bulkExportUrl(names: string[]): string {
    const qs = names.length > 0 ? `?names=${names.map(encodeURIComponent).join(',')}` : '';
    return `/api/events/bulk/export${qs}`;
  },

  /** wave26-e — list all events that exceeded the failure threshold. */
  getPoisonedEvents() {
    return request<{
      count: number;
      items: Array<{
        eventName: string;
        failuresInWindow: number;
        poisonedAt: string;
        threshold: number;
        windowMs: number;
      }>;
    }>('/events/poisoned');
  },

  /** wave26-e — clear (dismiss) poison state for one event. */
  clearPoison(eventName: string) {
    return request<{ cleared: string; wasPoison: boolean }>(
      `/events/${encodeURIComponent(eventName)}/poison`,
      { method: 'DELETE' },
    );
  },

  /** wave26-c — observed vs declared producer attribution for an event. */
  getObservedProducers(eventName: string) {
    return request<{
      eventName: string;
      declared: string[];
      observed: string[];
      undeclaredProducers: string[];
      deadDeclaredProducers: string[];
      mismatch: boolean;
    }>(`/events/${encodeURIComponent(eventName)}/producers/observed`);
  },

  /** wave24-b — list subscribers with their lastSeenAt timestamps. */
  getSubscribers(staleAfterSeconds?: number) {
    const qs = staleAfterSeconds && staleAfterSeconds > 0 ? `?staleAfter=${staleAfterSeconds}` : '';
    return request<{
      subscribers: Array<{ eventName: string; serviceName: string; lastSeenAt: string }>;
      total: number;
      filter?: { staleAfter: number };
    }>(`/subscribers${qs}`);
  },
};

export interface DLQEntry {
  id: string;
  eventName: string;
  payload: unknown;
  error: string;
  attempts: number;
  deadAt: string | number;
}
