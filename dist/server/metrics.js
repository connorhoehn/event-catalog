"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
class MetricsCollector {
    counters = new Map();
    rateWindowMs;
    constructor(rateWindowSeconds = 60) {
        this.rateWindowMs = rateWindowSeconds * 1000;
    }
    recordPublish(eventName) {
        const metrics = this.getOrCreate(eventName);
        metrics.publishCount++;
        metrics.lastPublishedAt = new Date().toISOString();
        metrics.publishTimestamps.push(Date.now());
        this.pruneTimestamps(metrics);
    }
    recordError(eventName) {
        const metrics = this.getOrCreate(eventName);
        metrics.errorCount++;
    }
    setSubscriberCount(eventName, count) {
        const metrics = this.getOrCreate(eventName);
        metrics.subscriberCount = count;
    }
    updateDurableStats(eventName, stats) {
        const metrics = this.getOrCreate(eventName);
        if (stats.queueDepth !== undefined)
            metrics.queueDepth = stats.queueDepth;
        if (stats.messagesInFlight !== undefined)
            metrics.messagesInFlight = stats.messagesInFlight;
        if (stats.oldestMessageAge !== undefined)
            metrics.oldestMessageAge = stats.oldestMessageAge;
    }
    getStats(eventName) {
        const metrics = this.counters.get(eventName);
        if (!metrics)
            return null;
        this.pruneTimestamps(metrics);
        return {
            publishCount: metrics.publishCount,
            publishRate: this.calculateRate(metrics),
            lastPublishedAt: metrics.lastPublishedAt,
            errorCount: metrics.errorCount,
            subscriberCount: metrics.subscriberCount,
            ...(metrics.queueDepth !== undefined ? { queueDepth: metrics.queueDepth } : {}),
            ...(metrics.messagesInFlight !== undefined ? { messagesInFlight: metrics.messagesInFlight } : {}),
            ...(metrics.oldestMessageAge !== undefined ? { oldestMessageAge: metrics.oldestMessageAge } : {}),
        };
    }
    snapshot() {
        const result = {};
        for (const [eventName] of this.counters) {
            const stats = this.getStats(eventName);
            if (stats)
                result[eventName] = stats;
        }
        return result;
    }
    reset(eventName) {
        if (eventName) {
            this.counters.delete(eventName);
        }
        else {
            this.counters.clear();
        }
    }
    getOrCreate(eventName) {
        let metrics = this.counters.get(eventName);
        if (!metrics) {
            metrics = {
                publishCount: 0,
                errorCount: 0,
                subscriberCount: 0,
                lastPublishedAt: null,
                publishTimestamps: [],
            };
            this.counters.set(eventName, metrics);
        }
        return metrics;
    }
    pruneTimestamps(metrics) {
        const cutoff = Date.now() - this.rateWindowMs;
        while (metrics.publishTimestamps.length > 0 && metrics.publishTimestamps[0] < cutoff) {
            metrics.publishTimestamps.shift();
        }
    }
    calculateRate(metrics) {
        if (metrics.publishTimestamps.length === 0)
            return 0;
        return metrics.publishTimestamps.length / (this.rateWindowMs / 1000);
    }
}
exports.MetricsCollector = MetricsCollector;
//# sourceMappingURL=metrics.js.map