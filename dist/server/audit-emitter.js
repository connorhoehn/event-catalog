"use strict";
// src/server/audit-emitter.ts
//
// wave22-d — process-internal emitter for registry MUTATION events
// (declarations, version bumps, subscriber add/remove). Mirror of
// `tap-emitter.ts` (wave19-d) but for the slow path: when an
// operator declares a new event or a consumer subscribes, the audit
// emitter publishes a structured AuditEvent that the
// `GET /api/audit` SSE endpoint streams to admin UI clients.
//
// Wired from `Registry.declare()` and the subscriber routes; the
// emitter itself is a tiny EventEmitter with no Redis hop, keeping
// the audit feed honest about what THIS server saw.
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditEmitter = void 0;
exports.matchesAuditFilter = matchesAuditFilter;
const node_events_1 = require("node:events");
function matchesAuditFilter(event, filter) {
    if (filter.kind && event.kind !== filter.kind)
        return false;
    if (filter.eventName && event.eventName !== filter.eventName)
        return false;
    if (filter.namespace && event.namespace !== filter.namespace)
        return false;
    if (filter.serviceName && event.serviceName !== filter.serviceName)
        return false;
    return true;
}
class AuditEmitter extends node_events_1.EventEmitter {
    publish(event) {
        this.emit('audit', event);
    }
}
/** Module-singleton audit emitter. setMaxListeners(0) for SSE clients. */
exports.auditEmitter = new AuditEmitter();
exports.auditEmitter.setMaxListeners(0);
//# sourceMappingURL=audit-emitter.js.map