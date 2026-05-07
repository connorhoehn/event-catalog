"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const index_js_1 = require("../registry/index.js");
const signal_js_1 = require("../client/signal.js");
const durable_js_1 = require("../client/durable.js");
const metrics_js_1 = require("./metrics.js");
const routes_js_1 = require("./routes.js");
async function startServer(config = {}) {
    const { port = parseInt(process.env.PORT ?? '3010'), redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379', messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004', corsOrigin = true, } = config;
    const registry = new index_js_1.Registry();
    const metrics = new metrics_js_1.MetricsCollector(60);
    const signal = new signal_js_1.SignalTransport({ url: redisUrl });
    const durable = new durable_js_1.DurableTransport({ url: messageQueueUrl });
    const startedAt = Date.now();
    // Connect transports
    await signal.connect().catch(err => {
        console.warn('[server] Redis connection failed:', err.message);
    });
    await durable.connect().catch(err => {
        console.warn('[server] message-queue connection failed:', err.message);
    });
    // Build Express app
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({ origin: corsOrigin }));
    app.use(express_1.default.json({ limit: '1mb' }));
    // Admin API
    const routes = (0, routes_js_1.createRoutes)({ registry, metrics, signal, durable, startedAt });
    app.use('/api', routes);
    // Static admin UI (production)
    app.use(express_1.default.static(new URL('../admin/dist', import.meta.url).pathname));
    // SPA fallback for admin UI routes
    app.get('*', (_req, res) => {
        res.sendFile('index.html', { root: new URL('../admin/dist', import.meta.url).pathname });
    });
    // Start listening
    const server = app.listen(port, () => {
        console.log(`[event-catalog] server listening on :${port}`);
        console.log(`[event-catalog] redis: ${redisUrl}`);
        console.log(`[event-catalog] message-queue: ${messageQueueUrl}`);
        console.log(`[event-catalog] admin UI: http://localhost:${port}`);
    });
    const shutdown = async () => {
        console.log('[event-catalog] shutting down...');
        server.close();
        await signal.disconnect();
        await durable.disconnect();
        console.log('[event-catalog] shutdown complete');
    };
    return { app, shutdown };
}
//# sourceMappingURL=index.js.map