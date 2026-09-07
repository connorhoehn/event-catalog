"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoisonEventDetector = exports.DEFAULT_MAX_TRACKED_FAILURE_EVENTS = void 0;
/**
 * Ceiling on distinct events held in the failure window.
 *
 * `failures` is keyed by event name and event names are writable over
 * HTTP, so without a cap this is an unbounded map fed by request input —
 * and entries are only ever pruned by a subsequent failure for the SAME
 * event, so a burst of one-off failures across many names never ages
 * out. Sweeping expired windows before admitting a new key keeps the map
 * proportional to what is actually failing, not to what ever failed.
 */
exports.DEFAULT_MAX_TRACKED_FAILURE_EVENTS = 5000;
class PoisonEventDetector {
    windowMs;
    threshold;
    maxTrackedEvents;
    /** eventName → timestamps of recent failures within the window. */
    failures = new Map();
    /** eventName → PoisonState (only present when poisoned). */
    poisoned = new Map();
    constructor(opts = {}) {
        this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
        this.threshold = opts.threshold ?? 50;
        this.maxTrackedEvents = opts.maxTrackedEvents ?? exports.DEFAULT_MAX_TRACKED_FAILURE_EVENTS;
    }
    /** Distinct events currently inside the failure window. */
    get trackedEventCount() {
        return this.failures.size;
    }
    /**
     * Drop events whose every recorded failure has aged out of the window.
     * A poisoned event keeps its slot — its state is operator-dismissed,
     * not time-expired.
     */
    sweepExpired(cutoff) {
        for (const [name, timestamps] of this.failures) {
            if (this.poisoned.has(name))
                continue;
            if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
                this.failures.delete(name);
            }
        }
    }
    /**
     * Record one failure for eventName. Returns true the first time the
     * event crosses the threshold (caller can emit an audit event).
     */
    recordFailure(eventName) {
        const now = Date.now();
        const cutoff = now - this.windowMs;
        const existing = this.failures.get(eventName);
        if (!existing && this.failures.size >= this.maxTrackedEvents) {
            this.sweepExpired(cutoff);
            if (this.failures.size >= this.maxTrackedEvents)
                return false;
        }
        let timestamps = existing ?? [];
        timestamps = timestamps.filter(t => t >= cutoff);
        timestamps.push(now);
        this.failures.set(eventName, timestamps);
        const alreadyPoison = this.poisoned.has(eventName);
        if (!alreadyPoison && timestamps.length >= this.threshold) {
            this.poisoned.set(eventName, {
                eventName,
                failuresInWindow: timestamps.length,
                poisonedAt: new Date().toISOString(),
                threshold: this.threshold,
                windowMs: this.windowMs,
            });
            return true;
        }
        if (alreadyPoison) {
            const state = this.poisoned.get(eventName);
            state.failuresInWindow = timestamps.length;
        }
        return false;
    }
    isPoisoned(eventName) {
        return this.poisoned.has(eventName);
    }
    getPoison(eventName) {
        return this.poisoned.get(eventName) ?? null;
    }
    listPoisoned() {
        return [...this.poisoned.values()];
    }
    clearPoison(eventName) {
        this.failures.delete(eventName);
        return this.poisoned.delete(eventName);
    }
    failureCount(eventName) {
        const now = Date.now();
        const cutoff = now - this.windowMs;
        const timestamps = this.failures.get(eventName) ?? [];
        return timestamps.filter(t => t >= cutoff).length;
    }
}
exports.PoisonEventDetector = PoisonEventDetector;
//# sourceMappingURL=poison-detector.js.map