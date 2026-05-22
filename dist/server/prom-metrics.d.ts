import { MetricsRegistry } from 'distributed-core';
/**
 * Prom-formatted metrics surface for the event-catalog service.
 *
 * Separate from `MetricsCollector` (which powers the JSON admin API
 * with per-event stats). This registry is dedicated to the
 * Prometheus `/metrics` scrape endpoint and exposes the four
 * counters/gauges defined in the wave2-ec-5 charter:
 *
 *   - event_catalog_publish_total{event, transport, mode}
 *   - event_catalog_publish_failures_total{event, reason}
 *   - event_catalog_schema_fetches_total{event}
 *   - event_catalog_dlq_entries{event}
 *
 * The metric names match the Prometheus convention even though
 * MetricsRegistry uses dotted names internally — `formatPrometheus`
 * rewrites `.` → `_` on render.
 */
export type PublishMode = 'strict' | 'warn' | 'off';
export type FailureReason = 'schema' | 'transport' | 'network';
export declare class PromMetrics {
    private readonly registry;
    private readonly publishCounters;
    private readonly failureCounters;
    private readonly schemaFetchCounters;
    private readonly dlqGauges;
    constructor(registry?: MetricsRegistry);
    /** Record an observed publish on the catalog service. */
    recordPublish(event: string, transport: 'signal' | 'durable' | 'both', mode?: PublishMode): void;
    /** Record a publish failure with categorical reason. */
    recordFailure(event: string, reason: FailureReason): void;
    /** Record a schema fetch (used by consumers pulling declarations). */
    recordSchemaFetch(event: string): void;
    /** Set the current DLQ depth for an event (gauge). */
    setDLQEntries(event: string, count: number): void;
    /** Render the registry as Prometheus text format. */
    renderProm(): string;
    /** Expose the underlying registry (for tests / advanced wiring). */
    getRegistry(): MetricsRegistry;
}
//# sourceMappingURL=prom-metrics.d.ts.map