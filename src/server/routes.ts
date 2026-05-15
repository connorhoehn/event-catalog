import { Router, type Request, type Response } from 'express';
import type { Registry } from '../registry/index.js';
import { computeSchemaFingerprint } from '../registry/fingerprint.js';
import { tapEmitter, matchesTapFilter, type TapEvent } from './tap-emitter.js';
import { auditEmitter, matchesAuditFilter, type AuditEvent } from './audit-emitter.js';
import { buildAsyncApiSpec } from './asyncapi.js';
import type { MetricsCollector } from './metrics.js';
import type { MetricsObserver } from './metrics-observer.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { DLQStore } from './dlq-store.js';
import type { EventDeclaration } from '../types/index.js';
import type { PromMetrics } from './prom-metrics.js';

export interface RoutesDeps {
  registry: Registry;
  metrics: MetricsCollector;
  metricsObserver: MetricsObserver;
  signal: SignalTransport;
  durable: DurableTransport;
  dlqStore: DLQStore;
  startedAt: number;
  /** Optional prom-format metric surface; injected by startServer. */
  promMetrics?: PromMetrics;
  /**
   * wave23-a — optional handle to the persistent audit log. When
   * supplied, GET /api/audit/recent serves history from it and
   * GET /api/audit replays the last N events to a new SSE client
   * before streaming live.
   */
  auditLog?: { recent(limit?: number): Promise<import('./audit-emitter.js').AuditEvent[]> };
  /**
   * wave23-b — optional manifest store backing the /api/manifests
   * surface. Consumers POST {events, fingerprints} they depend on;
   * the catalog returns a per-consumer drift report on demand.
   */
  manifestStore?: import('./manifest-store.js').ManifestStore;
}

/**
 * EC-7 — resolve the effective compat-gate enforcement level for a POST
 * /events request. Precedence:
 *   1. incoming declaration's `compatMode` (operator changing it for this
 *      registration, including the first one)
 *   2. existing registry entry's `compatMode` (sticky from prior decl)
 *   3. per-request header `x-event-catalog-strict: true` ⇒ 'strict'
 *   4. env var `EVENT_CATALOG_STRICT=true` ⇒ 'strict'
 *   5. fallback: 'off'
 */
function resolveCompatMode(
  incoming: 'off' | 'warn' | 'strict' | undefined,
  existing: 'off' | 'warn' | 'strict' | undefined,
  headerStrict: boolean,
  envStrict: boolean,
): 'off' | 'warn' | 'strict' {
  if (incoming) return incoming;
  if (existing) return existing;
  if (headerStrict) return 'strict';
  if (envStrict) return 'strict';
  return 'off';
}

export function createRoutes(deps: RoutesDeps): Router {
  const { registry, metrics, metricsObserver, signal, durable, dlqStore, startedAt, promMetrics, auditLog, manifestStore } = deps;
  const router = Router();

  // List all events
  router.get('/events', (_req: Request, res: Response) => {
    const transport = _req.query.transport as string | undefined;
    const producer = _req.query.producer as string | undefined;
    const subscriber = _req.query.subscriber as string | undefined;
    const tag = _req.query.tag as string | undefined;
    // Phase E7 — namespace filter.
    const namespace = _req.query.namespace as string | undefined;

    const entries = registry.list({
      transport: transport as 'signal' | 'durable' | undefined,
      producer,
      subscriber,
      tag,
      namespace,
    });

    const enriched = entries.map(entry => ({
      ...entry,
      stats: metrics.getStats(entry.name),
    }));

    res.json({ events: enriched, total: enriched.length });
  });

  // Get single event — also serves as the schema-fetch endpoint for
  // downstream validators (Wave 3 EC-6).
  //
  // Optional `?version=N` selects a historical version from
  // schemaHistory; otherwise the latest schema is returned. Response
  // is the full RegistryEntry plus stats for backwards compatibility
  // with the admin UI, plus an explicit `validationMode` field that
  // defaults to `off` system-wide (per-event overrides arrive in EC-7).
  router.get('/events/:name', (req: Request, res: Response) => {
    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    // Parse + validate ?version=N before counting the fetch — a 400
    // shouldn't bump the consumer-pull counter.
    let selectedVersion = entry.version;
    let selectedSchema = entry.schema;
    const rawVersion = req.query.version;
    if (rawVersion !== undefined) {
      const parsed = Number(rawVersion);
      if (!Number.isInteger(parsed) || parsed < 1) {
        res.status(400).json({
          error: `version must be a positive integer, got "${String(rawVersion)}"`,
        });
        return;
      }
      if (parsed !== entry.version) {
        const historical = entry.schemaHistory.find(h => h.version === parsed);
        if (!historical) {
          res.status(404).json({
            error: `Version ${parsed} not found in history for "${entry.name}"`,
          });
          return;
        }
        selectedVersion = historical.version;
        selectedSchema = historical.schema;
      }
    }

    // Every GET on an event's declaration counts as a schema fetch —
    // surfaces consumer-pull demand in /metrics.
    promMetrics?.recordSchemaFetch(entry.name);

    // EC-6: validation mode defaults to `off` system-wide so MQ rollout
    // stays safe; per-event overrides land in EC-7.
    const validationMode: 'off' | 'warn' | 'strict' = 'off';

    res.json({
      ...entry,
      // Override version + schema when ?version=N selected a historical
      // entry. Other fields (producer, transport, etc.) reflect the
      // current declaration.
      version: selectedVersion,
      schema: selectedSchema,
      validationMode,
      stats: metrics.getStats(entry.name),
    });
  });

  // Check schema compatibility without declaring
  router.get('/events/:name/schema/check', (req: Request, res: Response) => {
    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    const schema = req.body?.schema as Record<string, unknown> | undefined;
    if (!schema) {
      res.status(400).json({ error: 'schema is required in the request body' });
      return;
    }

    const result = registry.checkSchemaCompat(req.params.name, schema);
    res.json({
      eventName: req.params.name,
      currentVersion: entry.version,
      compatibilityMode: entry.compatibilityMode,
      ...result,
    });
  });

  // Get event stats
  router.get('/events/:name/stats', (req: Request, res: Response) => {
    const stats = metrics.getStats(req.params.name);
    if (!stats) {
      res.status(404).json({ error: `No stats for "${req.params.name}"` });
      return;
    }
    res.json(stats);
  });

  // Get event history (recent messages)
  router.get('/events/:name/history', async (req: Request, res: Response) => {
    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    const count = parseInt(req.query.count as string) || 50;

    if (entry.transport === 'signal') {
      const history = await signal.getHistory(entry.name, count);
      res.json({ messages: history, transport: 'signal' });
    } else {
      // For durable, we don't have a peek — return empty for now
      res.json({ messages: [], transport: 'durable', note: 'Durable history via message-queue peek not yet implemented' });
    }
  });

  // Declare/register an event
  router.post('/events', async (req: Request, res: Response) => {
    const {
      name, schema, transport, producer, description, tags, compatibilityMode, compatMode,
      // E3 fields:
      channel, discriminator, queue, retention, fifo, dlqAfterAttempts, dlqRetention, aliases,
      // E7 — explicit namespace (auto-derived if absent).
      namespace,
    } = req.body as Partial<EventDeclaration>;

    if (!name || !transport || !producer) {
      res.status(400).json({ error: 'name, transport, and producer are required' });
      return;
    }

    if (transport !== 'signal' && transport !== 'durable' && transport !== 'both') {
      res.status(400).json({ error: 'transport must be "signal", "durable", or "both"' });
      return;
    }

    // EC-7 — resolve enforcement BEFORE mutating the registry, then run
    // the same compat check the library uses against the prior version.
    // If strict and breaking, return 409 without applying the update so
    // the registry stays on the prior valid schema.
    const existing = registry.get(name);
    const headerStrict = req.header('x-event-catalog-strict') === 'true';
    const envStrict = process.env.EVENT_CATALOG_STRICT === 'true';
    const effectiveMode = resolveCompatMode(
      compatMode,
      existing?.compatMode,
      headerStrict,
      envStrict,
    );

    if (existing && schema && Object.keys(schema).length > 0 && effectiveMode !== 'off') {
      const compat = registry.checkSchemaCompat(name, schema);
      if (!compat.compatible) {
        if (effectiveMode === 'strict') {
          // Phase E6 — surface both fingerprints on the 409 so the caller
          // can confirm in one round-trip whether their local cache matches
          // the registry's current schema vs. the proposed one.
          res.status(409).json({
            error: {
              code: 'COMPAT_VIOLATION',
              eventName: name,
              violations: compat.violations,
              currentFingerprint: existing.schemaFingerprint,
              proposedFingerprint: computeSchemaFingerprint(schema),
            },
          });
          return;
        }
        // 'warn' — fall through to declare, but log advisory. The
        // violations are also surfaced on the 201 response below.
        console.warn(
          `[event-catalog] compat-warn for "${name}": ${compat.violations.join('; ')}`,
        );
      }
    }

    // wave23-c — manifest-aware deploy gate. When `?check-manifests=`
    // is set and a fingerprint change is proposed, look up every
    // pinned consumer manifest and find ones whose pin matches the
    // CURRENT fingerprint (those consumers think they're fresh; the
    // proposed declare would silently make them stale).
    //
    //   strict → 409 with affected_consumers list, no declare
    //   warn   → 201 with affected_consumers field, declare proceeds
    //   off    → no check (default)
    let affectedConsumers: Array<{ consumerName: string; pinnedFingerprint: string }> = [];
    const checkManifestsMode = (() => {
      const q = req.query['check-manifests'];
      if (q === 'strict' || q === 'warn' || q === 'off') return q;
      return 'off';
    })();
    if (
      manifestStore
      && checkManifestsMode !== 'off'
      && existing
      && schema
      && Object.keys(schema).length > 0
    ) {
      const proposedFp = computeSchemaFingerprint(schema);
      if (proposedFp !== existing.schemaFingerprint) {
        const all = await manifestStore.list();
        for (const m of all) {
          for (const evt of m.events) {
            if (evt.name === name && evt.fingerprint === existing.schemaFingerprint) {
              affectedConsumers.push({
                consumerName: m.consumerName,
                pinnedFingerprint: evt.fingerprint,
              });
              break; // one entry per consumer is enough
            }
          }
        }
        if (affectedConsumers.length > 0 && checkManifestsMode === 'strict') {
          res.status(409).json({
            error: {
              code: 'PINNED_CONSUMER_BREAK',
              eventName: name,
              currentFingerprint: existing.schemaFingerprint,
              proposedFingerprint: proposedFp,
              affectedConsumers,
            },
          });
          return;
        }
        if (affectedConsumers.length > 0) {
          console.warn(
            `[event-catalog] check-manifests warn: declare("${name}") would stale ${affectedConsumers.length} pinned consumer(s)`,
          );
        }
      }
    }

    // Snapshot the prior version BEFORE Registry.declare runs (it
    // mutates `existing` in place, so reading existing.version
    // afterwards gives us the new value).
    const priorVersion = existing?.version;

    const result = registry.declare({
      name,
      schema: schema ?? {},
      transport,
      producer,
      description,
      tags,
      compatibilityMode,
      ...(typeof namespace === 'string' && namespace.length > 0 ? { namespace } : {}),
      ...(compatMode ? { compatMode } : {}),
      // Pass through E3 fields when present. `channel` and `partitionKey`
      // can be functions which don't serialize over HTTP, so only the
      // string form of `channel` is accepted here.
      ...(typeof channel === 'string' ? { channel } : {}),
      ...(discriminator ? { discriminator } : {}),
      ...(queue ? { queue } : {}),
      ...(typeof retention === 'number' ? { retention } : {}),
      ...(typeof fifo === 'boolean' ? { fifo } : {}),
      ...(typeof dlqAfterAttempts === 'number' ? { dlqAfterAttempts } : {}),
      ...(typeof dlqRetention === 'number' ? { dlqRetention } : {}),
      ...(aliases ? { aliases } : {}),
    });

    metricsObserver.observe(name, transport).catch(() => {});

    // wave22-d — audit emit. priorVersion was captured above before
    // Registry.declare mutated existing in place.
    const after = registry.get(name);
    if (after) {
      auditEmitter.publish({
        kind: priorVersion !== undefined && after.version > priorVersion
          ? 'event.version.bumped'
          : 'event.declared',
        timestamp: new Date().toISOString(),
        eventName: after.name,
        namespace: after.namespace,
        version: after.version,
        fingerprint: after.schemaFingerprint,
        violations: result.violations,
      });
    }

    const response: Record<string, unknown> = {
      declared: name,
      version: result.version,
      compatible: result.compatible,
      // Phase E6 — return the fingerprint so consumers can cache it
      // immediately rather than re-fetching via GET /api/events/:name.
      schemaFingerprint: result.schemaFingerprint,
    };
    if (result.violations) {
      response.violations = result.violations;
    }
    // wave23-c — surface warn-mode pinned-consumer breaks on the 201
    // so CI can flag deploys that are technically allowed but would
    // stale a pinned consumer's manifest.
    if (affectedConsumers.length > 0) {
      response.affectedConsumers = affectedConsumers;
    }
    res.status(201).json(response);
  });

  // Bulk register events (called by services at startup)
  router.post('/events/bulk', (req: Request, res: Response) => {
    const { serviceName, events } = req.body as {
      serviceName?: string;
      events?: Array<Partial<EventDeclaration>>;
    };

    if (!serviceName || !events || !Array.isArray(events)) {
      res.status(400).json({ error: 'serviceName and events[] are required' });
      return;
    }

    const declared: string[] = [];

    for (const event of events) {
      if (!event.name || !event.transport) continue;

      // Snapshot the prior version BEFORE declare mutates `before` in
      // place (same gotcha as the singleton route above).
      const priorVersion = registry.get(event.name)?.version;
      registry.declare({
        name: event.name,
        schema: event.schema ?? {},
        transport: event.transport,
        producer: event.producer ?? serviceName,
        description: event.description,
        tags: event.tags,
        // Phase E7 — pass through explicit namespace if provided; the
        // Registry auto-derives from the event name otherwise.
        ...(typeof event.namespace === 'string' && event.namespace.length > 0
          ? { namespace: event.namespace }
          : {}),
      });

      // wave22-d — emit one audit record per declared event in the bulk.
      const after = registry.get(event.name);
      if (after) {
        auditEmitter.publish({
          kind: priorVersion !== undefined && after.version > priorVersion
            ? 'event.version.bumped'
            : 'event.declared',
          timestamp: new Date().toISOString(),
          eventName: after.name,
          namespace: after.namespace,
          version: after.version,
          fingerprint: after.schemaFingerprint,
        });
      }

      metricsObserver.observe(event.name, event.transport).catch(() => {});
      declared.push(event.name);
    }

    res.status(201).json({ declared, count: declared.length });
  });

  // Register a subscriber for an event
  router.post('/events/:name/subscribers', (req: Request, res: Response) => {
    const { serviceName } = req.body as { serviceName?: string };

    if (!serviceName) {
      res.status(400).json({ error: 'serviceName is required' });
      return;
    }

    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    registry.addSubscriber(req.params.name, serviceName);
    auditEmitter.publish({
      kind: 'subscriber.added',
      timestamp: new Date().toISOString(),
      eventName: req.params.name,
      namespace: entry.namespace,
      serviceName,
    });
    res.status(201).json({ event: req.params.name, subscriber: serviceName });
  });

  // Remove a subscriber from an event
  router.delete('/events/:name/subscribers/:serviceName', (req: Request, res: Response) => {
    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    registry.removeSubscriber(req.params.name, req.params.serviceName);
    auditEmitter.publish({
      kind: 'subscriber.removed',
      timestamp: new Date().toISOString(),
      eventName: req.params.name,
      namespace: entry.namespace,
      serviceName: req.params.serviceName,
    });
    res.json({ event: req.params.name, removedSubscriber: req.params.serviceName });
  });

  // Delete an event declaration
  router.delete('/events/:name', (req: Request, res: Response) => {
    const before = registry.get(req.params.name);
    const removed = registry.remove(req.params.name);
    if (!removed) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }
    if (before) {
      auditEmitter.publish({
        kind: 'event.removed',
        timestamp: new Date().toISOString(),
        eventName: before.name,
        namespace: before.namespace,
        version: before.version,
      });
    }
    res.json({ removed: req.params.name });
  });

  // Topology graph — optional ?producer=, ?consumer=, ?eventType=, ?transport=
  // filters AND-combine to restrict which events (and induced services) appear
  // in the returned subgraph. No filter ⇒ full topology.
  router.get('/topology', (req: Request, res: Response) => {
    const q = req.query as Record<string, unknown>;
    const filter = {
      producer: typeof q.producer === 'string' ? q.producer : undefined,
      consumer: typeof q.consumer === 'string' ? q.consumer : undefined,
      eventType: typeof q.eventType === 'string' ? q.eventType : undefined,
      transport: typeof q.transport === 'string' ? q.transport : undefined,
      // Phase E7 — namespace filter on the topology subgraph.
      namespace: typeof q.namespace === 'string' ? q.namespace : undefined,
    };
    const anyFilter =
      filter.producer || filter.consumer || filter.eventType || filter.transport || filter.namespace;
    const topology = registry.getTopology(anyFilter ? filter : undefined);
    res.json(topology);
  });

  // wave22-d — registry-mutation audit SSE. Mirror of /api/flow for
  // the slow path: every time the registry mutates (declare, version-
  // bump, removal, subscriber add/remove), a structured AuditEvent
  // is streamed to subscribers. Powers admin UI "registry changes"
  // panels and live audit dashboards.
  router.get('/audit', async (req: Request, res: Response) => {
    const filter = {
      kind: typeof req.query.kind === 'string' ? (req.query.kind as AuditEvent['kind']) : undefined,
      eventName: typeof req.query.eventName === 'string' ? req.query.eventName : undefined,
      namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
      serviceName: typeof req.query.serviceName === 'string' ? req.query.serviceName : undefined,
    };
    // wave23-a — replay-on-connect knob. ?replay=N reads the last N
    // events from the persistent log and writes them as SSE frames
    // before streaming live. Default 0 (no replay) for back-compat.
    const replayN = Math.max(0, parseInt(String(req.query.replay ?? '0'), 10) || 0);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`: connected; filter=${JSON.stringify(filter)}; replay=${replayN}\n\n`);

    // Replay history first when an audit log is wired and the caller
    // asked for it. Skipped if disconnected mid-replay.
    if (replayN > 0 && auditLog) {
      try {
        const history = await auditLog.recent(replayN);
        for (const event of history) {
          if (matchesAuditFilter(event, filter)) {
            res.write(`data: ${JSON.stringify({ ...event, _replay: true })}\n\n`);
          }
        }
      } catch {
        // Log read failed — keep the live stream open anyway.
      }
    }

    const handler = (event: AuditEvent): void => {
      if (!matchesAuditFilter(event, filter)) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    auditEmitter.on('audit', handler);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, 30_000);

    req.on('close', () => {
      auditEmitter.off('audit', handler);
      clearInterval(heartbeat);
    });
  });

  // wave23-a — query the persistent audit log without subscribing
  // to live SSE. Useful for one-off lookups + the admin UI's initial
  // render (avoids a slow-to-paint blank panel).
  router.get('/audit/recent', async (req: Request, res: Response) => {
    if (!auditLog) {
      res.json({ events: [], note: 'no persistent audit log wired' });
      return;
    }
    const limit = Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50);
    const events = await auditLog.recent(limit);
    res.json({ events });
  });

  // wave23-b — consumer manifest pinning. Consumers POST a list of
  // events + fingerprints they depend on; the catalog stores per
  // consumer and exposes a drift report comparing each pinned
  // fingerprint to the current registry value.
  if (manifestStore) {
    router.put('/manifests/:consumerName', async (req: Request, res: Response) => {
      const consumerName = req.params.consumerName;
      const events = req.body?.events;
      if (!Array.isArray(events)) {
        res.status(400).json({ error: 'body.events must be an array of { name, fingerprint }' });
        return;
      }
      // Light shape check — every entry needs a string name + 64-char fingerprint.
      for (const [i, e] of events.entries()) {
        if (typeof e?.name !== 'string' || typeof e?.fingerprint !== 'string') {
          res.status(400).json({ error: `events[${i}]: name and fingerprint are required strings` });
          return;
        }
      }
      const stored = await manifestStore.put({ consumerName, events });
      res.status(201).json(stored);
    });

    router.get('/manifests', async (_req: Request, res: Response) => {
      const manifests = await manifestStore.list();
      res.json({ manifests, count: manifests.length });
    });

    router.get('/manifests/:consumerName', async (req: Request, res: Response) => {
      const m = await manifestStore.get(req.params.consumerName);
      if (!m) {
        res.status(404).json({ error: `No manifest pinned for consumer "${req.params.consumerName}"` });
        return;
      }
      res.json(m);
    });

    router.delete('/manifests/:consumerName', async (req: Request, res: Response) => {
      const removed = await manifestStore.remove(req.params.consumerName);
      if (!removed) {
        res.status(404).json({ error: `No manifest to remove for "${req.params.consumerName}"` });
        return;
      }
      res.json({ removed: req.params.consumerName });
    });

    router.get('/manifests/check/all', async (_req: Request, res: Response) => {
      const fingerprints = new Map<string, string>();
      for (const e of registry.list()) fingerprints.set(e.name, e.schemaFingerprint);
      const reports = await manifestStore.driftReport(fingerprints);
      res.json({ reports });
    });
  }

  // wave24-b — refresh subscriber lastSeenAt timestamps. Body:
  //   { serviceName: 'svc-1', events?: ['a.x', 'b.y'] }
  // When `events` is omitted, refreshes every event the service is
  // currently subscribed to. Returns the events that were actually
  // refreshed (a service may have been pruned in the meantime).
  router.post('/heartbeat', (req: Request, res: Response) => {
    const { serviceName, events } = req.body as { serviceName?: unknown; events?: unknown };
    if (typeof serviceName !== 'string' || serviceName.length === 0) {
      res.status(400).json({ error: 'serviceName is required' });
      return;
    }
    const eventNames = Array.isArray(events) && events.every((e) => typeof e === 'string')
      ? (events as string[])
      : undefined;
    const refreshed = registry.heartbeat(serviceName, eventNames);
    res.json({ serviceName, refreshed, count: refreshed.length });
  });

  // wave24-b — list every subscriber + its lastSeenAt. Optional
  // `?staleAfter=<seconds>` filter returns only subscribers older
  // than the threshold (useful for "who's overdue?" dashboards).
  router.get('/subscribers', (req: Request, res: Response) => {
    const all = registry.listSubscriberHeartbeats();
    const staleAfter = parseInt(String(req.query.staleAfter ?? ''), 10);
    if (Number.isFinite(staleAfter) && staleAfter > 0) {
      const cutoff = Date.now() - staleAfter * 1000;
      const stale = all.filter((s) => Date.parse(s.lastSeenAt) < cutoff);
      res.json({ subscribers: stale, total: stale.length, filter: { staleAfter } });
      return;
    }
    res.json({ subscribers: all, total: all.length });
  });

  // wave24-c — AsyncAPI 3.0 export. Generated from the registry on
  // demand; pairs with the existing OpenAPI spec for a complete
  // codegen-friendly contract surface. ?namespace= filter narrows
  // output to one domain.
  router.get('/asyncapi', (req: Request, res: Response) => {
    const namespace = typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
    const spec = buildAsyncApiSpec(registry, { namespace });
    res.json(spec);
  });

  // Phase 21-e — flat fingerprint manifest. Returns
  // `{ <eventName>: <schemaFingerprint> }` for every declared event
  // (or every event in a namespace when filtered). Designed for CI:
  //   $ curl /api/fingerprints > current.json
  //   $ diff snapshot.json current.json   # → see schema changes
  // Cheaper than GET /api/events when callers only need fingerprints.
  router.get('/fingerprints', (req: Request, res: Response) => {
    const namespace = typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
    const entries = registry.list(namespace ? { namespace } : undefined);
    const manifest: Record<string, string> = {};
    for (const e of entries) {
      manifest[e.name] = e.schemaFingerprint;
    }
    res.json(manifest);
  });

  // Phase 21-g — server-side freshness comparator. Mirror of the
  // client-side `catalog.checkAllSchemaFreshness()` helper for thin
  // consumers (lambdas, batch jobs, sidecars) that don't want to
  // instantiate the full EventCatalog client just to detect drift.
  //
  //   POST /api/freshness
  //   { "events": [
  //       { "name": "pipeline.run.started", "fingerprint": "abc..." },
  //       { "name": "missing.event",        "fingerprint": "xyz..." }
  //   ] }
  //
  //   → 200 OK
  //   { "reports": [
  //       { "name": "pipeline.run.started", "status": "fresh", "localFingerprint": "abc...", "remoteFingerprint": "abc..." },
  //       { "name": "missing.event",        "status": "unknown", "localFingerprint": "xyz...", "remoteFingerprint": null }
  //   ] }
  router.post('/freshness', (req: Request, res: Response) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'body.events must be an array of { name, fingerprint }' });
      return;
    }
    const reports = events.map((evt: { name?: unknown; fingerprint?: unknown }) => {
      const name = typeof evt?.name === 'string' ? evt.name : null;
      const localFp = typeof evt?.fingerprint === 'string' ? evt.fingerprint : null;
      if (!name || !localFp) {
        return {
          name: name ?? '',
          status: 'invalid' as const,
          error: 'each event needs a string name + fingerprint',
        };
      }
      const entry = registry.get(name);
      const remoteFp = entry?.schemaFingerprint ?? null;
      const status: 'fresh' | 'stale' | 'unknown' = remoteFp === null
        ? 'unknown'
        : remoteFp === localFp
          ? 'fresh'
          : 'stale';
      return {
        name,
        status,
        localFingerprint: localFp,
        remoteFingerprint: remoteFp,
      };
    });
    res.json({ reports });
  });

  // Phase E8 — live flow tap (SSE). Subscribers stream every observed
  // event publish through the catalog's MetricsObserver, optionally
  // filtered. Sample knob (`?sample=N`) emits 1-in-N events for high-
  // volume namespaces; default is unfiltered.
  router.get('/flow', (req: Request, res: Response) => {
    const filter = {
      eventName: typeof req.query.eventName === 'string' ? req.query.eventName : undefined,
      transport:
        req.query.transport === 'signal' || req.query.transport === 'durable'
          ? req.query.transport
          : undefined,
      producer: typeof req.query.producer === 'string' ? req.query.producer : undefined,
      namespace: typeof req.query.namespace === 'string' ? req.query.namespace : undefined,
    };
    const sampleN = Math.max(1, parseInt(String(req.query.sample ?? '1'), 10) || 1);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Defeat nginx / proxies that otherwise buffer SSE responses.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Opening comment lets clients know the stream is live even before
    // the first event arrives.
    res.write(`: connected; filter=${JSON.stringify(filter)}; sample=${sampleN}\n\n`);

    let counter = 0;
    const handler = (event: TapEvent): void => {
      if (!matchesTapFilter(event, filter)) return;
      counter += 1;
      if (counter % sampleN !== 0) return;
      // SSE frame; one event per data line.
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    tapEmitter.on('publish', handler);

    // Heartbeat every 30s to prevent intermediaries from idle-timing out.
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, 30_000);

    req.on('close', () => {
      tapEmitter.off('publish', handler);
      clearInterval(heartbeat);
    });
  });

  // Health check
  router.get('/health', async (_req: Request, res: Response) => {
    const [redisHealth, mqHealth] = await Promise.all([
      signal.healthCheck(),
      durable.healthCheck(),
    ]);

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (redisHealth.status === 'disconnected' || mqHealth.status === 'disconnected') {
      status = 'unhealthy';
    } else if (redisHealth.status === 'degraded' || mqHealth.status === 'degraded') {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const httpStatus = status === 'unhealthy' ? 503 : 200;
    const uptimeMs = Date.now() - startedAt;

    res.status(httpStatus).json({
      status,
      redis: redisHealth,
      messageQueue: mqHealth,
      uptime: Math.floor(uptimeMs / 1000),
      eventCount: registry.size(),
    });
  });

  // All metrics snapshot
  router.get('/metrics', (_req: Request, res: Response) => {
    res.json(metrics.snapshot());
  });

  // Signal transport channels
  router.get('/transports/signal/channels', (_req: Request, res: Response) => {
    const allMetrics = signal.getAllMetrics();
    const channels: Array<{ channel: string; publishCount: number; lastPublishedAt: string | null; subscriberCount: number }> = [];

    for (const [channel, m] of allMetrics) {
      channels.push({
        channel,
        publishCount: m.publishCount,
        lastPublishedAt: m.lastPublishedAt,
        subscriberCount: m.subscriberCount,
      });
    }

    res.json({ channels, total: channels.length });
  });

  // Durable transport queues
  router.get('/transports/durable/queues', (_req: Request, res: Response) => {
    const allMetrics = durable.getAllMetrics();
    const queues: Array<{ queue: string; sent: number; received: number; failed: number; inFlight: number }> = [];

    for (const [queue, m] of allMetrics) {
      queues.push({ queue, ...m });
    }

    res.json({ queues, total: queues.length });
  });

  // Durable transport dead-letter queue (persisted)
  router.get('/transports/durable/dlq', async (req: Request, res: Response) => {
    const eventName = req.query.eventName as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    try {
      const entries = await dlqStore.list({ eventName, limit });
      res.json({ messages: entries, total: entries.length });
    } catch (err) {
      const inMemory = durable.getDLQ();
      res.json({ messages: inMemory, total: inMemory.length, source: 'in-memory', error: (err as Error).message });
    }
  });

  // Delete a single DLQ entry
  router.delete('/transports/durable/dlq/:id', async (req: Request, res: Response) => {
    const removed = await dlqStore.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: `DLQ entry "${req.params.id}" not found` });
      return;
    }
    res.json({ removed: req.params.id });
  });

  // Phase E5.2 — batch redrive. Accepts `{ ids: string[] }` and runs the
  // single-replay logic per id. Reuses each entry's id as the published
  // envelope's idempotency key so partial-failure retries don't double-
  // deliver. Always returns 200 with a per-id breakdown — callers
  // inspect `failed[]` to decide whether to retry.
  router.post('/transports/durable/dlq/replay', async (req: Request, res: Response) => {
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
      res.status(400).json({ error: 'ids must be a non-empty array of strings' });
      return;
    }

    const replayed: Array<{ id: string; eventName: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids as string[]) {
      const entry = await dlqStore.findById(id);
      if (!entry) {
        failed.push({ id, error: 'not found' });
        continue;
      }
      const queueName = DurableTransport.eventNameToQueueName(entry.eventName);
      try {
        await durable.publish(queueName, {
          eventName: entry.eventName,
          payload: entry.payload,
          metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
        });
        await dlqStore.remove(entry.id);
        replayed.push({ id: entry.id, eventName: entry.eventName });
      } catch (err) {
        failed.push({ id, error: (err as Error).message });
      }
    }

    res.json({ replayed, failed, total: ids.length });
  });

  // Replay a DLQ entry: re-publish to durable transport, then delete
  router.post('/transports/durable/dlq/:id/replay', async (req: Request, res: Response) => {
    const entry = await dlqStore.findById(req.params.id);
    if (!entry) {
      res.status(404).json({ error: `DLQ entry "${req.params.id}" not found` });
      return;
    }

    const queueName = DurableTransport.eventNameToQueueName(entry.eventName);
    try {
      await durable.publish(queueName, {
        eventName: entry.eventName,
        payload: entry.payload,
        metadata: { id: entry.id, producer: 'dlq-replay', timestamp: Date.now() },
      });
      await dlqStore.remove(entry.id);
      res.json({ replayed: entry.id, eventName: entry.eventName });
    } catch (err) {
      res.status(500).json({ error: `Replay failed: ${(err as Error).message}` });
    }
  });

  return router;
}
