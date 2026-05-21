"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryDLQStore = void 0;
const MAX_RING_SIZE = 1000;
/**
 * In-memory DLQ store — bounded ring buffer capped at 1000 records.
 * Oldest records are dropped when the buffer is full. Suitable for
 * tests and local development. Not durable across restarts.
 */
class InMemoryDLQStore {
    records = [];
    async append(record) {
        if (this.records.length >= MAX_RING_SIZE) {
            // Drop the oldest entry to keep within the ring bound.
            this.records.shift();
        }
        this.records.push(record);
    }
    async list(opts) {
        let result = this.records.slice();
        if (opts?.eventName !== undefined) {
            result = result.filter(r => r.eventName === opts.eventName);
        }
        if (opts?.reason !== undefined) {
            result = result.filter(r => r.reason === opts.reason);
        }
        const limit = opts?.limit;
        if (limit !== undefined && limit > 0) {
            result = result.slice(0, limit);
        }
        return result;
    }
    async delete(id) {
        const idx = this.records.findIndex(r => r.id === id);
        if (idx !== -1) {
            this.records.splice(idx, 1);
        }
    }
    async clear(eventName) {
        if (eventName === undefined) {
            this.records.length = 0;
        }
        else {
            let i = this.records.length;
            while (i-- > 0) {
                if (this.records[i].eventName === eventName) {
                    this.records.splice(i, 1);
                }
            }
        }
    }
    /** For tests — synchronous read of current record count. */
    size() {
        return this.records.length;
    }
}
exports.InMemoryDLQStore = InMemoryDLQStore;
//# sourceMappingURL=DLQStore.js.map