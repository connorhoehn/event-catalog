import { MetricsRegistry } from 'distributed-core';
/**
 * Prom-formatted metrics surface for the event-catalog service.
 *
 * Separate from `MetricsCollector` (which powers the JSON admin API
 * with per-event stats). This registry is dedicated to the
 * Prometheus `/metrics` scrape endpoint.
 *
 * The two classes both register a metric named `publish_total` but
 * label it differently (`{event}` there, `{event, transport, mode}`
 * here), so they must never share a namespace: one metric family with
 * inconsistent label names is invalid exposition and a scraper drops
 * the whole family. `event_catalog` belongs to this file;
 * `MetricsCollector` uses `COLLECTOR_METRIC_NAMESPACE`
 * (`event_catalog_stats`) so the names stay distinct even if the two
 * registries are ever merged or the JSON one is ever rendered.
 *
 * ## Metric families
 *
 * Publish / consumer flow:
 *   - event_catalog_publish_total{event, transport, mode}          counter
 *   - event_catalog_publish_failures_total{event, reason}          counter
 *   - event_catalog_schema_fetches_total{event}                    counter
 *   - event_catalog_schema_evolution_rejections_total{event, mode} counter
 *
 * Backlog / saturation:
 *   - event_catalog_dlq_entries{event}                             gauge
 *   - event_catalog_dlq_oldest_age_seconds                         gauge
 *   - event_catalog_sse_streams_active                             gauge
 *   - event_catalog_sse_streams_max                                gauge
 *   - event_catalog_sse_streams_rejected_total                     counter
 *
 * Dependency + inventory health:
 *   - event_catalog_transport_up{transport}                        gauge (1/0)
 *   - event_catalog_transport_probe_latency_seconds{transport}     gauge
 *   - event_catalog_registry_events                                gauge
 *   - event_catalog_poisoned_events                                gauge
 *
 * Self-observability:
 *   - event_catalog_metric_label_overflow_total{label}             counter
 *
 * The metric names match the Prometheus convention even though
 * MetricsRegistry uses dotted names internally — `formatPrometheus`
 * rewrites `.` → `_` on render. Counters carry `_total`; gauges do
 * not. Every duration is in seconds and says so in its name.
 *
 * ## Cardinality
 *
 * Two label values on this surface come from input the service does not
 * control: the `event` label, and it reaches us from three places that
 * are NOT all bounded by the ~200 committed declarations —
 *
 *   1. `recordSchemaFetch` / `recordPublish` — a registry name, and the
 *      registry is writable over HTTP (`POST /api/events`, and
 *      `/api/events/bulk` takes 1000 at a time with no ceiling on
 *      requests).
 *   2. `recordFailure` from the dead-letter hook — the `eventName` off a
 *      dead-lettered envelope, which never passed through
 *      `validateEventName` and is frequently an event the catalog has
 *      never heard of (that is often *why* it dead-lettered).
 *   3. `setDLQEntries` from the DLQ scan — same provenance as (2).
 *
 * An unbounded label value is how you take down a Prometheus server, so
 * every event label goes through `eventLabel()`: the first
 * `maxEventLabels` distinct names get their own series and everything
 * after that collapses into `event="other"`, with the collapse itself
 * counted so an operator can see the allowlist is undersized rather
 * than silently losing detail. `transport` / `mode` / `reason` /
 * `transport-name` are closed sets, enforced at runtime rather than
 * trusted from the type signature.
 *
 * ## Escaping
 *
 * distributed-core's `formatPrometheus` interpolates label values into
 * `key="value"` with no escaping at all, so a single event name
 * containing a `"` renders a malformed exposition line and Prometheus
 * drops the ENTIRE scrape — every metric, not just that series.
 * `validateEventName` rejects only control characters, so `evt"x` is a
 * perfectly declarable name today, and DLQ-sourced names bypass that
 * validation entirely. Label values are therefore escaped here, before
 * they are handed to the registry.
 */
/**
 * Namespace prefixed onto every metric rendered at `/metrics`.
 * Owned exclusively by this class — see the class doc above.
 */
export declare const PROM_METRIC_NAMESPACE = "event_catalog";
export type PublishMode = 'strict' | 'warn' | 'off';
export type FailureReason = 'schema' | 'transport' | 'network';
export type TransportName = 'redis' | 'message-queue';
/** Label value used for anything outside a closed set or past the cap. */
export declare const OVERFLOW_LABEL = "other";
/**
 * Ceiling on distinct `event` label values across the whole surface.
 *
 * The committed registry snapshot holds 194 events; 512 leaves generous
 * head-room for legitimate growth while keeping the worst-case series
 * count on this endpoint in the low thousands. Override with
 * `EVENT_CATALOG_MAX_METRIC_EVENT_LABELS`.
 */
export declare const DEFAULT_MAX_EVENT_LABELS = 512;
/**
 * Ceiling on the rendered length of one label value.
 * `MAX_EVENT_NAME_LENGTH` is 512 characters, which is a lot of bytes to
 * repeat on every series of every scrape.
 */
export declare const MAX_LABEL_VALUE_LENGTH = 200;
/**
 * Escape a label value for the Prometheus text exposition format.
 *
 * The format escapes exactly three characters inside a quoted label
 * value: `\`, `"` and newline. Other C0 control characters and DEL are
 * not escapable and break line-oriented parsers, so they are dropped —
 * they cannot appear in a declared name (`validateEventName` rejects
 * them) but can arrive on the DLQ path.
 */
export declare function escapeLabelValue(raw: string): string;
export interface PromMetricsOptions {
    /** Max distinct `event` label values before collapsing to `other`. */
    maxEventLabels?: number;
}
export declare class PromMetrics {
    private readonly registry;
    private readonly publishCounters;
    private readonly failureCounters;
    private readonly schemaFetchCounters;
    private readonly evolutionCounters;
    private readonly dlqGauges;
    private readonly transportUpGauges;
    private readonly transportLatencyGauges;
    private readonly overflowCounters;
    private readonly collectors;
    /** raw event name → bounded, escaped label value. */
    private readonly eventLabels;
    private readonly maxEventLabels;
    private registryGauge;
    private poisonedGauge;
    private dlqOldestAgeGauge;
    private sseActiveGauge;
    private sseMaxGauge;
    private sseRejectedCounter;
    constructor(registry?: MetricsRegistry, options?: PromMetricsOptions);
    /**
     * Map a raw event name to the label value used on the wire.
     *
     * The first `maxEventLabels` distinct names each get a series; every
     * name after that collapses into `other` so an unbounded source (a
     * DLQ full of undeclared names, a flooded bulk-declare) cannot mint
     * unbounded series. The collapse is itself counted.
     */
    private eventLabel;
    /** Constrain a value to a closed set, bucketing anything unexpected. */
    private closed;
    private overflow;
    /** Distinct event label values currently held (for tests / diagnostics). */
    get eventLabelCount(): number;
    /** Record an observed publish on the catalog service. */
    recordPublish(event: string, transport: 'signal' | 'durable' | 'both', mode?: PublishMode): void;
    /** Record a publish failure with categorical reason. */
    recordFailure(event: string, reason: FailureReason): void;
    /** Record a schema fetch (used by consumers pulling declarations). */
    recordSchemaFetch(event: string): void;
    /**
     * Record a declaration rejected by the schema-evolution compat gate.
     *
     * `mode` is the enforcement level the gate was running at, so a
     * dashboard can separate "we blocked this" (`strict`) from "we would
     * have blocked this" (`warn`) — the second is what tells an operator a
     * strict rollout is safe.
     */
    recordEvolutionRejection(event: string, mode: 'warn' | 'strict'): void;
    /**
     * Set the current DLQ depth for one event.
     *
     * Prefer `syncDLQEntries` for a periodic refresh: this method only
     * ever raises or lowers gauges it is told about, so an event whose
     * DLQ has drained keeps reporting its last non-zero depth forever.
     */
    setDLQEntries(event: string, count: number): void;
    /**
     * Replace the whole DLQ-depth picture from one scan.
     *
     * Every event present in `counts` is set to its count and every event
     * that has a gauge but is absent from `counts` is set to 0 — an event
     * whose DLQ drained must read zero, not keep displaying the depth it
     * had the last time it was non-empty. Gauges are zeroed rather than
     * deleted so `rate`/`delta` queries see the drop instead of a series
     * that silently vanishes.
     *
     * Callers must not invoke this with a partial scan (e.g. after the DLQ
     * store threw) — that would report an empty DLQ during exactly the
     * outage where the depth matters.
     */
    syncDLQEntries(counts: ReadonlyMap<string, number>): void;
    /** Age of the oldest entry anywhere in the DLQ, in seconds. */
    setDLQOldestAgeSeconds(seconds: number): void;
    private dlqGauge;
    /**
     * Current and maximum concurrent SSE streams.
     *
     * Both are exported so saturation is a single query
     * (`active / max`) instead of requiring the operator to remember what
     * `DEFAULT_MAX_SSE_STREAMS` was compiled as. `max` is 0 when the cap
     * is disabled.
     */
    setSseStreams(active: number, max: number): void;
    /** An SSE connection was refused because the cap was already reached. */
    recordSseRejected(): void;
    /** 1 when the transport's last probe was connected, 0 otherwise. */
    setTransportUp(transport: TransportName, up: boolean): void;
    /**
     * Last observed health-probe latency for a transport, in seconds.
     *
     * `SignalTransport.healthCheck()` / `DurableTransport.healthCheck()`
     * report milliseconds; convert at the call site, because the metric
     * name promises seconds.
     */
    setTransportProbeLatencySeconds(transport: TransportName, seconds: number): void;
    /**
     * Events currently marked poisoned by `PoisonEventDetector`.
     *
     * Kept as a single count rather than a per-event series: the names are
     * the same unbounded source as everything else here, and the alert an
     * operator wants is "anything is poisoned", with
     * `GET /api/events/poisoned` for the detail.
     */
    setPoisonedEvents(count: number): void;
    /** Number of declarations currently in the registry. */
    setRegistrySize(count: number): void;
    /**
     * Register a scrape-time collector for pull-style values (registry
     * size, SSE occupancy, transport health). Returns an unregister fn.
     *
     * Collectors run immediately before the snapshot is taken so a gauge
     * reflects the moment of the scrape rather than the last time
     * something happened to push it. A throwing collector is swallowed:
     * one broken source must not take the whole endpoint down.
     */
    collect(fn: () => void): () => void;
    /** Render the registry as Prometheus text format. */
    renderProm(): string;
    /** Expose the underlying registry (for tests / advanced wiring). */
    getRegistry(): MetricsRegistry;
}
//# sourceMappingURL=prom-metrics.d.ts.map