"use strict";
// src/server/routes/deprecation.ts
//
// wave25-a — schema deprecation lifecycle, plus the wave26-f bulk
// variant.
//
// POST /api/events/:name/deprecate { reason?, by? }  → mark deprecated
// DELETE /api/events/:name/deprecate                 → unmark
// GET /api/deprecated                                → list deprecated
// POST /api/events/bulk/deprecate                    → mark many
//
// Deprecation is non-blocking: existing producers continue to publish
// (avoid surprise outages). Consumers see the chip in admin UI;
// catalog.publish() logs a one-time warn if warnOnDeprecated is on.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeprecationHandlers = createDeprecationHandlers;
const audit_emitter_js_1 = require("../audit-emitter.js");
const _shared_js_1 = require("./_shared.js");
function createDeprecationHandlers(deps) {
    const { registry, coordinator } = deps;
    function deprecate(req, res) {
        const body = (req.body ?? {});
        const ok = registry.deprecate(req.params.name, { reason: body.reason, by: body.by });
        if (!ok) {
            res.status(404).json({ error: `Event "${req.params.name}" not found` });
            return;
        }
        const entry = registry.get(req.params.name);
        audit_emitter_js_1.auditEmitter.publish({
            kind: 'event.deprecated',
            timestamp: new Date().toISOString(),
            eventName: entry.name,
            namespace: entry.namespace,
            reason: body.reason,
            by: body.by,
        });
        coordinator?.broadcast('deprecate', { name: req.params.name, opts: { reason: body.reason, by: body.by } }).catch(() => { });
        res.json({ deprecated: entry.name, deprecation: entry.deprecation });
    }
    function undeprecate(req, res) {
        const ok = registry.undeprecate(req.params.name);
        if (!ok) {
            res.status(404).json({ error: `Event "${req.params.name}" was not deprecated or does not exist` });
            return;
        }
        const entry = registry.get(req.params.name);
        audit_emitter_js_1.auditEmitter.publish({
            kind: 'event.undeprecated',
            timestamp: new Date().toISOString(),
            eventName: entry.name,
            namespace: entry.namespace,
        });
        coordinator?.broadcast('undeprecate', { name: req.params.name }).catch(() => { });
        res.json({ undeprecated: entry.name });
    }
    function list(_req, res) {
        const items = registry.listDeprecated().map(e => ({
            name: e.name,
            namespace: e.namespace,
            transport: e.transport,
            version: e.version,
            deprecation: e.deprecation,
        }));
        res.json({ count: items.length, items });
    }
    // wave26-f — bulk deprecate N events with a shared reason
    function deprecateBulk(req, res) {
        const { names, reason, by } = req.body;
        if (!Array.isArray(names) || names.length === 0) {
            (0, _shared_js_1.badRequest)(res, 'names[] is required and must be non-empty');
            return;
        }
        const deprecated = [];
        const notFound = [];
        const ts = new Date().toISOString();
        for (const name of names) {
            const ok = registry.deprecate(name, { reason, by });
            if (!ok) {
                notFound.push(name);
                continue;
            }
            const entry = registry.get(name);
            if (entry) {
                audit_emitter_js_1.auditEmitter.publish({
                    kind: 'event.deprecated',
                    timestamp: ts,
                    eventName: entry.name,
                    namespace: entry.namespace,
                    version: entry.version,
                    reason,
                    by,
                });
            }
            // wave26-d — broadcast to peer replicas.
            coordinator?.broadcast('deprecate', { name, opts: { reason, by } }).catch(() => { });
            deprecated.push(name);
        }
        res.status(notFound.length > 0 && deprecated.length === 0 ? 400 : 200).json({
            deprecated,
            notFound,
            total: deprecated.length,
        });
    }
    return { deprecate, undeprecate, list, deprecateBulk };
}
//# sourceMappingURL=deprecation.js.map