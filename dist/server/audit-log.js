"use strict";
// src/server/audit-log.ts
//
// wave23-a — persistent audit log. The wave22-d auditEmitter is
// process-local; SSE clients miss everything fired before they
// connected. This wraps the emitter with a Redis-backed capped
// list so operators can scroll back, and so the /api/audit SSE
// can replay the last N events on connect.
//
// Storage: a single Redis list at `event-catalog:audit-log` with
// LPUSH on every emit + LTRIM to cap. Read via LRANGE on connect.
// Survives catalog restarts; lost on Redis loss (acceptable for an
// audit feed — DLQ + registry remain authoritative).
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAuditLog = startAuditLog;
const audit_emitter_js_1 = require("./audit-emitter.js");
const REDIS_KEY = 'event-catalog:audit-log';
/** Cap the persisted log so it doesn't grow unbounded. */
const DEFAULT_CAP = 1000;
/**
 * Wires the in-memory auditEmitter to a capped Redis list. Returns
 * an object with `recent(limit)` for HTTP queries and a `stop()` to
 * detach the listener on shutdown. Idempotent — calling twice
 * registers two listeners (caller's responsibility).
 */
function startAuditLog(opts) {
    const cap = opts.cap ?? DEFAULT_CAP;
    const redis = opts.redis;
    const handler = async (event) => {
        try {
            await redis.lPush(REDIS_KEY, JSON.stringify(event));
            // LTRIM to keep the list at most `cap` long. The 0..cap-1
            // slice keeps the most recent entries (since we LPUSH).
            await redis.lTrim(REDIS_KEY, 0, cap - 1);
        }
        catch {
            // Swallow — Redis hiccup shouldn't block the audit emit.
            // The emitter already delivered to live SSE listeners.
        }
    };
    audit_emitter_js_1.auditEmitter.on('audit', handler);
    return {
        async recent(limit) {
            const n = Math.max(1, Math.min(cap, limit ?? 50));
            try {
                const raw = await redis.lRange(REDIS_KEY, 0, n - 1);
                // LPUSH means index 0 is most recent; reverse so caller gets
                // chronological order (oldest → newest).
                const parsed = [];
                for (const r of raw) {
                    try {
                        parsed.push(JSON.parse(r));
                    }
                    catch {
                        // Drop unparseable entries silently.
                    }
                }
                return parsed.reverse();
            }
            catch {
                return [];
            }
        },
        stop() {
            audit_emitter_js_1.auditEmitter.off('audit', handler);
        },
    };
}
//# sourceMappingURL=audit-log.js.map