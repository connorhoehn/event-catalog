"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoutes = createRoutes;
const express_1 = require("express");
function createRoutes(deps) {
    const { registry, metrics, signal, durable, startedAt } = deps;
    const router = (0, express_1.Router)();
    // List all events
    router.get('/events', (_req, res) => {
        const transport = _req.query.transport;
        const producer = _req.query.producer;
        const subscriber = _req.query.subscriber;
        const tag = _req.query.tag;
        const entries = registry.list({
            transport: transport,
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
    router.get('/events/:name', (req, res) => {
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
    router.get('/events/:name/stats', (req, res) => {
        const stats = metrics.getStats(req.params.name);
        if (!stats) {
            res.status(404).json({ error: `No stats for "${req.params.name}"` });
            return;
        }
        res.json(stats);
    });
    // Get event history (recent messages)
    router.get('/events/:name/history', async (req, res) => {
        const entry = registry.get(req.params.name);
        if (!entry) {
            res.status(404).json({ error: `Event "${req.params.name}" not found` });
            return;
        }
        const count = parseInt(req.query.count) || 50;
        if (entry.transport === 'signal') {
            const history = await signal.getHistory(entry.name, count);
            res.json({ messages: history, transport: 'signal' });
        }
        else {
            // For durable, we don't have a peek — return empty for now
            res.json({ messages: [], transport: 'durable', note: 'Durable history via message-queue peek not yet implemented' });
        }
    });
    // Declare/register an event
    router.post('/events', (req, res) => {
        const { name, schema, transport, producer, description, tags } = req.body;
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
    router.post('/events/bulk', (req, res) => {
        const { serviceName, events } = req.body;
        if (!serviceName || !events || !Array.isArray(events)) {
            res.status(400).json({ error: 'serviceName and events[] are required' });
            return;
        }
        const declared = [];
        for (const event of events) {
            if (!event.name || !event.transport)
                continue;
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
    router.delete('/events/:name', (req, res) => {
        const removed = registry.remove(req.params.name);
        if (!removed) {
            res.status(404).json({ error: `Event "${req.params.name}" not found` });
            return;
        }
        res.json({ removed: req.params.name });
    });
    // Topology graph
    router.get('/topology', (_req, res) => {
        const topology = registry.getTopology();
        res.json(topology);
    });
    // Health check
    router.get('/health', (_req, res) => {
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
    router.get('/metrics', (_req, res) => {
        res.json(metrics.snapshot());
    });
    // Signal transport channels
    router.get('/transports/signal/channels', (_req, res) => {
        const allMetrics = signal.getAllMetrics();
        const channels = [];
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
    router.get('/transports/durable/queues', (_req, res) => {
        const allMetrics = durable.getAllMetrics();
        const queues = [];
        for (const [queue, m] of allMetrics) {
            queues.push({ queue, ...m });
        }
        res.json({ queues, total: queues.length });
    });
    return router;
}
//# sourceMappingURL=routes.js.map