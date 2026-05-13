export type TransportType = 'signal' | 'durable' | 'both';

export type CompatibilityMode = 'backward' | 'forward' | 'full' | 'none';

/**
 * Sub-type discriminator for envelope events whose actual contract varies
 * by a top-level payload field. E.g. `ingest:progress` carries 10 distinct
 * sub-shapes selected via `payload.type`. Declaring the discriminator lets
 * the catalog validate the discriminator value at publish time without
 * forcing one giant union schema.
 */
export interface EventDiscriminator {
  field: string;
  values: string[];
}

/**
 * Marks a previous name for an event that is still emitted by some producer
 * but should be treated as the canonical declaration when received.
 *
 * Replaces hand-rolled suppression sets (e.g. the gateway's
 * DEPRECATED_DUAL_EMIT_ALIASES) with a registry declaration consumers can
 * read.
 */
export interface EventAlias {
  name: string;
  deprecated: true;
  /** Optional cutoff date (ISO 8601) after which the alias will be removed. */
  until?: string;
}

export interface EventDeclaration {
  name: string;
  schema: Record<string, unknown>;
  transport: TransportType;
  /**
   * One or more producer service names. The single-string form is preserved
   * for backwards compatibility with v0.1.0; new declarations may use an
   * array when an event has multiple authoritative producers.
   */
  producer: string | string[];
  description?: string;
  tags?: string[];
  version?: number;
  compatibilityMode?: CompatibilityMode;

  // --- signal-only (transport === 'signal' | 'both') ---
  /**
   * Redis channel pattern producers publish to. May be a static string or
   * a function of the payload. Optional — when unset the catalog falls back
   * to its default channel-naming convention.
   */
  channel?: string | ((payload: unknown) => string);
  /** Validate `payload[field]` against `values` before publish. */
  discriminator?: EventDiscriminator;

  // --- durable-only (transport === 'durable' | 'both') ---
  /** Override the default queue-name derivation. */
  queue?: string;
  /** Per-queue message retention in seconds. */
  retention?: number;
  /** FIFO queue ordering (preserves per-group order). */
  fifo?: boolean;
  /** Partition key extractor — used by FIFO queues for per-group ordering. */
  partitionKey?: (payload: unknown) => string;
  /** Auto-route to DLQ after this many delivery attempts. */
  dlqAfterAttempts?: number;

  // --- both transports ---
  /** Deprecated alternate names for this event still being emitted. */
  aliases?: EventAlias[];
}

export interface SchemaHistoryEntry {
  version: number;
  schema: Record<string, unknown>;
  updatedAt: string;
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
  version: number;
  compatibilityMode: CompatibilityMode;
  schemaHistory: SchemaHistoryEntry[];
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
