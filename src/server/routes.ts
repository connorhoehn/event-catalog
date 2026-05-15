import { Router, type Request, type Response } from 'express';
import type { Registry } from '../registry/index.js';
import { computeSchemaFingerprint } from '../registry/fingerprint.js';
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
  const { registry, metrics, metricsObserver, signal, durable, dlqStore, startedAt, promMetrics } = deps;
  const router = Router();

  // List all events
  router.get('/events', (_req: Request, res: Response) => {
    const transport = _req.query.transport as string | undefined;
    const producer = _req.query.producer as string | undefined;
    const subscriber = _req.query.subscriber as string | undefined;
    const tag = _req.query.tag as string | undefined;

    const entries = registry.list({
      transport: transport as 'signal' | 'durable' | undefined,
      producer,
      subscriber,
      tag,
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
  router.post('/events', (req: Request, res: Response) => {
    const {
      name, schema, transport, producer, description, tags, compatibilityMode, compatMode,
      // E3 fields:
      channel, discriminator, queue, retention, fifo, dlqAfterAttempts, dlqRetention, aliases,
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

    const result = registry.declare({
      name,
      schema: schema ?? {},
      transport,
      producer,
      description,
      tags,
      compatibilityMode,
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

      registry.declare({
        name: event.name,
        schema: event.schema ?? {},
        transport: event.transport,
        producer: event.producer ?? serviceName,
        description: event.description,
        tags: event.tags,
      });

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
    res.json({ event: req.params.name, removedSubscriber: req.params.serviceName });
  });

  // Delete an event declaration
  router.delete('/events/:name', (req: Request, res: Response) => {
    const removed = registry.remove(req.params.name);
    if (!removed) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
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
    };
    const anyFilter =
      filter.producer || filter.consumer || filter.eventType || filter.transport;
    const topology = registry.getTopology(anyFilter ? filter : undefined);
    res.json(topology);
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
