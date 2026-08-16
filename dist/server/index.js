"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeadLetterCallback = buildDeadLetterCallback;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const redis_1 = require("redis");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const index_js_1 = require("../registry/index.js");
const signal_js_1 = require("../client/signal.js");
const durable_js_1 = require("../client/durable.js");
const metrics_js_1 = require("./metrics.js");
const metrics_observer_js_1 = require("./metrics-observer.js");
const alerting_js_1 = require("./alerting.js");
const dlq_store_js_1 = require("./dlq-store.js");
const dynamo_setup_js_1 = require("./dynamo-setup.js");
const audit_log_js_1 = require("./audit-log.js");
const manifest_store_js_1 = require("./manifest-store.js");
const routes_js_1 = require("./routes.js");
const bundle_routes_js_1 = require("./bundle-routes.js");
const FeatureBundle_js_1 = require("../bundles/FeatureBundle.js");
const health_js_1 = require("./health.js");
const prom_metrics_js_1 = require("./prom-metrics.js");
const producer_attribution_js_1 = require("./producer-attribution.js");
const poison_detector_js_1 = require("./poison-detector.js");
const registry_coordinator_js_1 = require("./registry-coordinator.js");
const node_fs_1 = require("node:fs");
const redis_boot_strategy_js_1 = require("../utils/redis-boot-strategy.js");
function readServiceVersion() {
    try {
        const pkgPath = new URL('../../package.json', import.meta.url).pathname;
        const pkg = JSON.parse((0, node_fs_1.readFileSync)(pkgPath, 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Phase 20-d — internal factory that builds the dead-letter callback
 * the server registers on the DurableTransport. Exported so tests can
 * exercise the wiring in isolation (no Redis / DDB roundtrip).
 *
 *   1. Write to the DLQ store (honoring declared dlqRetention).
 *   2. Fan out to operator-supplied handlers with enriched context.
 *      Errors caught + logged so a webhook hiccup can't fail the
 *      primary DLQ write.
 */
function buildDeadLetterCallback(deps) {
    return (message) => {
        const entry = deps.registry.get(message.envelope.eventName);
        deps.dlqStore.put({
            eventName: message.envelope.eventName,
            payload: message.envelope.payload,
            error: message.error,
            attempts: message.attempts,
            deadAt: message.deadLetteredAt,
        }, entry?.dlqRetention).catch((err) => {
            console.error('[server] DLQ store write failed:', err.message);
        });
        if (deps.additionalHandlers.length === 0)
            return;
        const context = { entry, namespace: entry?.namespace };
        for (const handler of deps.additionalHandlers) {
            // Wrap with new Promise() so a SYNCHRONOUS throw inside the
            // handler is caught alongside async rejections.
            new Promise((resolve) => {
                resolve(handler(message, context));
            }).catch((err) => {
                console.warn(`[server] DLQ handler threw on "${message.envelope.eventName}":`, err.message);
            });
        }
    };
}
async function startServer(config = {}) {
    const { port = parseInt(process.env.PORT ?? '3010'), redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379', messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004', corsOrigin = true, onDeadLetter = [], authMiddleware, } = config;
    // Boot-bounded reconnect: without this, a down Redis makes connect() retry
    // forever, the catch below never fires, and boot never reaches app.listen().
    const registryBootStrategy = (0, redis_boot_strategy_js_1.createBootBoundedReconnectStrategy)({ label: 'registry' });
    const redisClient = (0, redis_1.createClient)({
        url: redisUrl,
        socket: { reconnectStrategy: registryBootStrategy.reconnectStrategy },
    });
    redisClient.on('error', (err) => {
        console.warn('[server] registry Redis error:', (0, redis_boot_strategy_js_1.formatRedisError)(err));
    });
    await redisClient.connect()
        .then(() => registryBootStrategy.markConnected())
        .catch(err => {
        console.warn('[server] registry Redis connection failed:', (0, redis_boot_strategy_js_1.formatRedisError)(err), '— continuing in degraded mode (in-memory registry, no cross-replica sync)');
    });
    const registry = new index_js_1.Registry(redisClient);
    // Hydration is best-effort: with Redis down the client is closed and
    // hGetAll throws ClientClosedError. Serve an empty in-memory registry
    // instead of failing boot — producers re-declare on their next sync.
    await registry.load().catch(err => {
        console.warn('[server] registry hydration failed:', (0, redis_boot_strategy_js_1.formatRedisError)(err), '— starting with an empty in-memory registry');
    });
    const metrics = new metrics_js_1.MetricsCollector(60);
    await metrics.restoreFromRedis(redisClient).catch(err => {
        console.warn('[server] metrics restore failed:', (0, redis_boot_strategy_js_1.formatRedisError)(err));
    });
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
    await (0, dynamo_setup_js_1.ensureTable)().catch(err => {
        console.warn('[server] DLQ table auto-provision failed:', err.message);
    });
    const dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(new client_dynamodb_1.DynamoDBClient({}));
    const dlqTableName = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';
    const dlqStore = new dlq_store_js_1.DLQStore(dynamoClient, dlqTableName);
    durable.onDeadLetter(buildDeadLetterCallback({
        registry,
        dlqStore,
        additionalHandlers: onDeadLetter,
    }));
    const attribution = new producer_attribution_js_1.ProducerAttributionStore();
    const poisonDetector = new poison_detector_js_1.PoisonEventDetector();
    const metricsObserver = new metrics_observer_js_1.MetricsObserver({ registry, signal, durable, metrics, attribution, poisonDetector });
    // wave26-d — multi-replica registry coordination via Redis pub/sub.
    const coordinator = new registry_coordinator_js_1.RegistryCoordinator();
    coordinator.start(redisUrl, registry).catch(err => {
        console.warn('[server] registry coordinator start failed:', err.message);
    });
    await metricsObserver.start().catch(err => {
        console.warn('[server] metrics observer start failed:', err.message);
    });
    const promMetrics = new prom_metrics_js_1.PromMetrics();
    const serviceVersion = readServiceVersion();
    // Bridge: original DLQ deadLetter hook also bumps the prom gauge.
    durable.onDeadLetter((message) => {
        promMetrics.recordFailure(message.envelope.eventName, 'transport');
    });
    // Build Express app
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({ origin: corsOrigin }));
    app.use(express_1.default.json({ limit: '1mb' }));
    // Tri-state /health endpoint at root (service-runtime shape)
    app.get('/health', (0, health_js_1.makeHealthHandler)({
        service: 'event-catalog',
        version: serviceVersion,
        checks: [
            {
                id: 'redis',
                check: async () => {
                    const h = await signal.healthCheck();
                    if (h.status === 'connected') {
                        return { status: 'healthy', details: { latencyMs: h.latencyMs } };
                    }
                    if (h.status === 'degraded') {
                        return { status: 'degraded', details: { latencyMs: h.latencyMs } };
                    }
                    return { status: 'unhealthy', details: { latencyMs: h.latencyMs } };
                },
            },
            {
                id: 'message-queue',
                check: async () => {
                    const h = await durable.healthCheck();
                    if (h.status === 'connected') {
                        return { status: 'healthy', details: { latencyMs: h.latencyMs } };
                    }
                    if (h.status === 'degraded') {
                        return { status: 'degraded', details: { latencyMs: h.latencyMs } };
                    }
                    return { status: 'unhealthy', details: { latencyMs: h.latencyMs } };
                },
            },
            {
                id: 'registry',
                check: async () => ({ status: 'healthy', details: { eventCount: registry.size() } }),
            },
        ],
    }));
    // Prometheus-formatted /metrics endpoint at root
    app.get('/metrics', async (_req, res) => {
        try {
            // Refresh DLQ gauges by scanning the DLQ store. Best-effort —
            // if DDB is down we still want /metrics to respond.
            const dlqEntries = await dlqStore.list({ limit: 1000 }).catch(() => []);
            const counts = new Map();
            for (const entry of dlqEntries) {
                counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
            }
            for (const [event, count] of counts) {
                promMetrics.setDLQEntries(event, count);
            }
        }
        catch {
            // swallow; gauges may be stale but text rendering still works
        }
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(promMetrics.renderProm());
    });
    // wave23-a — persistent audit log. Capped Redis list keyed at
    // `event-catalog:audit-log` so audit events survive replicas
    // restarts and SSE clients get history-on-connect via ?replay=N.
    // Best-effort — Redis hiccups don't block live emits.
    const auditLog = (0, audit_log_js_1.startAuditLog)({ redis: redisClient });
    // wave23-b — consumer manifest store. Backs /api/manifests/* so
    // consumers can pin "I depend on these N events at these N
    // fingerprints" and the catalog can report drift.
    const manifestStore = new manifest_store_js_1.RedisManifestStore(redisClient);
    // Admin API
    const routes = (0, routes_js_1.createRoutes)({ registry, metrics, signal, durable, metricsObserver, dlqStore, startedAt, promMetrics, auditLog, manifestStore, attribution, poisonDetector, coordinator });
    // Phase 20-d — auth middleware injection (optional). Mounted before
    // the /api router so it gates every admin endpoint. The catalog
    // itself ships with no auth on purpose (local dev / in-cluster
    // private surface) but operators deploying outside that envelope
    // pass their JWT / API-key middleware here.
    if (authMiddleware) {
        app.use('/api', authMiddleware);
    }
    app.use('/api', routes);
    // FeatureBundle admin surface — CRD query endpoints for dc-k8s-operator.
    const bundleRegistry = new FeatureBundle_js_1.FeatureBundleRegistry();
    app.use('/api/feature-bundles', (0, bundle_routes_js_1.createBundleRoutes)({ bundleRegistry, registry }));
    // Static admin UI (production)
    app.use(express_1.default.static(new URL('../admin/dist', import.meta.url).pathname));
    // SPA fallback for admin UI routes
    app.get('*', (_req, res) => {
        res.sendFile('index.html', { root: new URL('../admin/dist', import.meta.url).pathname });
    });
    const metricsSnapshotInterval = setInterval(() => {
        metrics.snapshotToRedis(redisClient).catch(err => {
            console.warn('[server] metrics snapshot failed:', err.message);
        });
    }, 60_000);
    // wave24-b — subscriber heartbeat sweeper. Every 60s, prune
    // subscribers we haven't heard from in SUBSCRIBER_TTL_SECONDS
    // (default 1800 = 30 minutes). Configurable via env var; set to 0
    // to disable. Pruned removals fire audit events so the admin UI
    // sees consumers drop off /topology in real time.
    const subscriberTtlSeconds = parseInt(process.env.SUBSCRIBER_TTL_SECONDS ?? '1800', 10);
    const subscriberSweepInterval = subscriberTtlSeconds > 0
        ? setInterval(() => {
            try {
                const pruned = registry.pruneStaleSubscribers(subscriberTtlSeconds * 1000);
                for (const p of pruned) {
                    const entry = registry.get(p.eventName);
                    // Reuse the audit-emit shape from routes.ts.
                    // Lazy-import to avoid a top-level cycle.
                    void import('./audit-emitter.js').then(({ auditEmitter }) => {
                        auditEmitter.publish({
                            kind: 'subscriber.removed',
                            timestamp: new Date().toISOString(),
                            eventName: p.eventName,
                            namespace: entry?.namespace,
                            serviceName: p.serviceName,
                        });
                    });
                }
            }
            catch (err) {
                console.warn('[server] subscriber sweep failed:', err.message);
            }
        }, 60_000)
        : null;
    const alertManager = new alerting_js_1.AlertManager();
    // Periodic background health probe
    const healthInterval = setInterval(async () => {
        const [redisHealth, mqHealth] = await Promise.all([
            signal.healthCheck(),
            durable.healthCheck(),
        ]);
        if (redisHealth.status !== 'connected') {
            console.warn(`[event-catalog] redis health: ${redisHealth.status} (${redisHealth.latencyMs}ms)`);
        }
        if (mqHealth.status !== 'connected') {
            console.warn(`[event-catalog] message-queue health: ${mqHealth.status} (${mqHealth.latencyMs}ms)`);
        }
        const checks = [
            { component: 'redis', status: redisHealth.status, latencyMs: redisHealth.latencyMs },
            { component: 'message-queue', status: mqHealth.status, latencyMs: mqHealth.latencyMs },
        ];
        for (const { component, status } of checks) {
            const prev = alertManager.getPreviousState(component);
            if (prev && prev !== status) {
                if (status === 'connected' && prev !== 'connected') {
                    await alertManager.onRecovery(component);
                }
                else if (status !== 'connected') {
                    await alertManager.onHealthChange(component, prev, status);
                }
            }
            alertManager.setPreviousState(component, status);
        }
        const snapshot = metrics.snapshot();
        for (const [eventName, stats] of Object.entries(snapshot)) {
            await alertManager.onErrorThreshold(eventName, stats.errorCount);
        }
        // wave26-a — snapshot rate history for sparklines on each health tick.
        metrics.tickRateHistory();
    }, 15_000);
    // Start listening
    const server = app.listen(port, () => {
        console.log(`[event-catalog] server listening on :${port}`);
        console.log(`[event-catalog] redis: ${redisUrl}`);
        console.log(`[event-catalog] message-queue: ${messageQueueUrl}`);
        console.log(`[event-catalog] admin UI: http://localhost:${port}`);
    });
    const shutdown = async () => {
        console.log('[event-catalog] shutting down...');
        clearInterval(healthInterval);
        clearInterval(metricsSnapshotInterval);
        if (subscriberSweepInterval)
            clearInterval(subscriberSweepInterval);
        auditLog.stop();
        await metrics.snapshotToRedis(redisClient).catch(() => { });
        server.close();
        await metricsObserver.stop();
        await coordinator.stop();
        await signal.disconnect();
        await durable.disconnect();
        await redisClient.quit().catch(() => { });
        console.log('[event-catalog] shutdown complete');
    };
    return { app, shutdown };
}
//# sourceMappingURL=index.js.map