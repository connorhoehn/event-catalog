"use strict";
// src/server/routes/subscribers.ts
//
// Subscriber registration (POST/DELETE /events/:name/subscribers/…)
// plus the wave24-b heartbeat surface that keeps `lastSeenAt` fresh
// and the roll-up listing used by "who's overdue?" dashboards.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSubscriberHandlers = createSubscriberHandlers;
const audit_emitter_js_1 = require("../audit-emitter.js");
const _shared_js_1 = require("./_shared.js");
function createSubscriberHandlers(deps) {
    const { registry, coordinator } = deps;
    // Register a subscriber for an event
    function add(req, res) {
        const { serviceName } = req.body;
        if (!serviceName) {
            (0, _shared_js_1.badRequest)(res, 'serviceName is required');
            return;
        }
        const entry = registry.get(req.params.name);
        if (!entry) {
            (0, _shared_js_1.eventNotFound)(res, req.params.name);
            return;
        }
        registry.addSubscriber(req.params.name, serviceName);
        audit_emitter_js_1.auditEmitter.publish({
            kind: 'subscriber.added',
            timestamp: new Date().toISOString(),
            eventName: req.params.name,
            namespace: entry.namespace,
            serviceName,
        });
        coordinator?.broadcast('subscriber.add', { eventName: req.params.name, serviceName }).catch(() => { });
        res.status(201).json({ event: req.params.name, subscriber: serviceName });
    }
    // Remove a subscriber from an event
    function remove(req, res) {
        const entry = registry.get(req.params.name);
        if (!entry) {
            (0, _shared_js_1.eventNotFound)(res, req.params.name);
            return;
        }
        registry.removeSubscriber(req.params.name, req.params.serviceName);
        audit_emitter_js_1.auditEmitter.publish({
            kind: 'subscriber.removed',
            timestamp: new Date().toISOString(),
            eventName: req.params.name,
            namespace: entry.namespace,
            serviceName: req.params.serviceName,
        });
        coordinator?.broadcast('subscriber.remove', { eventName: req.params.name, serviceName: req.params.serviceName }).catch(() => { });
        res.json({ event: req.params.name, removedSubscriber: req.params.serviceName });
    }
    // wave24-b — refresh subscriber lastSeenAt timestamps. Body:
    //   { serviceName: 'svc-1', events?: ['a.x', 'b.y'] }
    // When `events` is omitted, refreshes every event the service is
    // currently subscribed to. Returns the events that were actually
    // refreshed (a service may have been pruned in the meantime).
    function heartbeat(req, res) {
        const { serviceName, events } = req.body;
        if (typeof serviceName !== 'string' || serviceName.length === 0) {
            (0, _shared_js_1.badRequest)(res, 'serviceName is required');
            return;
        }
        const eventNames = Array.isArray(events) && events.every((e) => typeof e === 'string')
            ? events
            : undefined;
        const refreshed = registry.heartbeat(serviceName, eventNames);
        res.json({ serviceName, refreshed, count: refreshed.length });
    }
    // wave24-b — list every subscriber + its lastSeenAt. Optional
    // `?staleAfter=<seconds>` filter returns only subscribers older
    // than the threshold (useful for "who's overdue?" dashboards).
    function list(req, res) {
        const all = registry.listSubscriberHeartbeats();
        const staleAfter = parseInt(String(req.query.staleAfter ?? ''), 10);
        if (Number.isFinite(staleAfter) && staleAfter > 0) {
            const cutoff = Date.now() - staleAfter * 1000;
            const stale = all.filter((s) => Date.parse(s.lastSeenAt) < cutoff);
            res.json({ subscribers: stale, total: stale.length, filter: { staleAfter } });
            return;
        }
        res.json({ subscribers: all, total: all.length });
    }
    return { add, remove, heartbeat, list };
}
//# sourceMappingURL=subscribers.js.map