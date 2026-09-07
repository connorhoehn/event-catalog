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

import { Router, type HttpRouter } from './http-router.js';
import type { RoutesDeps } from './routes/_shared.js';
import { createEventHandlers } from './routes/events.js';
import { createSubscriberHandlers } from './routes/subscribers.js';
import { createDeprecationHandlers } from './routes/deprecation.js';
import { createNamespaceHandlers } from './routes/namespaces.js';
import { createAuditHandlers } from './routes/audit.js';
import { createManifestHandlers } from './routes/manifests.js';
import { createContractHandlers } from './routes/contracts.js';
import { createFlowHandlers } from './routes/flow.js';
import { createOpsHandlers } from './routes/ops.js';
import { createTransportHandlers } from './routes/transports.js';
import { createDlqHandlers } from './routes/dlq.js';

export type { RoutesDeps } from './routes/_shared.js';

export function createRoutes(deps: RoutesDeps): HttpRouter {
  // The router's own uncaught-handler warning goes to the same sink the
  // handlers use, so an operator sees one stream, not two.
  const router = Router(deps.logger);

  const events = createEventHandlers(deps);
  const subscribers = createSubscriberHandlers(deps);
  const deprecation = createDeprecationHandlers(deps);
  const namespaces = createNamespaceHandlers(deps);
  const audit = createAuditHandlers(deps);
  const contracts = createContractHandlers(deps);
  const flow = createFlowHandlers(deps);
  const ops = createOpsHandlers(deps);
  const transports = createTransportHandlers(deps);
  const dlq = createDlqHandlers(deps);

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
    const manifests = createManifestHandlers(deps, deps.manifestStore);
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
