export type TransportType = 'signal' | 'durable';

export interface EventDeclaration {
  name: string;
  schema: Record<string, unknown>;
  transport: TransportType;
  producer: string;
  description?: string;
  tags?: string[];
}

export interface EventCatalogConfig {
  redis: { url: string };
  messageQueue: { url: string };
  serviceName: string;
  registryUrl?: string;
}

export interface PublishOptions {
  headers?: Record<string, string>;
  correlationId?: string;
  timestamp?: number;
}

export interface SubscribeOptions {
  pollingInterval?: number;
  batchSize?: number;
  visibilityTimeout?: number;
}

export interface EventMetadata {
  id: string;
  producer: string;
  timestamp: number;
  correlationId?: string;
  headers?: Record<string, string>;
}

export interface EventEnvelope<T = unknown> {
  eventName: string;
  payload: T;
  metadata: EventMetadata;
}

export type EventHandler<T = unknown> = (envelope: EventEnvelope<T>) => Promise<void> | void;

export interface Subscription {
  unsubscribe(): Promise<void>;
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

export interface TopologyNode {
  id: string;
  type: 'service' | 'event';
  metadata: Record<string, unknown>;
}

export interface TopologyEdge {
  from: string;
  to: string;
  relation: 'publishes' | 'subscribes';
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface HealthStatus {
  redis: 'connected' | 'disconnected';
  messageQueue: 'connected' | 'disconnected';
  uptime: number;
  eventCount: number;
}

export interface RegistryEntry extends EventDeclaration {
  subscribers: string[];
  metadata: {
    createdAt: string;
    lastPublishedAt: string | null;
    publishCount: number;
    errorCount: number;
  };
}

export interface RegistryFilter {
  transport?: TransportType;
  producer?: string;
  subscriber?: string;
  tag?: string;
}
