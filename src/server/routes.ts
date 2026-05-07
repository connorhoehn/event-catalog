import { Router, type Request, type Response } from 'express';
import type { Registry } from '../registry/index.js';
import type { MetricsCollector } from './metrics.js';
import type { SignalTransport } from '../client/signal.js';
import type { DurableTransport } from '../client/durable.js';
import type { EventDeclaration } from '../types/index.js';

export interface RoutesDeps {
  registry: Registry;
  metrics: MetricsCollector;
  signal: SignalTransport;
  durable: DurableTransport;
  startedAt: number;
}

export function createRoutes(deps: RoutesDeps): Router {
  const { registry, metrics, signal, durable, startedAt } = deps;
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
    const { name, schema, transport, producer, description, tags } = req.body as Partial<EventDeclaration>;

    if (!name || !transport || !producer) {
      res.status(400).json({ error: 'name, transport, and producer are required' });
      return;
    }

    if (transport !== 'signal' && transport !== 'durable') {
      res.status(400).json({ error: 'transport must be "signal" or "durable"' });
      return;
    }

    registry.declare({
      name,
      schema: schema ?? {},
      transport,
      producer,
      description,
      tags,
    });

    res.status(201).json({ declared: name });
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

      declared.push(event.name);
    }

    res.status(201).json({ declared, count: declared.length });
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
  router.get('/health', (_req: Request, res: Response) => {
    const uptimeMs = Date.now() - startedAt;
    res.json({
      status: 'ok',
      redis: signal.isConnected() ? 'connected' : 'disconnected',
      messageQueue: durable.isConnected() ? 'connected' : 'disconnected',
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

  return router;
}
