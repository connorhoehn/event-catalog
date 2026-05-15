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
  /**
   * Phase E7 — domain namespace this event belongs to (e.g. `pipeline`,
   * `ws`, `sfu`, `social`). When omitted, auto-derived from the event
   * name's dotted prefix (or colon prefix for legacy colon-form names).
   * Becomes required in v0.5; the auto-derive bridge is the soft
   * migration window.
   */
  namespace?: string;
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
  /**
   * Phase EC-7 — per-event enforcement override for the server-side
   * compat gate on `POST /api/events`. Orthogonal to `compatibilityMode`
   * (which governs the evolution semantics: backward/forward/full/none).
   *
   *  - `'off'`    — accept any update, no warning.
   *  - `'warn'`   — accept breaking update, log advisory + return
   *                 violations in the 201 response.
   *  - `'strict'` — reject breaking update with HTTP 409 + structured
   *                 `COMPAT_VIOLATION` error.
   *
   * When unset, falls back to the per-request `x-event-catalog-strict`
   * header (`'true'` ⇒ strict) and then the `EVENT_CATALOG_STRICT` env
   * var (`'true'` ⇒ strict, default `'off'` / `'warn'`-ish).
   */
  compatMode?: 'off' | 'warn' | 'strict';

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
  /**
   * Phase E5.3 — per-event DLQ retention in seconds. Overrides the
   * global 30-day default. Used to keep high-value audit events longer
   * than transient webhook failures, or to age short-lived events out
   * of DDB sooner.
   */
  dlqRetention?: number;

  // --- both transports ---
  /** Deprecated alternate names for this event still being emitted. */
  aliases?: EventAlias[];
}

export interface SchemaHistoryEntry {
  version: number;
  schema: Record<string, unknown>;
  /**
   * Phase E6.5 — sha256 fingerprint of the historical schema, for
   * "is the fingerprint I have stashed somewhere in this history?"
   * queries. Always populated for entries written after wave19-h;
   * older entries persisted before that wave may be missing it
   * (consumers should treat absence as "unknown").
   */
  fingerprint?: string;
  updatedAt: string;
}

export interface EventCatalogConfig {
  redis: { url: string };
  messageQueue: { url: string };
  serviceName: string;
  registryUrl?: string;
  /**
   * Phase E4.1 — when true, `EventCatalog.declare()` throws on schema
   * incompatibility instead of logging advisory violations. Defaults to
   * the value of the `EVENT_CATALOG_STRICT` env var (`'true'` enables).
   */
  strict?: boolean;
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
  /**
   * Phase 20-b — pause forwarding. The underlying transport keeps
   * receiving (so no Redis unsubscribe), but the handler is skipped
   * until `resume()` is called. Drops events during pause; callers
   * that need replay should buffer at the handler layer.
   */
  pause(): void;
  /** Phase 20-b — resume forwarding. No-op if already running. */
  resume(): void;
  /** Phase 20-b — current pause state. */
  isPaused(): boolean;
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

// Optional filter passed to `getTopology()`. Filters are AND-combined: an
// event is included only when every supplied predicate matches. Empty/unset
// filter returns the full graph. The result is "induced" — nodes referenced
// by surviving events (their producers + subscribers) come along for free,
// but their unrelated events do not.
export interface TopologyFilter {
  /** Include only events published by this service. */
  producer?: string;
  /** Include only events subscribed by this service. */
  consumer?: string;
  /** Include only this exact event name. */
  eventType?: string;
  /** Include only events on this transport. */
  transport?: string;
  /** Phase E7 — include only events in this namespace. */
  namespace?: string;
}

export interface HealthStatus {
  redis: 'connected' | 'disconnected';
  messageQueue: 'connected' | 'disconnected';
  uptime: number;
  eventCount: number;
}

export interface RegistryEntry extends Omit<EventDeclaration, 'namespace'> {
  /**
   * Phase E7 — always populated by the Registry, either from the
   * declaration's explicit `namespace` field or auto-derived from `name`.
   */
  namespace: string;
  version: number;
  /**
   * Phase E6 — deterministic sha256 of the canonical (sorted-key) schema
   * serialization. Consumers cache + compare to detect drift without a
   * round-trip. Recomputed when the schema changes. Lowercase 64-char hex.
   */
  schemaFingerprint: string;
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
  /** Phase E7 — restrict to events in this namespace. */
  namespace?: string;
}
