"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHUTDOWN_DRAIN_MS = exports.REQUEST_BODY_LIMITS = exports.BODY_READ_TIMEOUT_MS = exports.MAX_REQUEST_BODY_BYTES = void 0;
exports.resolveCorsOrigin = resolveCorsOrigin;
exports.redactUrl = redactUrl;
exports.buildDeadLetterCallback = buildDeadLetterCallback;
exports.buildBundleRegistry = buildBundleRegistry;
exports.startServer = startServer;
const server_1 = require("distributed-core/server");
const redis_1 = require("redis");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const config_js_1 = require("../cli/config.js");
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
const auth_js_1 = require("./auth.js");
const bundle_routes_js_1 = require("./bundle-routes.js");
const http_router_js_1 = require("./http-router.js");
const FeatureBundle_js_1 = require("../bundles/FeatureBundle.js");
const index_js_2 = require("../declarations/bundles/index.js");
const health_js_1 = require("./health.js");
const prom_metrics_js_1 = require("./prom-metrics.js");
const producer_attribution_js_1 = require("./producer-attribution.js");
const poison_detector_js_1 = require("./poison-detector.js");
const registry_coordinator_js_1 = require("./registry-coordinator.js");
const sse_js_1 = require("./sse.js");
const node_fs_1 = require("node:fs");
const redis_boot_strategy_js_1 = require("../utils/redis-boot-strategy.js");
const bounded_js_1 = require("../utils/bounded.js");
const logger_js_1 = require("../utils/logger.js");
const static_compression_js_1 = require("./static-compression.js");
/**
 * Hard cap on a request body, in bytes. Matches the `express.json({ limit:
 * '1mb' })` the server ran with before the AdmissionHttpServer move. Nothing
 * this API accepts is close to 1 MiB — the largest legitimate body is a bulk
 * declare — so the cap is purely an OOM guard.
 *
 * Exported so the test suite can drive a body of exactly this size + 1 and
 * assert the rejection, rather than trusting the config key spelling. It was
 * previously passed as `maxBodyBytes`, which is not a key of
 * `BodyLimitsConfig`; it was silently dropped and the server ran on
 * distributed-core's 16 MiB `DEFAULT_MAX_BODY_BYTES` instead.
 */
exports.MAX_REQUEST_BODY_BYTES = 1_048_576;
/**
 * Slow-loris cutoff for reading a request body. Pinned explicitly at the
 * value distributed-core currently defaults to, so an upstream change to
 * `DEFAULT_READ_TIMEOUT_MS` can't quietly move this server's threshold the
 * way the dropped body cap did.
 */
exports.BODY_READ_TIMEOUT_MS = 30_000;
/**
 * The exact `bodyLimits` object handed to AdmissionHttpServer. Annotated as
 * `BodyLimitsConfig` so a misspelled key is a compile error rather than a
 * silently ignored property, and exported so `tests/server-body-limits.test.ts`
 * can bind a server with THIS object and prove the cap is enforced.
 */
exports.REQUEST_BODY_LIMITS = {
    maxBytes: exports.MAX_REQUEST_BODY_BYTES,
    readTimeoutMs: exports.BODY_READ_TIMEOUT_MS,
};
/**
 * How long `shutdown()` waits for in-flight requests to finish before it
 * forcibly closes the remaining sockets. Override with
 * `EVENT_CATALOG_SHUTDOWN_DRAIN_MS`.
 *
 * `AdmissionHttpServer.stop()` is `http.Server.close()`, which resolves
 * only once EVERY connection has ended — including idle keep-alive
 * sockets and open SSE streams, which by construction never end on
 * their own. Awaiting it unconditionally is what made SIGTERM hang.
 */
exports.SHUTDOWN_DRAIN_MS = 10_000;
/**
 * Resolve the CORS policy for the admin API.
 *
 * The default is now "emit no CORS headers", not "reflect whatever
 * Origin the caller sent". Reflection is what turns this API's complete
 * lack of authentication (see `authMiddleware` below) from "reachable by
 * anything on the network" into "reachable by any web page the operator
 * happens to have open": the browser sends the cross-site POST, the
 * reflected `Access-Control-Allow-Origin` makes the preflight succeed,
 * and a schema the whole platform validates against has been rewritten.
 *
 * Nothing in this repo needs the headers — the admin UI is served from
 * this same origin in production (`serveStatic`) and proxied through
 * Vite's dev server at :3011 in development — and non-browser callers
 * (CI, `syncToRemoteRegistry`, curl) are unaffected by CORS entirely.
 *
 * Operators who really do serve a browser client from another origin set
 * `EVENT_CATALOG_CORS_ORIGIN` to that origin (or to `*` to restore the
 * old reflect-everything behavior).
 */
function resolveCorsOrigin(raw) {
    if (raw === undefined)
        return false;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === 'false')
        return false;
    if (trimmed === '*' || trimmed === 'true')
        return true;
    return trimmed;
}
/**
 * Strip credentials from a connection URL before it is logged.
 * `redis://default:hunter2@cache:6379` is the documented node-redis
 * form, and this server printed it verbatim at boot — into container
 * logs, into whatever ships them, forever.
 */
function redactUrl(raw) {
    try {
        const url = new URL(raw);
        if (url.username || url.password) {
            url.username = url.username ? '***' : '';
            url.password = url.password ? '***' : '';
            return url.toString();
        }
        return raw;
    }
    catch {
        // Not a parseable URL — it may still be a DSN with a secret in it,
        // so say nothing about its contents.
        return '<unparseable url>';
    }
}
// This module compiles to CommonJS (package.json declares no "type", and
// tsconfig targets module: node16), so `import.meta` is unavailable — every
// path below is resolved from `__dirname` instead. Under Vitest the module
// is transformed by vite-node, which injects `__dirname` as well, so the
// same expression works in tests.
function readServiceVersion() {
    try {
        const pkgPath = (0, node_path_1.join)(__dirname, '../../package.json');
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
    const log = new logger_js_1.LogWriter(deps.logger);
    // Dead-lettering is driven by the failure rate of the durable
    // transport, not by anything this process controls: a queue whose
    // consumer is broken dead-letters every message it holds, so both
    // lines below fire once per message. Keyed by event name so one bad
    // event does not hide another.
    const storeWarnings = new bounded_js_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5, maxKeys: 128 });
    const handlerWarnings = new bounded_js_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5, maxKeys: 128 });
    return (message) => {
        const entry = deps.registry.get(message.envelope.eventName);
        deps.dlqStore.put({
            eventName: message.envelope.eventName,
            payload: message.envelope.payload,
            error: message.error,
            attempts: message.attempts,
            deadAt: message.deadLetteredAt,
        }, entry?.dlqRetention).catch((err) => {
            const suppressed = storeWarnings.attempt(message.envelope.eventName);
            if (suppressed !== null) {
                log.error('[server] DLQ store write failed' + bounded_js_1.LogThrottle.suffix(suppressed) + ':', {
                    component: 'server',
                    action: 'dlq-store-write',
                    eventName: message.envelope.eventName,
                    error: err.message,
                    suppressed,
                }, err.message);
            }
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
                const suppressed = handlerWarnings.attempt(message.envelope.eventName);
                if (suppressed !== null) {
                    log.warn(`[server] DLQ handler threw on "${message.envelope.eventName}"`
                        + bounded_js_1.LogThrottle.suffix(suppressed) + ':', {
                        component: 'server',
                        action: 'dlq-handler',
                        eventName: message.envelope.eventName,
                        error: err.message,
                        suppressed,
                    }, err.message);
                }
            });
        }
    };
}
/**
 * Populate a FeatureBundleRegistry from the declared bundles.
 *
 * Exported so the e2e harness exercises THIS function rather than a faithful
 * copy of it — the registry was previously built inline and left empty, and a
 * duplicated loop in the test server would let that regression recur unseen.
 */
function buildBundleRegistry() {
    const bundleRegistry = new FeatureBundle_js_1.FeatureBundleRegistry();
    for (const bundle of index_js_2.allBundles) {
        try {
            bundleRegistry.register(bundle);
        }
        catch (err) {
            // A duplicate name+version with a different event set is a source bug,
            // not a runtime condition; surface it without killing boot.
            console.warn(`[server] feature bundle "${bundle.name}@${bundle.version}" not registered:`, err instanceof Error ? err.message : String(err));
        }
    }
    return bundleRegistry;
}
async function startServer(config = {}) {
    // Resolve the environment through the same validated path the CLI uses, so
    // a malformed $PORT fails loudly here instead of binding NaN, and the
    // documented $EVENT_CATALOG_PORT is actually honored. Caller overrides are
    // passed as flags so an explicit argument satisfies a requirement the
    // environment does not.
    const resolved = (0, config_js_1.resolveServerConfig)(process.env, {
        port: config.port !== undefined ? String(config.port) : undefined,
        'redis-url': config.redisUrl,
        'message-queue-url': config.messageQueueUrl,
    });
    if (!resolved.ok) {
        throw new Error(`event-catalog: invalid configuration\n  - ${resolved.errors.join('\n  - ')}`);
    }
    const { port = resolved.config.port, redisUrl = resolved.config.redisUrl, messageQueueUrl = resolved.config.messageQueueUrl, corsOrigin = resolveCorsOrigin(process.env.EVENT_CATALOG_CORS_ORIGIN), onDeadLetter = [], shutdownDrainMs, compression = resolved.config.compression, logger, } = config;
    // One writer for this server's own lines; every sub-component below is
    // handed `logger` and builds its own so it can carry its own throttles.
    const log = new logger_js_1.LogWriter(logger);
    // Point the process-wide SSE registry at the same sink. It is a module
    // singleton constructed at import time, long before this config exists.
    sse_js_1.sseRegistry.useLogger(logger);
    /**
     * Periodic background lines: the health probe (every 15s), the metrics
     * snapshot and the subscriber sweep (every 60s). None of these is
     * request-driven, but all of them repeat forever while a dependency is
     * down — a Redis outage over a weekend is ~17k identical health lines.
     * Keyed by the condition so redis and message-queue are independently
     * visible.
     */
    const periodicWarnings = new bounded_js_1.LogThrottle({ keyIntervalMs: 300_000, maxPerWindow: 6, maxKeys: 32 });
    const periodicWarn = (key, message, fields, ...tail) => {
        const suppressed = periodicWarnings.attempt(key);
        if (suppressed === null)
            return;
        const suffix = bounded_js_1.LogThrottle.suffix(suppressed);
        const text = message.endsWith(':') ? message.slice(0, -1) + suffix + ':' : message + suffix;
        log.warn(text, { component: 'server', ...fields, suppressed }, ...tail);
    };
    // Auth is opt-in and off unless configured. With no explicit middleware
    // and no $EVENT_CATALOG_AUTH_TOKEN this is `undefined`, the `if
    // (authMiddleware)` gate below is never entered, and the request path is
    // exactly what it was before src/server/auth.ts existed.
    const authMiddleware = (0, auth_js_1.resolveAuthMiddleware)(config.authMiddleware, resolved.config.authToken, config.logger);
    const drainMs = shutdownDrainMs
        ?? (Number(process.env.EVENT_CATALOG_SHUTDOWN_DRAIN_MS) || exports.SHUTDOWN_DRAIN_MS);
    // Boot-bounded reconnect: without this, a down Redis makes connect() retry
    // forever, the catch below never fires, and boot never reaches app.listen().
    const registryBootStrategy = (0, redis_boot_strategy_js_1.createBootBoundedReconnectStrategy)({ label: 'registry' });
    const redisClient = (0, redis_1.createClient)({
        url: redisUrl,
        socket: { reconnectStrategy: registryBootStrategy.reconnectStrategy },
    });
    redisClient.on('error', (err) => {
        // Fires once per failed reconnect attempt for the life of an outage.
        periodicWarn('registry-redis-error', '[server] registry Redis error:', { action: 'registry-redis', error: (0, redis_boot_strategy_js_1.formatRedisError)(err) }, (0, redis_boot_strategy_js_1.formatRedisError)(err));
    });
    await redisClient.connect()
        .then(() => registryBootStrategy.markConnected())
        .catch(err => {
        log.warn('[server] registry Redis connection failed:', {
            component: 'server',
            action: 'registry-redis-connect',
            status: 'degraded',
            error: (0, redis_boot_strategy_js_1.formatRedisError)(err),
        }, (0, redis_boot_strategy_js_1.formatRedisError)(err), '— continuing in degraded mode (in-memory registry, no cross-replica sync)');
    });
    const registry = new index_js_1.Registry(redisClient);
    // Hydration is best-effort: with Redis down the client is closed and
    // hGetAll throws ClientClosedError. Serve an empty in-memory registry
    // instead of failing boot — producers re-declare on their next sync.
    await registry.load().catch(err => {
        log.warn('[server] registry hydration failed:', {
            component: 'server',
            action: 'registry-hydrate',
            status: 'degraded',
            error: (0, redis_boot_strategy_js_1.formatRedisError)(err),
        }, (0, redis_boot_strategy_js_1.formatRedisError)(err), '— starting with an empty in-memory registry');
    });
    const metrics = new metrics_js_1.MetricsCollector(60, undefined, logger);
    await metrics.restoreFromRedis(redisClient).catch(err => {
        log.warn('[server] metrics restore failed:', { component: 'server', action: 'metrics-restore', error: (0, redis_boot_strategy_js_1.formatRedisError)(err) }, (0, redis_boot_strategy_js_1.formatRedisError)(err));
    });
    // The transports take the same sink, so the publish-path lines from
    // src/client land alongside the service's own.
    const signal = new signal_js_1.SignalTransport({ url: redisUrl, logger });
    const durable = new durable_js_1.DurableTransport({ url: messageQueueUrl, logger });
    const startedAt = Date.now();
    // Connect transports
    await signal.connect().catch(err => {
        log.warn('[server] Redis connection failed:', { component: 'server', action: 'signal-connect', error: (0, logger_js_1.errorMessage)(err) }, err.message);
    });
    await durable.connect().catch(err => {
        log.warn('[server] message-queue connection failed:', { component: 'server', action: 'message-queue-connect', error: (0, logger_js_1.errorMessage)(err) }, err.message);
    });
    await (0, dynamo_setup_js_1.ensureTable)(logger).catch(err => {
        log.warn('[server] DLQ table auto-provision failed:', { component: 'server', action: 'dlq-table-provision', error: (0, logger_js_1.errorMessage)(err) }, err.message);
    });
    const dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(new client_dynamodb_1.DynamoDBClient({}));
    const dlqTableName = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';
    const dlqStore = new dlq_store_js_1.DLQStore(dynamoClient, dlqTableName);
    durable.onDeadLetter(buildDeadLetterCallback({
        registry,
        dlqStore,
        additionalHandlers: onDeadLetter,
        logger,
    }));
    const attribution = new producer_attribution_js_1.ProducerAttributionStore();
    const poisonDetector = new poison_detector_js_1.PoisonEventDetector();
    const metricsObserver = new metrics_observer_js_1.MetricsObserver({ registry, signal, durable, metrics, attribution, poisonDetector, logger });
    // wave26-d — multi-replica registry coordination via Redis pub/sub.
    const coordinator = new registry_coordinator_js_1.RegistryCoordinator(logger);
    coordinator.start(redisUrl, registry).catch(err => {
        log.warn('[server] registry coordinator start failed:', { component: 'server', action: 'coordinator-start', error: (0, logger_js_1.errorMessage)(err) }, err.message);
    });
    await metricsObserver.start().catch(err => {
        log.warn('[server] metrics observer start failed:', { component: 'server', action: 'metrics-observer-start', error: (0, logger_js_1.errorMessage)(err) }, err.message);
    });
    const promMetrics = new prom_metrics_js_1.PromMetrics(undefined, { logger });
    const serviceVersion = readServiceVersion();
    // Pull-style gauges, sampled at scrape time rather than pushed on a timer —
    // registry size, poisoned events and SSE saturation are all cheap reads whose
    // value is "what is true right now", and a timer would only add staleness.
    // recordSseRejected had no caller, so stream saturation was invisible.
    sse_js_1.sseRegistry.useRejectionHook(() => promMetrics.recordSseRejected());
    promMetrics.collect(() => {
        promMetrics.setRegistrySize(registry.size());
        promMetrics.setPoisonedEvents(poisonDetector.listPoisoned().length);
        promMetrics.setSseStreams(sse_js_1.sseRegistry.size, sse_js_1.sseRegistry.getLimits().maxStreams);
    });
    // Bridge: original DLQ deadLetter hook also bumps the prom gauge.
    durable.onDeadLetter((message) => {
        promMetrics.recordFailure(message.envelope.eventName, 'transport');
    });
    // Root-level routes (health + prom metrics), served alongside /api.
    const rootRouter = (0, http_router_js_1.Router)();
    // Tri-state /health endpoint at root (service-runtime shape)
    rootRouter.get('/health', (0, health_js_1.makeHealthHandler)({
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
            {
                // A replica that missed broadcasts serves a truncated registry while
                // every other check reports healthy — the failure mode that makes a
                // multi-replica deployment quietly disagree with itself. Surface it
                // as degraded (not unhealthy) so a stale replica is drained rather
                // than restart-looped while it resyncs.
                id: 'coordinator',
                check: async () => ({
                    status: coordinator.isStale() ? 'degraded' : 'healthy',
                    details: coordinator.getStats(),
                }),
            },
        ],
    }));
    // Prometheus-formatted /metrics endpoint at root
    rootRouter.get('/metrics', async (_req, res) => {
        try {
            // Refresh DLQ gauges by scanning the DLQ store. Best-effort —
            // if DDB is down we still want /metrics to respond.
            // No `.catch(() => [])` here: an empty list from a DynamoDB outage would
            // publish "DLQ is empty" during exactly the incident where its depth
            // matters. Let it throw to the catch below, which leaves the last known
            // gauges in place instead.
            const dlqEntries = await dlqStore.list({ limit: 1000 });
            const counts = new Map();
            for (const entry of dlqEntries) {
                counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
            }
            // syncDLQEntries, not a setDLQEntries loop: a drained queue has no entry
            // to iterate, so per-event sets left stale non-zero depths forever.
            promMetrics.syncDLQEntries(counts);
        }
        catch {
            // swallow; gauges may be stale but text rendering still works
        }
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
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
    const routes = (0, routes_js_1.createRoutes)({ registry, metrics, signal, durable, metricsObserver, dlqStore, startedAt, promMetrics, auditLog, manifestStore, attribution, poisonDetector, coordinator, logger });
    // FeatureBundle admin surface — CRD query endpoints for dc-k8s-operator.
    //
    // The registry was constructed empty and never populated, so every
    // /api/feature-bundles response was `{bundles: [], total: 0}` in
    // production while 18 bundles sat declared in the source. ec-lint-crd
    // reads them from the package rather than the server, which is why
    // nothing failed loudly — the HTTP surface was simply blank.
    const bundleRegistry = buildBundleRegistry();
    const bundleRoutes = (0, bundle_routes_js_1.createBundleRoutes)({ bundleRegistry, registry, logger });
    // Longest prefix first so /api/feature-bundles/* reaches its router
    // before the general /api router gets a shot.
    const apiMounts = [
        ['/api/feature-bundles', bundleRoutes],
        ['/api', routes],
    ];
    // Static admin UI (production build) via distributed-core's serveStatic;
    // unmatched GETs fall through to the SPA's index.html.
    //
    // `serveStatic` writes straight to the socket, so it never reached the
    // gzip/brotli negotiation `makeRouteResponse` applies to the API — the
    // admin bundle shipped raw while a 2 KiB JSON body got compressed.
    // `withStaticCompression` hands it a recording response instead of the
    // real one and runs the finished buffer through the same
    // `compression.ts` policy; see that module for why the upstream handler
    // is wrapped rather than replaced. 629 KiB → 196 KiB on this build.
    const adminDistDir = (0, node_path_1.join)(__dirname, '../admin/dist');
    const staticHandler = (0, static_compression_js_1.withStaticCompression)((0, server_1.serveStatic)({ staticDir: adminDistDir }), { compression });
    const spaIndexPath = (0, node_path_1.join)(adminDistDir, 'index.html');
    /** Headers the SPA fallback sends — matches serveStatic's HTML policy. */
    const spaIndexHeaders = new Map([
        ['content-type', 'text/html'],
        ['cache-control', 'no-cache'],
    ]);
    /**
     * The single request entrypoint handed to AdmissionHttpServer.
     * Request order mirrors the old Express middleware stack:
     * CORS → auth (on /api) → API routers → root routes → static → SPA.
     */
    const onRequest = async (areq, ares) => {
        const nodeReq = areq.raw;
        const nodeRes = ares.nodeRes;
        // CORS (previously the `cors` package). corsOrigin: true reflects
        // the request origin; a string pins it; false disables.
        if (corsOrigin !== false) {
            const requestOrigin = Array.isArray(nodeReq.headers.origin)
                ? nodeReq.headers.origin[0]
                : nodeReq.headers.origin;
            const allowOrigin = typeof corsOrigin === 'string' ? corsOrigin : (requestOrigin ?? '*');
            nodeRes.setHeader('Access-Control-Allow-Origin', allowOrigin);
            if (allowOrigin !== '*')
                nodeRes.setHeader('Vary', 'Origin');
            nodeRes.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            nodeRes.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Event-Catalog-Strict');
        }
        if (areq.method === 'OPTIONS') {
            ares.raw(204, '');
            return;
        }
        // JSON body parse (AdmissionHttpServer already buffered + capped it).
        let body;
        const contentType = areq.headers['content-type'] ?? '';
        if (areq.body.length > 0 && contentType.includes('application/json')) {
            try {
                body = JSON.parse(areq.body);
            }
            catch {
                ares.json(400, { error: 'InvalidJson' });
                return;
            }
        }
        const req = (0, http_router_js_1.makeRouteRequest)(nodeReq, body);
        // Content coding is negotiated per request from its Accept-Encoding —
        // never assumed. `compressionFor` returns undefined when the policy is
        // off, and the response path is then byte-for-byte what it was before.
        // Note the SSE routes (/api/flow, /api/audit) opt out structurally:
        // they reach the socket through flushHeaders()/write(), which
        // makeRouteResponse never compresses.
        const res = (0, http_router_js_1.makeRouteResponse)(nodeRes, (0, http_router_js_1.compressionFor)(nodeReq, compression));
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            // Auth gate (optional). Runs before the /api routers, so gating is
            // decided in ONE place for all ~45 admin endpoints rather than per
            // route. Two ways to get one: set $EVENT_CATALOG_AUTH_TOKEN for the
            // built-in shared-secret bearer scheme (src/server/auth.ts — gates
            // non-GET requests only, so the admin UI and the SSE streams are
            // untouched), or pass your own JWT / API-key middleware as
            // `authMiddleware`. Neither is on by default: the catalog ships
            // unauthenticated on purpose (local dev / in-cluster private
            // surface) and an upgrade must not start rejecting the producers
            // that sync declarations at boot.
            if (authMiddleware) {
                const admitted = await runMiddleware(authMiddleware, req, res);
                if (!admitted) {
                    if (!res.headersSent)
                        res.status(401).json({ error: 'Unauthorized' });
                    return;
                }
            }
            const handled = await (0, http_router_js_1.dispatchMounts)(req, res, apiMounts);
            if (!handled && !res.headersSent) {
                res.status(404).json({ error: 'NotFound', path: req.path });
            }
            return;
        }
        if (await rootRouter.handle(req, res, req.path))
            return;
        if (req.method === 'GET' || req.method === 'HEAD') {
            if (staticHandler(nodeReq, nodeRes))
                return;
            // SPA fallback for admin UI routes. Goes through sendStaticBuffer
            // rather than `ares.raw` so this last static path negotiates its
            // coding like every other one (index.html is 481 bytes today, so
            // it lands under the threshold and is sent identity — but it still
            // needs the `Vary: Accept-Encoding` that keeps caches honest).
            try {
                const html = await (0, promises_1.readFile)(spaIndexPath);
                (0, static_compression_js_1.sendStaticBuffer)(nodeReq, nodeRes, 200, html, spaIndexHeaders, compression);
            }
            catch {
                ares.json(404, { error: 'NotFound', detail: 'admin UI not built (src/admin: npm run build)' });
            }
            return;
        }
        ares.json(404, { error: 'NotFound', path: req.path });
    };
    const metricsSnapshotInterval = setInterval(() => {
        metrics.snapshotToRedis(redisClient).catch(err => {
            periodicWarn('metrics-snapshot', '[server] metrics snapshot failed:', { action: 'metrics-snapshot', error: (0, logger_js_1.errorMessage)(err) }, err.message);
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
                periodicWarn('subscriber-sweep', '[server] subscriber sweep failed:', { action: 'subscriber-sweep', error: (0, logger_js_1.errorMessage)(err) }, err.message);
            }
        }, 60_000)
        : null;
    const alertManager = new alerting_js_1.AlertManager({ logger });
    // Periodic background health probe
    const healthInterval = setInterval(async () => {
        const [redisHealth, mqHealth] = await Promise.all([
            signal.healthCheck(),
            durable.healthCheck(),
        ]);
        if (redisHealth.status !== 'connected') {
            periodicWarn(`health:redis:${redisHealth.status}`, `[event-catalog] redis health: ${redisHealth.status} (${redisHealth.latencyMs}ms)`, { action: 'health-probe', transport: 'redis', status: redisHealth.status, latencyMs: redisHealth.latencyMs });
        }
        if (mqHealth.status !== 'connected') {
            periodicWarn(`health:message-queue:${mqHealth.status}`, `[event-catalog] message-queue health: ${mqHealth.status} (${mqHealth.latencyMs}ms)`, { action: 'health-probe', transport: 'message-queue', status: mqHealth.status, latencyMs: mqHealth.latencyMs });
        }
        const checks = [
            { component: 'redis', status: redisHealth.status, latencyMs: redisHealth.latencyMs },
            { component: 'message-queue', status: mqHealth.status, latencyMs: mqHealth.latencyMs },
        ];
        for (const { component, status, latencyMs } of checks) {
            // observeHealth owns previous-state, N-sample debounce, and which alert
            // to send. The hand-rolled compare-and-set this replaces paged on a
            // single probe blip and could swallow a second failure that arrived
            // inside the recovery cooldown.
            await alertManager.observeHealth(component, status);
            promMetrics.setTransportUp(component, status === 'connected');
            if (typeof latencyMs === 'number') {
                // The probe reports milliseconds; the metric name says seconds.
                promMetrics.setTransportProbeLatencySeconds(component, latencyMs / 1000);
            }
        }
        const snapshot = metrics.snapshot();
        for (const [eventName, stats] of Object.entries(snapshot)) {
            await alertManager.onErrorThreshold(eventName, stats.errorCount);
        }
        // wave26-a — snapshot rate history for sparklines on each health tick.
        metrics.tickRateHistory();
    }, 15_000);
    // Start listening — distributed-core's AdmissionHttpServer is the HTTP
    // transport: bounded body reads (MAX_REQUEST_BODY_BYTES, matching the old
    // express.json limit), slow-loris read timeouts, and in-flight admission
    // control. Both limit keys are spelled out against BodyLimitsConfig; an
    // unknown key here is a silent no-op at runtime, so the typecheck over
    // src/server (npm run lint:all) is what keeps this honest.
    const requestErrors = new bounded_js_1.LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 10, maxKeys: 64 });
    const admission = new server_1.AdmissionHttpServer({
        port,
        // Bind all interfaces (AdmissionHttpServer defaults to 127.0.0.1,
        // which would break the Docker deployment).
        hostname: process.env.HOST ?? '0.0.0.0',
        bodyLimits: exports.REQUEST_BODY_LIMITS,
        onRequest,
        onError: err => {
            // Transport-level, so one line per failing request: a client that
            // resets connections mid-body drives this as fast as it can open
            // sockets. Keyed by the error text so distinct causes stay visible.
            const suppressed = requestErrors.attempt(err.message);
            if (suppressed === null)
                return;
            log.warn('[server] unhandled request error' + bounded_js_1.LogThrottle.suffix(suppressed) + ':', {
                component: 'server',
                action: 'unhandled-request-error',
                error: err.message,
                suppressed,
            }, err.message);
        },
    });
    await admission.start();
    log.info(`[event-catalog] server listening on :${port}`, {
        component: 'server', action: 'listening', port, version: serviceVersion,
    });
    // Redacted — these URLs carry credentials in every deployment that
    // uses an authenticated Redis.
    log.info(`[event-catalog] redis: ${redactUrl(redisUrl)}`, {
        component: 'server', action: 'config', redisUrl: redactUrl(redisUrl),
    });
    log.info(`[event-catalog] message-queue: ${redactUrl(messageQueueUrl)}`, {
        component: 'server', action: 'config', messageQueueUrl: redactUrl(messageQueueUrl),
    });
    log.info(`[event-catalog] admin UI: http://localhost:${port}`, {
        component: 'server', action: 'config', adminUrl: `http://localhost:${port}`,
    });
    const shutdown = async () => {
        log.info('[event-catalog] shutting down...', {
            component: 'server', action: 'shutdown', phase: 'begin',
        });
        clearInterval(healthInterval);
        clearInterval(metricsSnapshotInterval);
        if (subscriberSweepInterval)
            clearInterval(subscriberSweepInterval);
        auditLog.stop();
        // End every SSE stream first. `admission.stop()` below is
        // `http.Server.close()`, which resolves only once every connection
        // has ended — an open /api/flow or /api/audit stream never ends on
        // its own, so awaiting the close with one attached used to hang the
        // whole shutdown (verified: stop() had not resolved 1.5s after a
        // single SSE client connected, and resolved immediately once the
        // connection was closed). Redis was therefore never disconnected
        // and the process died to the orchestrator's SIGKILL.
        const closedStreams = sse_js_1.sseRegistry.closeAll();
        if (closedStreams > 0) {
            log.info(`[event-catalog] closed ${closedStreams} open event stream(s)`, {
                component: 'server', action: 'shutdown', phase: 'sse-closed', closedStreams,
            });
        }
        await metrics.snapshotToRedis(redisClient).catch(() => { });
        // Drain: stop accepting, release idle keep-alive sockets right away,
        // and give anything still in flight a bounded window to finish
        // before the remaining sockets are closed out from under it.
        const stopped = admission.stop().catch(() => { });
        admission.nodeServer.closeIdleConnections?.();
        const drainTimer = new Promise(resolve => {
            const t = setTimeout(() => resolve('timeout'), drainMs);
            t.unref?.();
        });
        if (await Promise.race([stopped.then(() => 'closed'), drainTimer]) === 'timeout') {
            log.warn(`[event-catalog] requests still in flight after ${drainMs}ms — closing connections`, { component: 'server', action: 'shutdown', phase: 'drain-timeout', drainMs });
            admission.nodeServer.closeAllConnections?.();
            await stopped;
        }
        await metricsObserver.stop();
        await coordinator.stop();
        await signal.disconnect();
        await durable.disconnect();
        await redisClient.quit().catch(() => { });
        log.info('[event-catalog] shutdown complete', {
            component: 'server', action: 'shutdown', phase: 'complete',
        });
    };
    return { address: () => admission.address(), shutdown };
}
/**
 * Run a connect-style middleware and resolve whether the request may
 * continue: true iff the middleware called `next()` with no error.
 * Also resolves false if the middleware responded and closed the
 * response without calling next (the reject-by-responding pattern).
 */
function runMiddleware(middleware, req, res) {
    return new Promise(resolve => {
        let settled = false;
        const settle = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        res.raw.on('finish', () => settle(false));
        res.raw.on('close', () => settle(false));
        try {
            middleware(req, res, (err) => settle(err === undefined || err === null));
        }
        catch {
            settle(false);
        }
    });
}
//# sourceMappingURL=index.js.map