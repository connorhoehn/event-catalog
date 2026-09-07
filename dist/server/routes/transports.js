"use strict";
// src/server/routes/transports.ts
//
// Per-transport inventory: Redis pub/sub channels observed by the
// SignalTransport, and message-queue queues observed by the
// DurableTransport.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransportHandlers = createTransportHandlers;
function createTransportHandlers(deps) {
    const { signal, durable } = deps;
    // Signal transport channels
    function signalChannels(_req, res) {
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
    }
    // Durable transport queues
    function durableQueues(_req, res) {
        const allMetrics = durable.getAllMetrics();
        const queues = [];
        for (const [queue, m] of allMetrics) {
            queues.push({ queue, ...m });
        }
        res.json({ queues, total: queues.length });
    }
    return { signalChannels, durableQueues };
}
//# sourceMappingURL=transports.js.map