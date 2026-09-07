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
const limits_js_1 = require("./limits.js");
function createSubscriberHandlers(deps) {
    const { registry, coordinator, metrics } = deps;
    const log = new _shared_js_1.RouteLog(deps.logger);
    // The `subscriber_count` gauge is push-only and was previously written
    // exactly once, when `MetricsObserver` first subscribed to the event's
    // channel. It therefore did not move when a consumer registered or
    // deregistered here: an operator refreshing the admin UI right after a
    // POST read the count from before their own call. Re-derive it from
    // the registry on every mutation — synchronous and local, so it cannot
    // fail the request. The observer reconciles the same way on its poll
    // tick, which covers the mutation paths outside this module (the
    // stale-subscriber sweeper, and replicas applying a coordinator
    // broadcast).
    function syncCount(eventName) {
        metrics.setSubscriberCount(eventName, registry.get(eventName)?.subscribers.length ?? 0);
    }
    // Register a subscriber for an event
    //
    // `serviceName` comes off the POST body, so both its shape and the
    // number of distinct values one event can accumulate are chosen by the
    // caller. The name is validated here; the count is bounded by
    // `Registry.addSubscriber`, which is where the rule has to live because
    // replication reaches the same list without passing through this
    // handler. A refusal is a 429 rather than a silent no-op — the caller
    // is a consumer that will otherwise believe it is registered.
    function add(req, res) {
        const { serviceName } = req.body;
        const nameError = (0, limits_js_1.validateServiceName)(serviceName);
        if (nameError) {
            (0, _shared_js_1.badRequest)(res, nameError);
            return;
        }
        const name = serviceName;
        const entry = registry.get(req.params.name);
        if (!entry) {
            (0, _shared_js_1.eventNotFound)(res, req.params.name);
            return;
        }
        if (!registry.addSubscriber(req.params.name, name)) {
            // The name is already validated and the event exists, so capacity
            // is the only refusal left.
            log.warn(`subscriber-cap:${req.params.name}`, '[event-catalog] refused subscriber — event is at its subscriber cap:', {
                component: 'routes/subscribers',
                action: 'subscriber.add',
                status: 'refused',
                eventName: req.params.name,
                serviceName: name,
                limit: limits_js_1.MAX_SUBSCRIBERS_PER_EVENT,
            }, req.params.name);
            res.status(429).json({
                error: `Event "${req.params.name}" already has the maximum of `
                    + `${limits_js_1.MAX_SUBSCRIBERS_PER_EVENT} distinct subscribers`,
                event: req.params.name,
                subscriber: name,
                limit: limits_js_1.MAX_SUBSCRIBERS_PER_EVENT,
                current: entry.subscribers.length,
            });
            return;
        }
        syncCount(req.params.name);
        audit_emitter_js_1.auditEmitter.publish({
            kind: 'subscriber.added',
            timestamp: new Date().toISOString(),
            eventName: req.params.name,
            namespace: entry.namespace,
            serviceName: name,
        });
        coordinator?.broadcast('subscriber.add', { eventName: req.params.name, serviceName: name }).catch(() => { });
        res.status(201).json({ event: req.params.name, subscriber: name });
    }
    // Remove a subscriber from an event
    function remove(req, res) {
        const entry = registry.get(req.params.name);
        if (!entry) {
            (0, _shared_js_1.eventNotFound)(res, req.params.name);
            return;
        }
        registry.removeSubscriber(req.params.name, req.params.serviceName);
        // Mirror image of `add`: a deregistration that leaves the gauge
        // alone reports a consumer that is gone, which is the direction that
        // hides an outage rather than causing a false alarm.
        syncCount(req.params.name);
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
        const nameError = (0, limits_js_1.validateServiceName)(serviceName);
        if (nameError) {
            (0, _shared_js_1.badRequest)(res, nameError);
            return;
        }
        const name = serviceName;
        const eventNames = Array.isArray(events) && events.every((e) => typeof e === 'string')
            ? events
            : undefined;
        const refreshed = registry.heartbeat(name, eventNames);
        res.json({ serviceName: name, refreshed, count: refreshed.length });
    }
    // wave24-b — list every subscriber + its lastSeenAt. Optional
    // `?staleAfter=<seconds>` filter returns only subscribers older
    // than the threshold (useful for "who's overdue?" dashboards).
    function list(req, res) {
        const all = registry.listSubscriberHeartbeats();
        const staleAfter = parseInt((0, _shared_js_1.stringParam)(req, 'staleAfter') ?? '', 10);
        if (Number.isFinite(staleAfter) && staleAfter > 0) {
            const cutoff = Date.now() - staleAfter * 1000;
            const stale = all.filter((s) => Date.parse(s.lastSeenAt) < cutoff);
            res.json({
                subscribers: stale,
                total: stale.length,
                filter: { staleAfter },
                refusals: registry.getSubscriberRefusalStats(),
            });
            return;
        }
        // The cap and the name guard both refuse from inside the registry,
        // where replication has no response to write into. Reporting the
        // counters on the listing is what keeps a capped event from looking
        // like an event nobody subscribed to.
        res.json({
            subscribers: all,
            total: all.length,
            refusals: registry.getSubscriberRefusalStats(),
        });
    }
    return { add, remove, heartbeat, list };
}
//# sourceMappingURL=subscribers.js.map