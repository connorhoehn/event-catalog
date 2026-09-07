"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromMetrics = exports.MAX_LABEL_VALUE_LENGTH = exports.DEFAULT_MAX_EVENT_LABELS = exports.OVERFLOW_LABEL = void 0;
exports.escapeLabelValue = escapeLabelValue;
const distributed_core_1 = require("distributed-core");
/** Closed sets — anything outside them is bucketed rather than trusted. */
const PUBLISH_MODES = new Set(['strict', 'warn', 'off']);
const TRANSPORTS = new Set(['signal', 'durable', 'both']);
const FAILURE_REASONS = new Set(['schema', 'transport', 'network']);
const TRANSPORT_NAMES = new Set(['redis', 'message-queue']);
/** Label value used for anything outside a closed set or past the cap. */
exports.OVERFLOW_LABEL = 'other';
/**
 * Ceiling on distinct `event` label values across the whole surface.
 *
 * The committed registry snapshot holds 194 events; 512 leaves generous
 * head-room for legitimate growth while keeping the worst-case series
 * count on this endpoint in the low thousands. Override with
 * `EVENT_CATALOG_MAX_METRIC_EVENT_LABELS`.
 */
exports.DEFAULT_MAX_EVENT_LABELS = 512;
/**
 * Ceiling on the rendered length of one label value.
 * `MAX_EVENT_NAME_LENGTH` is 512 characters, which is a lot of bytes to
 * repeat on every series of every scrape.
 */
exports.MAX_LABEL_VALUE_LENGTH = 200;
/**
 * Escape a label value for the Prometheus text exposition format.
 *
 * The format escapes exactly three characters inside a quoted label
 * value: `\`, `"` and newline. Other C0 control characters and DEL are
 * not escapable and break line-oriented parsers, so they are dropped —
 * they cannot appear in a declared name (`validateEventName` rejects
 * them) but can arrive on the DLQ path.
 */
function escapeLabelValue(raw) {
    let out = '';
    for (const ch of raw) {
        const code = ch.codePointAt(0);
        if (ch === '\\')
            out += '\\\\';
        else if (ch === '"')
            out += '\\"';
        else if (ch === '\n')
            out += '\\n';
        else if (code <= 0x1f || code === 0x7f)
            continue;
        else
            out += ch;
    }
    return out;
}
/** Escape, then bound the length so one name cannot bloat every scrape. */
function sanitizeLabelValue(raw) {
    const escaped = escapeLabelValue(raw);
    if (escaped.length <= exports.MAX_LABEL_VALUE_LENGTH)
        return escaped;
    // Truncating could land on a lone trailing backslash and re-break the
    // escaping, so trim any odd run of trailing backslashes back off.
    let cut = escaped.slice(0, exports.MAX_LABEL_VALUE_LENGTH);
    let trailing = 0;
    while (trailing < cut.length && cut[cut.length - 1 - trailing] === '\\')
        trailing++;
    if (trailing % 2 === 1)
        cut = cut.slice(0, -1);
    return cut;
}
function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.trunc(parsed);
}
class PromMetrics {
    registry;
    publishCounters = new Map();
    failureCounters = new Map();
    schemaFetchCounters = new Map();
    evolutionCounters = new Map();
    dlqGauges = new Map();
    transportUpGauges = new Map();
    transportLatencyGauges = new Map();
    overflowCounters = new Map();
    collectors = new Set();
    /** raw event name → bounded, escaped label value. */
    eventLabels = new Map();
    maxEventLabels;
    registryGauge = null;
    poisonedGauge = null;
    dlqOldestAgeGauge = null;
    sseActiveGauge = null;
    sseMaxGauge = null;
    sseRejectedCounter = null;
    constructor(registry, options = {}) {
        // Use 'event_catalog' as namespace so the rendered name becomes
        // `event_catalog_publish_total` (formatPrometheus joins namespace
        // and name with `_`).
        this.registry = registry ?? new distributed_core_1.MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
        this.maxEventLabels = options.maxEventLabels
            ?? envInt('EVENT_CATALOG_MAX_METRIC_EVENT_LABELS', exports.DEFAULT_MAX_EVENT_LABELS);
    }
    // -------------------------------------------------------------------
    // Label bounding
    // -------------------------------------------------------------------
    /**
     * Map a raw event name to the label value used on the wire.
     *
     * The first `maxEventLabels` distinct names each get a series; every
     * name after that collapses into `other` so an unbounded source (a
     * DLQ full of undeclared names, a flooded bulk-declare) cannot mint
     * unbounded series. The collapse is itself counted.
     */
    eventLabel(raw) {
        const cached = this.eventLabels.get(raw);
        if (cached !== undefined)
            return cached;
        if (this.eventLabels.size >= this.maxEventLabels) {
            this.overflow('event');
            return exports.OVERFLOW_LABEL;
        }
        const value = sanitizeLabelValue(raw);
        this.eventLabels.set(raw, value);
        return value;
    }
    /** Constrain a value to a closed set, bucketing anything unexpected. */
    closed(value, allowed, label) {
        if (allowed.has(value))
            return value;
        this.overflow(label);
        return exports.OVERFLOW_LABEL;
    }
    overflow(label) {
        let counter = this.overflowCounters.get(label);
        if (!counter) {
            counter = this.registry.counter('metric_label_overflow_total', { label }, 'Times a label value was bucketed into "other" because it exceeded the cardinality cap or fell outside its closed set.');
            this.overflowCounters.set(label, counter);
        }
        counter.inc();
    }
    /** Distinct event label values currently held (for tests / diagnostics). */
    get eventLabelCount() {
        return this.eventLabels.size;
    }
    // -------------------------------------------------------------------
    // Publish flow
    // -------------------------------------------------------------------
    /** Record an observed publish on the catalog service. */
    recordPublish(event, transport, mode = 'off') {
        const e = this.eventLabel(event);
        const t = this.closed(transport, TRANSPORTS, 'transport');
        const m = this.closed(mode, PUBLISH_MODES, 'mode');
        const key = `${e}|${t}|${m}`;
        let counter = this.publishCounters.get(key);
        if (!counter) {
            counter = this.registry.counter('publish_total', { event: e, transport: t, mode: m }, 'Total events published through the catalog, by transport and validation mode.');
            this.publishCounters.set(key, counter);
        }
        counter.inc();
    }
    /** Record a publish failure with categorical reason. */
    recordFailure(event, reason) {
        const e = this.eventLabel(event);
        const r = this.closed(reason, FAILURE_REASONS, 'reason');
        const key = `${e}|${r}`;
        let counter = this.failureCounters.get(key);
        if (!counter) {
            counter = this.registry.counter('publish_failures_total', { event: e, reason: r }, 'Total publish failures, categorized by failure mode.');
            this.failureCounters.set(key, counter);
        }
        counter.inc();
    }
    /** Record a schema fetch (used by consumers pulling declarations). */
    recordSchemaFetch(event) {
        const e = this.eventLabel(event);
        let counter = this.schemaFetchCounters.get(e);
        if (!counter) {
            counter = this.registry.counter('schema_fetches_total', { event: e }, 'Total schema fetches from the catalog registry.');
            this.schemaFetchCounters.set(e, counter);
        }
        counter.inc();
    }
    /**
     * Record a declaration rejected by the schema-evolution compat gate.
     *
     * `mode` is the enforcement level the gate was running at, so a
     * dashboard can separate "we blocked this" (`strict`) from "we would
     * have blocked this" (`warn`) — the second is what tells an operator a
     * strict rollout is safe.
     */
    recordEvolutionRejection(event, mode) {
        const e = this.eventLabel(event);
        const m = this.closed(mode, PUBLISH_MODES, 'mode');
        const key = `${e}|${m}`;
        let counter = this.evolutionCounters.get(key);
        if (!counter) {
            counter = this.registry.counter('schema_evolution_rejections_total', { event: e, mode: m }, 'Declarations rejected (strict) or flagged (warn) by the schema-evolution compatibility gate.');
            this.evolutionCounters.set(key, counter);
        }
        counter.inc();
    }
    // -------------------------------------------------------------------
    // DLQ
    // -------------------------------------------------------------------
    /**
     * Set the current DLQ depth for one event.
     *
     * Prefer `syncDLQEntries` for a periodic refresh: this method only
     * ever raises or lowers gauges it is told about, so an event whose
     * DLQ has drained keeps reporting its last non-zero depth forever.
     */
    setDLQEntries(event, count) {
        this.dlqGauge(this.eventLabel(event)).set(count);
    }
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
    syncDLQEntries(counts) {
        const seen = new Set();
        for (const [event, count] of counts) {
            const label = this.eventLabel(event);
            // Overflowed names all share the `other` label, so accumulate
            // rather than overwrite or the last one wins.
            const gauge = this.dlqGauge(label);
            gauge.set(seen.has(label) ? gauge.get() + count : count);
            seen.add(label);
        }
        for (const [label, gauge] of this.dlqGauges) {
            if (!seen.has(label))
                gauge.set(0);
        }
    }
    /** Age of the oldest entry anywhere in the DLQ, in seconds. */
    setDLQOldestAgeSeconds(seconds) {
        if (!this.dlqOldestAgeGauge) {
            this.dlqOldestAgeGauge = this.registry.gauge('dlq_oldest_age_seconds', {}, 'Age in seconds of the oldest entry in the dead-letter queue; 0 when the DLQ is empty.');
        }
        this.dlqOldestAgeGauge.set(seconds);
    }
    dlqGauge(label) {
        let gauge = this.dlqGauges.get(label);
        if (!gauge) {
            gauge = this.registry.gauge('dlq_entries', { event: label }, 'Current dead-letter queue depth per event.');
            this.dlqGauges.set(label, gauge);
        }
        return gauge;
    }
    // -------------------------------------------------------------------
    // SSE saturation
    // -------------------------------------------------------------------
    /**
     * Current and maximum concurrent SSE streams.
     *
     * Both are exported so saturation is a single query
     * (`active / max`) instead of requiring the operator to remember what
     * `DEFAULT_MAX_SSE_STREAMS` was compiled as. `max` is 0 when the cap
     * is disabled.
     */
    setSseStreams(active, max) {
        if (!this.sseActiveGauge) {
            this.sseActiveGauge = this.registry.gauge('sse_streams_active', {}, 'Currently open Server-Sent-Events streams across /api/flow and /api/audit.');
        }
        if (!this.sseMaxGauge) {
            this.sseMaxGauge = this.registry.gauge('sse_streams_max', {}, 'Configured ceiling on concurrent SSE streams; 0 when the cap is disabled.');
        }
        this.sseActiveGauge.set(active);
        this.sseMaxGauge.set(max);
    }
    /** An SSE connection was refused because the cap was already reached. */
    recordSseRejected() {
        if (!this.sseRejectedCounter) {
            this.sseRejectedCounter = this.registry.counter('sse_streams_rejected_total', {}, 'SSE connections refused because the concurrent-stream cap was saturated.');
        }
        this.sseRejectedCounter.inc();
    }
    // -------------------------------------------------------------------
    // Dependency health + inventory
    // -------------------------------------------------------------------
    /** 1 when the transport's last probe was connected, 0 otherwise. */
    setTransportUp(transport, up) {
        const t = this.closed(transport, TRANSPORT_NAMES, 'transport_name');
        let gauge = this.transportUpGauges.get(t);
        if (!gauge) {
            gauge = this.registry.gauge('transport_up', { transport: t }, 'Whether the last health probe of this transport succeeded (1) or not (0).');
            this.transportUpGauges.set(t, gauge);
        }
        gauge.set(up ? 1 : 0);
    }
    /**
     * Last observed health-probe latency for a transport, in seconds.
     *
     * `SignalTransport.healthCheck()` / `DurableTransport.healthCheck()`
     * report milliseconds; convert at the call site, because the metric
     * name promises seconds.
     */
    setTransportProbeLatencySeconds(transport, seconds) {
        const t = this.closed(transport, TRANSPORT_NAMES, 'transport_name');
        let gauge = this.transportLatencyGauges.get(t);
        if (!gauge) {
            gauge = this.registry.gauge('transport_probe_latency_seconds', { transport: t }, 'Latency in seconds of the most recent health probe against this transport.');
            this.transportLatencyGauges.set(t, gauge);
        }
        gauge.set(seconds);
    }
    /**
     * Events currently marked poisoned by `PoisonEventDetector`.
     *
     * Kept as a single count rather than a per-event series: the names are
     * the same unbounded source as everything else here, and the alert an
     * operator wants is "anything is poisoned", with
     * `GET /api/events/poisoned` for the detail.
     */
    setPoisonedEvents(count) {
        if (!this.poisonedGauge) {
            this.poisonedGauge = this.registry.gauge('poisoned_events', {}, 'Events currently marked poisoned for exceeding the rolling failure threshold.');
        }
        this.poisonedGauge.set(count);
    }
    /** Number of declarations currently in the registry. */
    setRegistrySize(count) {
        if (!this.registryGauge) {
            this.registryGauge = this.registry.gauge('registry_events', {}, 'Number of event declarations currently held in the registry.');
        }
        this.registryGauge.set(count);
    }
    // -------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------
    /**
     * Register a scrape-time collector for pull-style values (registry
     * size, SSE occupancy, transport health). Returns an unregister fn.
     *
     * Collectors run immediately before the snapshot is taken so a gauge
     * reflects the moment of the scrape rather than the last time
     * something happened to push it. A throwing collector is swallowed:
     * one broken source must not take the whole endpoint down.
     */
    collect(fn) {
        this.collectors.add(fn);
        return () => this.collectors.delete(fn);
    }
    /** Render the registry as Prometheus text format. */
    renderProm() {
        for (const fn of this.collectors) {
            try {
                fn();
            }
            catch (err) {
                console.warn('[prom-metrics] collector failed:', err.message);
            }
        }
        return (0, distributed_core_1.formatPrometheus)(this.registry.getSnapshot());
    }
    /** Expose the underlying registry (for tests / advanced wiring). */
    getRegistry() {
        return this.registry;
    }
}
exports.PromMetrics = PromMetrics;
//# sourceMappingURL=prom-metrics.js.map