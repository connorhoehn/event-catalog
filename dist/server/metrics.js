"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
const distributed_core_1 = require("distributed-core");
const SNAPSHOT_KEY = 'event-catalog:metrics:snapshot';
class MetricsCollector {
    events = new Map();
    registry;
    rateWindowSeconds;
    /** wave26-a — ring buffer: eventName → last N rate snapshots. */
    rateHistory = new Map();
    HISTORY_BUCKETS = 60;
    constructor(rateWindowSeconds = 60) {
        this.rateWindowSeconds = rateWindowSeconds;
        this.registry = new distributed_core_1.MetricsRegistry('event-catalog', { namespace: 'event_catalog' });
    }
    recordPublish(eventName) {
        const handles = this.getOrCreate(eventName);
        handles.publishCounter.inc();
        handles.lastPublishedAt = new Date().toISOString();
        handles.rateTracker.record();
    }
    recordError(eventName) {
        const handles = this.getOrCreate(eventName);
        handles.errorCounter.inc();
    }
    setSubscriberCount(eventName, count) {
        const handles = this.getOrCreate(eventName);
        handles.subscriberGauge.set(count);
    }
    updateDurableStats(eventName, stats) {
        const handles = this.getOrCreate(eventName);
        if (stats.queueDepth !== undefined)
            handles.queueDepthGauge.set(stats.queueDepth);
        if (stats.messagesInFlight !== undefined)
            handles.messagesInFlightGauge.set(stats.messagesInFlight);
        if (stats.oldestMessageAge !== undefined)
            handles.oldestMessageAgeGauge.set(stats.oldestMessageAge);
    }
    getStats(eventName) {
        const handles = this.events.get(eventName);
        if (!handles)
            return null;
        const queueDepth = handles.queueDepthGauge.get();
        const messagesInFlight = handles.messagesInFlightGauge.get();
        const oldestMessageAge = handles.oldestMessageAgeGauge.get();
        return {
            publishCount: handles.publishCounter.get(),
            publishRate: handles.rateTracker.rate(),
            lastPublishedAt: handles.lastPublishedAt,
            errorCount: handles.errorCounter.get(),
            subscriberCount: handles.subscriberGauge.get(),
            ...(queueDepth !== 0 ? { queueDepth } : {}),
            ...(messagesInFlight !== 0 ? { messagesInFlight } : {}),
            ...(oldestMessageAge !== 0 ? { oldestMessageAge } : {}),
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
    reset(eventName) {
        if (eventName) {
            this.events.delete(eventName);
        }
        else {
            this.events.clear();
        }
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
            handles.publishCounter.reset();
            handles.publishCounter.inc(persisted.publishCount);
            handles.errorCounter.reset();
            handles.errorCounter.inc(persisted.errorCount);
            handles.lastPublishedAt = persisted.lastPublishedAt;
        }
    }
    getOrCreate(eventName) {
        let handles = this.events.get(eventName);
        if (!handles) {
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
            };
            this.events.set(eventName, handles);
        }
        return handles;
    }
}
exports.MetricsCollector = MetricsCollector;
//# sourceMappingURL=metrics.js.map