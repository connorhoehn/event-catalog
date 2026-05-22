"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoisonEventDetector = void 0;
class PoisonEventDetector {
    windowMs;
    threshold;
    /** eventName → timestamps of recent failures within the window. */
    failures = new Map();
    /** eventName → PoisonState (only present when poisoned). */
    poisoned = new Map();
    constructor(opts = {}) {
        this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
        this.threshold = opts.threshold ?? 50;
    }
    /**
     * Record one failure for eventName. Returns true the first time the
     * event crosses the threshold (caller can emit an audit event).
     */
    recordFailure(eventName) {
        const now = Date.now();
        const cutoff = now - this.windowMs;
        let timestamps = this.failures.get(eventName) ?? [];
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