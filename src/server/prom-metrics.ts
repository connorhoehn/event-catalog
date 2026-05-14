import { MetricsRegistry, formatPrometheus, type Counter, type Gauge } from 'distributed-core';

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

export class PromMetrics {
  private readonly registry: MetricsRegistry;
  private readonly publishCounters = new Map<string, Counter>();
  private readonly failureCounters = new Map<string, Counter>();
  private readonly schemaFetchCounters = new Map<string, Counter>();
  private readonly dlqGauges = new Map<string, Gauge>();

  constructor(registry?: MetricsRegistry) {
    // Use 'event_catalog' as namespace so the rendered name becomes
    // `event_catalog_publish_total` (formatPrometheus joins namespace
    // and name with `_`).
    this.registry = registry ?? new MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
  }

  /** Record an observed publish on the catalog service. */
  recordPublish(event: string, transport: 'signal' | 'durable' | 'both', mode: PublishMode = 'off'): void {
    const key = `${event}|${transport}|${mode}`;
    let counter = this.publishCounters.get(key);
    if (!counter) {
      counter = this.registry.counter(
        'publish_total',
        { event, transport, mode },
        'Total events published through the catalog, by transport and validation mode.',
      );
      this.publishCounters.set(key, counter);
    }
    counter.inc();
  }

  /** Record a publish failure with categorical reason. */
  recordFailure(event: string, reason: FailureReason): void {
    const key = `${event}|${reason}`;
    let counter = this.failureCounters.get(key);
    if (!counter) {
      counter = this.registry.counter(
        'publish_failures_total',
        { event, reason },
        'Total publish failures, categorized by failure mode.',
      );
      this.failureCounters.set(key, counter);
    }
    counter.inc();
  }

  /** Record a schema fetch (used by consumers pulling declarations). */
  recordSchemaFetch(event: string): void {
    let counter = this.schemaFetchCounters.get(event);
    if (!counter) {
      counter = this.registry.counter(
        'schema_fetches_total',
        { event },
        'Total schema fetches from the catalog registry.',
      );
      this.schemaFetchCounters.set(event, counter);
    }
    counter.inc();
  }

  /** Set the current DLQ depth for an event (gauge). */
  setDLQEntries(event: string, count: number): void {
    let gauge = this.dlqGauges.get(event);
    if (!gauge) {
      gauge = this.registry.gauge(
        'dlq_entries',
        { event },
        'Current dead-letter queue depth per event.',
      );
      this.dlqGauges.set(event, gauge);
    }
    gauge.set(count);
  }

  /** Render the registry as Prometheus text format. */
  renderProm(): string {
    return formatPrometheus(this.registry.getSnapshot());
  }

  /** Expose the underlying registry (for tests / advanced wiring). */
  getRegistry(): MetricsRegistry {
    return this.registry;
  }
}
