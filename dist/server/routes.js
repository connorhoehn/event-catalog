"use strict";
// src/server/routes.ts
//
// The /api route table. Handler bodies live in `./routes/*.ts`, grouped
// by route family; this file is the composition root that wires them
// onto the router in the order they must match (e.g. `/events/poisoned`
// and `/events/bulk/*` are registered before the `/events/:name`
// patterns that would otherwise swallow them).
//
// `createRoutes` + `RoutesDeps` remain the module's entire public
// surface — unchanged from when every handler lived inline here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoutes = createRoutes;
const http_router_js_1 = require("./http-router.js");
const events_js_1 = require("./routes/events.js");
const subscribers_js_1 = require("./routes/subscribers.js");
const deprecation_js_1 = require("./routes/deprecation.js");
const namespaces_js_1 = require("./routes/namespaces.js");
const audit_js_1 = require("./routes/audit.js");
const manifests_js_1 = require("./routes/manifests.js");
const contracts_js_1 = require("./routes/contracts.js");
const flow_js_1 = require("./routes/flow.js");
const ops_js_1 = require("./routes/ops.js");
const transports_js_1 = require("./routes/transports.js");
const dlq_js_1 = require("./routes/dlq.js");
function createRoutes(deps) {
    // The router's own uncaught-handler warning goes to the same sink the
    // handlers use, so an operator sees one stream, not two.
    const router = (0, http_router_js_1.Router)(deps.logger);
    const events = (0, events_js_1.createEventHandlers)(deps);
    const subscribers = (0, subscribers_js_1.createSubscriberHandlers)(deps);
    const deprecation = (0, deprecation_js_1.createDeprecationHandlers)(deps);
    const namespaces = (0, namespaces_js_1.createNamespaceHandlers)(deps);
    const audit = (0, audit_js_1.createAuditHandlers)(deps);
    const contracts = (0, contracts_js_1.createContractHandlers)(deps);
    const flow = (0, flow_js_1.createFlowHandlers)(deps);
    const ops = (0, ops_js_1.createOpsHandlers)(deps);
    const transports = (0, transports_js_1.createTransportHandlers)(deps);
    const dlq = (0, dlq_js_1.createDlqHandlers)(deps);
    // ─── Events ───────────────────────────────────────────────────────────────
    router.get('/events', events.list);
    // wave26-e — MUST be before /events/:name to avoid clash.
    router.get('/events/poisoned', events.listPoisoned);
    router.get('/events/:name', events.get);
    // POST is the canonical form: the compat check needs a proposed schema,
    // and a JSON body on a GET is unreachable from a browser and dropped by
    // plenty of proxies and HTTP clients. The GET route is kept for existing
    // CI callers and takes the schema as a URL-encoded JSON ?schema= param.
    router.post('/events/:name/schema/check', events.checkSchema);
    router.get('/events/:name/schema/check', events.checkSchema);
    router.get('/events/:name/stats', events.stats);
    router.get('/events/:name/history', events.history);
    router.post('/events', events.declare);
    router.post('/events/bulk', events.declareBulk);
    // ─── Subscribers ──────────────────────────────────────────────────────────
    router.post('/events/:name/subscribers', subscribers.add);
    router.delete('/events/:name/subscribers/:serviceName', subscribers.remove);
    router.get('/events/:name/producers/observed', events.observedProducers);
    router.delete('/events/:name/poison', events.clearPoison);
    // ─── Deprecation lifecycle ────────────────────────────────────────────────
    router.post('/events/bulk/deprecate', deprecation.deprecateBulk);
    // POST is the form for a registry-sized name list — a comma-joined
    // `?names=` is already 5.8 KB URL-encoded at 225 declarations, past the
    // 4–8 KB request-line ceiling common to proxies and CDNs. The GET stays:
    // with no `?names=` it is the browser-download surface (an `<a href>` +
    // `Content-Disposition`), which POST cannot be.
    router.post('/events/bulk/export', events.exportBulkPost);
    router.get('/events/bulk/export', events.exportBulk);
    router.delete('/events/:name', events.remove);
    router.post('/events/:name/deprecate', deprecation.deprecate);
    router.delete('/events/:name/deprecate', deprecation.undeprecate);
    router.get('/deprecated', deprecation.list);
    // ─── Namespaces + topology ────────────────────────────────────────────────
    router.get('/namespaces', namespaces.list);
    router.get('/namespaces/summary', namespaces.summary);
    router.get('/topology', namespaces.topology);
    // ─── Audit ────────────────────────────────────────────────────────────────
    router.get('/audit', audit.stream);
    router.get('/audit/recent', audit.recent);
    // ─── Consumer manifests (only when a store is wired) ──────────────────────
    if (deps.manifestStore) {
        const manifests = (0, manifests_js_1.createManifestHandlers)(deps, deps.manifestStore);
        router.put('/manifests/:consumerName', manifests.put);
        router.get('/manifests', manifests.list);
        router.get('/manifests/:consumerName', manifests.get);
        router.delete('/manifests/:consumerName', manifests.remove);
        router.get('/manifests/check/all', manifests.checkAll);
    }
    // ─── Heartbeat + subscriber roll-up ───────────────────────────────────────
    router.post('/heartbeat', subscribers.heartbeat);
    router.get('/subscribers', subscribers.list);
    // ─── Contract exports ─────────────────────────────────────────────────────
    router.get('/asyncapi', contracts.asyncapi);
    router.get('/fingerprints', contracts.fingerprints);
    router.post('/freshness', contracts.freshness);
    // ─── Live flow tap ────────────────────────────────────────────────────────
    router.get('/flow', flow.stream);
    // ─── Health + metrics ─────────────────────────────────────────────────────
    router.get('/health', ops.health);
    router.get('/health/registry', ops.registryHealth);
    router.get('/metrics', ops.snapshot);
    router.get('/metrics/history', ops.history);
    // ─── Transports ───────────────────────────────────────────────────────────
    router.get('/transports/signal/channels', transports.signalChannels);
    router.get('/transports/durable/queues', transports.durableQueues);
    // ─── Dead-letter queue ────────────────────────────────────────────────────
    router.get('/transports/durable/dlq', dlq.list);
    router.delete('/transports/durable/dlq/:id', dlq.remove);
    router.post('/transports/durable/dlq/replay', dlq.replayBatch);
    router.post('/transports/durable/dlq/clear', dlq.clear);
    router.post('/transports/durable/dlq/:id/replay', dlq.replay);
    return router;
}
//# sourceMappingURL=routes.js.map