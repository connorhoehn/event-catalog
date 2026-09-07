"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = exports.COLLECTOR_METRIC_NAMESPACE = exports.DEFAULT_MAX_TRACKED_EVENTS = void 0;
const distributed_core_1 = require("distributed-core");
const SNAPSHOT_KEY = 'event-catalog:metrics:snapshot';
/**
 * Ceiling on distinct events this collector will track.
 *
 * Each tracked event costs six distributed-core metric handles, a
 * RateTracker and a 60-slot rate-history ring buffer, and every entry is
 * walked on each 15s health tick (`snapshot()` + `tickRateHistory()`).
 * `POST /api/events/bulk` accepts 1000 declarations per request with no
 * ceiling on requests, and the observer tracks whatever the registry
 * holds, so "however many events exist" is not a bound the service
 * controls. 5000 is ~25x the committed registry (194 events); past it
 * new events are refused a handle and counted in `droppedEvents` rather
 * than growing the process without limit.
 */
exports.DEFAULT_MAX_TRACKED_EVENTS = 5000;
/**
 * Metric namespace for this collector's registry.
 *
 * Deliberately NOT `event_catalog`, which is what `PromMetrics` uses for
 * the `/metrics` scrape surface. Both classes register a metric called
 * `publish_total`, but with different label sets — `{event}` here versus
 * `{event, transport, mode}` there. They are separate `MetricsRegistry`
 * instances so nothing collides today, but a single Prometheus metric
 * family whose series disagree on label names is invalid exposition and
 * a scraper drops the whole family. Namespacing the two apart means
 * merging the registries, or ever rendering this one, produces
 * `event_catalog_stats_publish_total` and `event_catalog_publish_total`
 * — two well-formed families rather than one broken one.
 *
 * Nothing renders this registry today: `getStats`/`snapshot` read the
 * handles directly and the JSON admin API never sees a metric name, so
 * this constant is invisible outside the collector.
 */
exports.COLLECTOR_METRIC_NAMESPACE = 'event_catalog_stats';
class MetricsCollector {
    events = new Map();
    registry;
    rateWindowSeconds;
    /** wave26-a — ring buffer: eventName → last N rate snapshots. */
    rateHistory = new Map();
    HISTORY_BUCKETS = 60;
    maxTrackedEvents;
    /**
     * Every event name that has ever been given metric handles.
     *
     * The cap has to be counted here rather than on `this.events`, because
     * `MetricsRegistry` keys its store by `(name, labels)` and has no
     * delete: `reset()` zeroes instances but never removes them, and this
     * class's own `reset(eventName)` only drops its map entry. Counting
     * live entries therefore hands back a cap slot while the memory it was
     * protecting is still held, so a churn of reset + fresh event name
     * grows the process past `maxTrackedEvents` without limit and without
     * ever tripping the guard. A name already in this set costs nothing
     * new, so re-tracking one after a reset is always allowed.
     */
    knownEvents = new Set();
    droppedEvents = 0;
    warnedAboutCap = false;
    constructor(rateWindowSeconds = 60, maxTrackedEvents = exports.DEFAULT_MAX_TRACKED_EVENTS) {
        this.rateWindowSeconds = rateWindowSeconds;
        this.maxTrackedEvents = maxTrackedEvents;
        this.registry = new distributed_core_1.MetricsRegistry('event-catalog', { namespace: exports.COLLECTOR_METRIC_NAMESPACE });
    }
    recordPublish(eventName) {
        const handles = this.getOrCreate(eventName);
        if (!handles)
            return;
        handles.publishCounter.inc();
        handles.lastPublishedAt = new Date().toISOString();
        handles.rateTracker.record();
    }
    recordError(eventName) {
        const handles = this.getOrCreate(eventName);
        if (!handles)
            return;
        handles.errorCounter.inc();
    }
    setSubscriberCount(eventName, count) {
        const handles = this.getOrCreate(eventName);
        if (!handles)
            return;
        handles.subscriberGauge.set(count);
    }
    /**
     * The underlying metric store (tests / advanced wiring).
     *
     * Nothing renders it — the JSON admin API reads handles directly — but
     * it is exposed so a test can assert that this registry's metric names
     * never collide with the ones `PromMetrics` puts on `/metrics`.
     */
    getRegistry() {
        return this.registry;
    }
    /** Events refused a metric handle because the tracking cap was hit. */
    get droppedEventCount() {
        return this.droppedEvents;
    }
    /** Number of events currently holding metric handles. */
    size() {
        return this.events.size;
    }
    /**
     * Distinct event names that have ever been allocated handles — the
     * quantity the tracking cap is actually enforced against, since the
     * underlying registry never releases a metric it has created.
     */
    knownEventCount() {
        return this.knownEvents.size;
    }
    updateDurableStats(eventName, stats) {
        const handles = this.getOrCreate(eventName);
        if (!handles)
            return;
        if (stats.queueDepth !== undefined) {
            handles.queueDepthGauge.set(stats.queueDepth);
            handles.durableFields.add('queueDepth');
        }
        if (stats.messagesInFlight !== undefined) {
            handles.messagesInFlightGauge.set(stats.messagesInFlight);
            handles.durableFields.add('messagesInFlight');
        }
        if (stats.oldestMessageAge !== undefined) {
            handles.oldestMessageAgeGauge.set(stats.oldestMessageAge);
            handles.durableFields.add('oldestMessageAge');
        }
    }
    getStats(eventName) {
        const handles = this.events.get(eventName);
        if (!handles)
            return null;
        // A durable field is present once it has been measured, even when
        // the measurement is 0 — "the queue drained" and "we never looked"
        // are different answers and the admin UI has to be able to tell
        // them apart. Absent still means never measured (a signal-only
        // event, or a durable one whose queue has not been polled yet).
        return {
            publishCount: handles.publishCounter.get(),
            publishRate: handles.rateTracker.rate(),
            lastPublishedAt: handles.lastPublishedAt,
            errorCount: handles.errorCounter.get(),
            subscriberCount: handles.subscriberGauge.get(),
            ...(handles.durableFields.has('queueDepth')
                ? { queueDepth: handles.queueDepthGauge.get() } : {}),
            ...(handles.durableFields.has('messagesInFlight')
                ? { messagesInFlight: handles.messagesInFlightGauge.get() } : {}),
            ...(handles.durableFields.has('oldestMessageAge')
                ? { oldestMessageAge: handles.oldestMessageAgeGauge.get() } : {}),
        };
    }
    snapshot() {
        const result = {};
        for (const [eventName] of this.events) {
            const stats = this.getStats(eventName);
            if (stats)
                result[eventName] = stats;
        }
        return result;
    }
    /**
     * wave26-a — snapshot current rate for every tracked event into the
     * ring buffer. Called from the server's periodic health interval so
     * the sparkline data stays fresh without a dedicated timer.
     */
    tickRateHistory() {
        for (const [name, handles] of this.events) {
            const buf = this.rateHistory.get(name) ?? [];
            buf.push(handles.rateTracker.rate());
            if (buf.length > this.HISTORY_BUCKETS)
                buf.shift();
            this.rateHistory.set(name, buf);
        }
    }
    /**
     * wave26-a — return rate history for one event or all events.
     * When `eventName` is provided returns `{ [eventName]: number[] }`.
     * When omitted returns the full `{ [eventName]: number[] }` map.
     */
    getHistory(eventName) {
        // Null-prototype so an event name of `__proto__` becomes an own
        // property instead of hitting Object.prototype's setter — a plain
        // `{}` there re-parents the map and the event disappears from
        // GET /api/metrics/history entirely.
        const out = Object.create(null);
        if (eventName) {
            out[eventName] = this.rateHistory.get(eventName) ?? [];
            return out;
        }
        for (const [name, buf] of this.rateHistory) {
            out[name] = buf;
        }
        return out;
    }
    /**
     * Drop tracking for one event (or all of them).
     *
     * The handles must be zeroed before they are dropped. `MetricsRegistry`
     * keys its store by `(name, labels)` and hands back the EXISTING
     * instance when the same key is requested again, so deleting from
     * `this.events` alone left the counter alive in the registry: the next
     * `recordPublish` for that name re-fetched the old handle and
     * `publishCount` resumed from its pre-reset value instead of 1. That
     * made `POST /api/metrics/reset` look like it worked (getStats went
     * null) and then silently un-reset itself on the next publish.
     */
    reset(eventName) {
        const drop = (handles) => {
            handles.publishCounter.reset();
            handles.errorCounter.reset();
            handles.subscriberGauge.set(0);
            handles.queueDepthGauge.set(0);
            handles.messagesInFlightGauge.set(0);
            handles.oldestMessageAgeGauge.set(0);
            handles.durableFields.clear();
        };
        if (eventName) {
            const handles = this.events.get(eventName);
            if (handles)
                drop(handles);
            this.events.delete(eventName);
            this.rateHistory.delete(eventName);
            return;
        }
        for (const handles of this.events.values())
            drop(handles);
        this.events.clear();
        this.rateHistory.clear();
    }
    async snapshotToRedis(redis) {
        const data = {};
        for (const [eventName, handles] of this.events) {
            data[eventName] = {
                publishCount: handles.publishCounter.get(),
                errorCount: handles.errorCounter.get(),
                lastPublishedAt: handles.lastPublishedAt,
            };
        }
        await redis.set(SNAPSHOT_KEY, JSON.stringify(data));
    }
    async restoreFromRedis(redis) {
        const raw = await redis.get(SNAPSHOT_KEY);
        if (!raw)
            return;
        let data;
        try {
            data = JSON.parse(raw);
        }
        catch {
            return;
        }
        for (const [eventName, persisted] of Object.entries(data)) {
            const handles = this.getOrCreate(eventName);
            if (!handles)
                continue;
            // Never move a counter backwards. Restore is a boot-time rehydrate,
            // but a stale snapshot (or a second restore after traffic has
            // started) would otherwise rewrite a live counter to a lower value
            // and make `rate()` read the drop as a counter reset — a phantom
            // spike on every dashboard that queries it.
            restoreCounter(handles.publishCounter, persisted.publishCount);
            restoreCounter(handles.errorCounter, persisted.errorCount);
            if (handles.lastPublishedAt === null) {
                handles.lastPublishedAt = persisted.lastPublishedAt;
            }
        }
    }
    getOrCreate(eventName) {
        let handles = this.events.get(eventName);
        if (!handles) {
            if (!this.knownEvents.has(eventName) && this.knownEvents.size >= this.maxTrackedEvents) {
                this.droppedEvents++;
                if (!this.warnedAboutCap) {
                    this.warnedAboutCap = true;
                    console.warn(`[metrics] tracking cap of ${this.maxTrackedEvents} events reached — ` +
                        'further events are not measured. Registry is larger than this service expects.');
                }
                return null;
            }
            const labels = { event: eventName };
            handles = {
                publishCounter: this.registry.counter('publish_total', labels),
                errorCounter: this.registry.counter('error_total', labels),
                subscriberGauge: this.registry.gauge('subscriber_count', labels),
                queueDepthGauge: this.registry.gauge('queue_depth', labels),
                messagesInFlightGauge: this.registry.gauge('messages_in_flight', labels),
                oldestMessageAgeGauge: this.registry.gauge('oldest_message_age', labels),
                rateTracker: new distributed_core_1.RateTracker(this.rateWindowSeconds),
                lastPublishedAt: null,
                durableFields: new Set(),
            };
            this.events.set(eventName, handles);
            this.knownEvents.add(eventName);
        }
        return handles;
    }
}
exports.MetricsCollector = MetricsCollector;
/**
 * Rehydrate a counter to `target` without ever decreasing it.
 * A counter that goes down is read by Prometheus as a process restart,
 * so a stale snapshot must be ignored rather than applied.
 */
function restoreCounter(counter, target) {
    if (!Number.isFinite(target) || target <= 0)
        return;
    const current = counter.get();
    if (target <= current)
        return;
    counter.inc(target - current);
}
//# sourceMappingURL=metrics.js.map