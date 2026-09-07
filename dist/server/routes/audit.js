"use strict";
// src/server/routes/audit.ts
//
// wave22-d — registry-mutation audit SSE. Mirror of /api/flow for
// the slow path: every time the registry mutates (declare, version-
// bump, removal, subscriber add/remove), a structured AuditEvent
// is streamed to subscribers. Powers admin UI "registry changes"
// panels and live audit dashboards.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuditHandlers = createAuditHandlers;
const audit_emitter_js_1 = require("../audit-emitter.js");
const sse_js_1 = require("../sse.js");
const _shared_js_1 = require("./_shared.js");
const limits_js_1 = require("./limits.js");
/** The full AuditEventKind union, as a runtime value for `?kind=` narrowing. */
const AUDIT_KINDS = [
    'event.declared',
    'event.version.bumped',
    'event.removed',
    'event.deprecated',
    'event.undeprecated',
    'event.poisoned',
    'event.poison.cleared',
    'subscriber.added',
    'subscriber.removed',
    'event.manifest.drift',
];
/**
 * Narrow a raw `?kind=` value to AuditEventKind. Previously this was a bare
 * `as` cast, so `?kind=typo` produced a filter matching nothing and the
 * stream looked permanently idle. An unrecognized kind is now no filter at
 * all — same "an SSE client should get a stream, not a 400" call as
 * /api/flow's transport filter.
 */
function auditKind(raw) {
    return AUDIT_KINDS.find(k => k === raw);
}
function createAuditHandlers(deps) {
    const { auditLog } = deps;
    async function stream(req, res) {
        const filter = {
            kind: auditKind(req.query.kind),
            eventName: (0, _shared_js_1.stringParam)(req, 'eventName'),
            namespace: (0, _shared_js_1.stringParam)(req, 'namespace'),
            serviceName: (0, _shared_js_1.stringParam)(req, 'serviceName'),
        };
        // wave23-a — replay-on-connect knob. ?replay=N reads the last N
        // events from the persistent log and writes them as SSE frames
        // before streaming live. Default 0 (no replay) for back-compat.
        // Clamped: the underlying log is capped, and an unbounded ?replay=
        // is otherwise an invitation to ask for millions of frames.
        const replayN = Math.min(limits_js_1.MAX_AUDIT_QUERY_LIMIT, Math.max(0, parseInt((0, _shared_js_1.stringParam)(req, 'replay') ?? '0', 10) || 0));
        let stream = null;
        const handler = (event) => {
            if (!stream)
                return;
            if (!(0, audit_emitter_js_1.matchesAuditFilter)(event, filter))
                return;
            stream.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        stream = sse_js_1.sseRegistry.open(req, res, () => {
            audit_emitter_js_1.auditEmitter.off('audit', handler);
        });
        if (!stream)
            return;
        stream.write(`: connected; filter=${JSON.stringify(filter)}; replay=${replayN}\n\n`);
        // Replay history first when an audit log is wired and the caller
        // asked for it. Skipped if disconnected mid-replay.
        if (replayN > 0 && auditLog) {
            try {
                const history = await auditLog.recent(replayN);
                for (const event of history) {
                    if (stream.closed)
                        return;
                    if ((0, audit_emitter_js_1.matchesAuditFilter)(event, filter)) {
                        stream.write(`data: ${JSON.stringify({ ...event, _replay: true })}\n\n`);
                    }
                }
            }
            catch {
                // Log read failed — keep the live stream open anyway.
            }
        }
        if (stream.closed)
            return;
        audit_emitter_js_1.auditEmitter.on('audit', handler);
    }
    // wave23-a — query the persistent audit log without subscribing
    // to live SSE. Useful for one-off lookups + the admin UI's initial
    // render (avoids a slow-to-paint blank panel).
    async function recent(req, res) {
        if (!auditLog) {
            res.json({ events: [], note: 'no persistent audit log wired' });
            return;
        }
        const raw = parseInt((0, _shared_js_1.stringParam)(req, 'limit') ?? '50', 10) || 50;
        if (raw > limits_js_1.MAX_AUDIT_QUERY_LIMIT) {
            (0, _shared_js_1.badRequest)(res, `limit must be ≤ ${limits_js_1.MAX_AUDIT_QUERY_LIMIT}`);
            return;
        }
        try {
            const events = await auditLog.recent(Math.max(1, raw));
            res.json({ events });
        }
        catch (err) {
            // 503, not `{events: []}` — an operator reading the audit trail during
            // an incident must not be told "nothing happened" because Redis is down.
            console.warn('[event-catalog] audit history read failed:', err instanceof Error ? err.message : String(err));
            res.status(503).json({
                error: 'Audit history is unavailable — the audit log store did not answer. '
                    + 'This is not the same as an empty history; see the server logs.',
            });
        }
    }
    return { stream, recent };
}
//# sourceMappingURL=audit.js.map