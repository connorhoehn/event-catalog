import { Router, type Request, type Response } from 'express';
import type { Registry } from '../registry/index.js';
import type { MetricsCollector } from './metrics.js';
import type { MetricsObserver } from './metrics-observer.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { DLQStore } from './dlq-store.js';
import type { EventDeclaration } from '../types/index.js';

export interface RoutesDeps {
  registry: Registry;
  metrics: MetricsCollector;
  metricsObserver: MetricsObserver;
  signal: SignalTransport;
  durable: DurableTransport;
  dlqStore: DLQStore;
  startedAt: number;
}

export function createRoutes(deps: RoutesDeps): Router {
  const { registry, metrics, metricsObserver, signal, durable, dlqStore, startedAt } = deps;
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

  // Get single event
  router.get('/events/:name', (req: Request, res: Response) => {
    const entry = registry.get(req.params.name);
    if (!entry) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }

    res.json({
      ...entry,
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
    const { name, schema, transport, producer, description, tags, compatibilityMode } = req.body as Partial<EventDeclaration>;

    if (!name || !transport || !producer) {
      res.status(400).json({ error: 'name, transport, and producer are required' });
      return;
    }

    if (transport !== 'signal' && transport !== 'durable') {
      res.status(400).json({ error: 'transport must be "signal" or "durable"' });
      return;
    }

    const result = registry.declare({
      name,
      schema: schema ?? {},
      transport,
      producer,
      description,
      tags,
      compatibilityMode,
    });

    metricsObserver.observe(name, transport).catch(() => {});
    const response: Record<string, unknown> = { declared: name, version: result.version, compatible: result.compatible };
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

  // Topology graph
  router.get('/topology', (_req: Request, res: Response) => {
    const topology = registry.getTopology();
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
