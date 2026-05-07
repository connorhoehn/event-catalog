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

// Types matching the server API responses
export interface EventEntry {
  name: string;
  transport: 'signal' | 'durable';
  producer: string;
  description?: string;
  tags?: string[];
  schema: Record<string, unknown>;
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

export interface HealthStatus {
  status: string;
  redis: string;
  messageQueue: string;
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

  getTopology() {
    return request<TopologyGraph>('/topology');
  },

  getHealth() {
    return request<HealthStatus>('/health');
  },

  getMetrics() {
    return request<Record<string, EventStats>>('/metrics');
  },

  getSignalChannels() {
    return request<{ channels: ChannelInfo[]; total: number }>('/transports/signal/channels');
  },

  getDurableQueues() {
    return request<{ queues: QueueInfo[]; total: number }>('/transports/durable/queues');
  },
};
