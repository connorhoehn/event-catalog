import type { DurableTransportConfig, DurableHandlerContext, DurablePublishOptions, SubscriptionHandle } from '../client/durable';
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
    /**
     * Redis channel pattern producers publish to. May be a static string or
     * a function of the payload. Optional — when unset the catalog falls back
     * to its default channel-naming convention.
     */
    channel?: string | ((payload: unknown) => string);
    /** Validate `payload[field]` against `values` before publish. */
    discriminator?: EventDiscriminator;
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
/**
 * Phase 20-h — per-namespace defaults inheritance.
 *
 * Operators register a NamespacePolicy per namespace; declarations
 * inherit any field they don't explicitly set. Reduces repetition for
 * "every pipeline.* event needs `compatibilityMode: 'full'` and 30d
 * retention" patterns. Per-event values always win when present.
 */
export interface NamespacePolicy {
    compatibilityMode?: CompatibilityMode;
    /** Default queue message retention for durable events. */
    retention?: number;
    /** Default DLQ retention. */
    dlqRetention?: number;
    /** Default DLQ-after-N-attempts. */
    dlqAfterAttempts?: number;
    /** Default tags merged with per-event tags (deduplicated). */
    tags?: string[];
}
export interface EventCatalogConfig {
    redis: {
        url: string;
    };
    messageQueue: Omit<DurableTransportConfig, 'logger'>;
    serviceName: string;
    registryUrl?: string;
    /**
     * Phase E4.1 — when true, `EventCatalog.declare()` throws on schema
     * incompatibility instead of logging advisory violations. Defaults to
     * the value of the `EVENT_CATALOG_STRICT` env var (`'true'` enables).
     */
    strict?: boolean;
    /**
     * Phase 20-h — per-namespace defaults. When a declaration omits a
     * policy field, the namespace's policy fills it in. Per-event
     * values always override the policy default.
     */
    namespacePolicies?: Record<string, NamespacePolicy>;
    /**
     * Phase 20-c — publish-path middleware. Hooks run in array order.
     * `beforePublish` may mutate `envelope.metadata.headers` (inject
     * traceId, correlationId, etc.) and may throw to reject the publish.
     * `afterPublish` is informational and post-transport-send;
     * exceptions thrown from `afterPublish` are caught and logged so a
     * downstream audit failure can't mask a successful publish.
     */
    hooks?: PublishHook[];
    /**
     * wave25-a — when true (default), publishing a deprecated event
     * logs a one-time `console.warn` per event per process. Set false
     * to suppress the noise (e.g. for the producer that's still being
     * migrated and is intentionally on the deprecated path).
     */
    warnOnDeprecated?: boolean;
}
/**
 * Phase 20-c — publish-path middleware contract.
 *
 * Both methods are optional so a hook can implement either or both. The
 * `entry` parameter is the canonical RegistryEntry (post-alias-resolution),
 * giving hooks access to namespace, tags, fingerprint, etc.
 *
 * Use cases:
 *   - tracing: `beforePublish` injects `traceparent` into metadata.headers
 *   - audit: `afterPublish` writes the envelope to an audit sink
 *   - transformation: `beforePublish` redacts payload fields by tag
 *   - rate-limiting: `beforePublish` throws when a quota is exceeded
 */
export interface PublishHook {
    beforePublish?(envelope: EventEnvelope, entry: RegistryEntry): Promise<void> | void;
    afterPublish?(envelope: EventEnvelope, entry: RegistryEntry): Promise<void> | void;
}
export interface PublishOptions extends Pick<DurablePublishOptions, 'groupId' | 'deduplicationId' | 'delaySeconds' | 'signal' | 'timeoutMs'> {
    headers?: Record<string, string>;
    correlationId?: string;
    timestamp?: number;
}
export interface SubscribeOptions {
    pollingInterval?: number;
    batchSize?: number;
    visibilityTimeout?: number;
    /**
     * Durable only: receive through this queue-owned subscription instead of
     * the default delivery scope. Provision it with the queue owner; the
     * catalog never creates or deletes it, and `unsubscribe()` only stops
     * intake and drains handlers. Rejected for signal-only events.
     */
    subscription?: SubscriptionHandle;
    /** Durable only: observe intake ending because `subscription` became stale or was removed. */
    onTerminalError?: (error: Error) => void;
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
export type EventHandler<T = unknown> = (envelope: EventEnvelope<T>, context?: DurableHandlerContext) => Promise<void> | void;
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
    /** Durable subscriptions: why intake ended on its own (stale or removed subscription). */
    terminalError?(): Error | undefined;
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
    /**
     * wave25-a — schema deprecation lifecycle. Set when an event is marked
     * deprecated via Registry.deprecate(); cleared by undeprecate(). Publish
     * still works for deprecated events (don't break existing producers); the
     * library logs a one-time warn per event when warnOnDeprecated is on.
     */
    deprecation?: {
        deprecatedAt: string;
        reason?: string;
        by?: string;
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
//# sourceMappingURL=index.d.ts.map