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
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disconnected';
  latencyMs?: number;
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
