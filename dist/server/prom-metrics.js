"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromMetrics = void 0;
const distributed_core_1 = require("distributed-core");
class PromMetrics {
    registry;
    publishCounters = new Map();
    failureCounters = new Map();
    schemaFetchCounters = new Map();
    dlqGauges = new Map();
    constructor(registry) {
        // Use 'event_catalog' as namespace so the rendered name becomes
        // `event_catalog_publish_total` (formatPrometheus joins namespace
        // and name with `_`).
        this.registry = registry ?? new distributed_core_1.MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
    }
    /** Record an observed publish on the catalog service. */
    recordPublish(event, transport, mode = 'off') {
        const key = `${event}|${transport}|${mode}`;
        let counter = this.publishCounters.get(key);
        if (!counter) {
            counter = this.registry.counter('publish_total', { event, transport, mode }, 'Total events published through the catalog, by transport and validation mode.');
            this.publishCounters.set(key, counter);
        }
        counter.inc();
    }
    /** Record a publish failure with categorical reason. */
    recordFailure(event, reason) {
        const key = `${event}|${reason}`;
        let counter = this.failureCounters.get(key);
        if (!counter) {
            counter = this.registry.counter('publish_failures_total', { event, reason }, 'Total publish failures, categorized by failure mode.');
            this.failureCounters.set(key, counter);
        }
        counter.inc();
    }
    /** Record a schema fetch (used by consumers pulling declarations). */
    recordSchemaFetch(event) {
        let counter = this.schemaFetchCounters.get(event);
        if (!counter) {
            counter = this.registry.counter('schema_fetches_total', { event }, 'Total schema fetches from the catalog registry.');
            this.schemaFetchCounters.set(event, counter);
        }
        counter.inc();
    }
    /** Set the current DLQ depth for an event (gauge). */
    setDLQEntries(event, count) {
        let gauge = this.dlqGauges.get(event);
        if (!gauge) {
            gauge = this.registry.gauge('dlq_entries', { event }, 'Current dead-letter queue depth per event.');
            this.dlqGauges.set(event, gauge);
        }
        gauge.set(count);
    }
    /** Render the registry as Prometheus text format. */
    renderProm() {
        return (0, distributed_core_1.formatPrometheus)(this.registry.getSnapshot());
    }
    /** Expose the underlying registry (for tests / advanced wiring). */
    getRegistry() {
        return this.registry;
    }
}
exports.PromMetrics = PromMetrics;
//# sourceMappingURL=prom-metrics.js.map