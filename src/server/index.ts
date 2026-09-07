import {
  AdmissionHttpServer,
  serveStatic,
  type AdmissionRequest,
  type AdmissionResponse,
  type BodyLimitsConfig,
} from 'distributed-core/server';
import { createClient, type RedisClientType } from 'redis';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { resolveServerConfig } from '../cli/config.js';
import { Registry } from '../registry/index.js';
import { SignalTransport } from '../client/signal.js';
import { DurableTransport, type DeadLetteredMessage } from '../client/durable.js';
import { MetricsCollector } from './metrics.js';
import { MetricsObserver } from './metrics-observer.js';
import { AlertManager } from './alerting.js';
import { DLQStore } from './dlq-store.js';
import { ensureTable } from './dynamo-setup.js';
import { startAuditLog } from './audit-log.js';
import { RedisManifestStore } from './manifest-store.js';
import { createRoutes } from './routes.js';
import { resolveAuthMiddleware } from './auth.js';
import { createBundleRoutes } from './bundle-routes.js';
import {
  Router,
  compressionFor,
  dispatchMounts,
  makeRouteRequest,
  makeRouteResponse,
  type Middleware,
  type Mount,
  type RouteRequest,
  type RouteResponse,
} from './http-router.js';
import type { CompressionConfig } from './compression.js';
import { FeatureBundleRegistry } from '../bundles/FeatureBundle.js';
import { allBundles } from '../declarations/bundles/index.js';
import { makeHealthHandler } from './health.js';
import { PromMetrics, type TransportName } from './prom-metrics.js';
import { ProducerAttributionStore } from './producer-attribution.js';
import { PoisonEventDetector } from './poison-detector.js';
import { RegistryCoordinator } from './registry-coordinator.js';
import { sseRegistry } from './sse.js';
import { readFileSync } from 'node:fs';
import {
  createBootBoundedReconnectStrategy,
  formatRedisError,
} from '../utils/redis-boot-strategy.js';
import type { RegistryEntry } from '../types/index.js';
import { LogThrottle } from '../utils/bounded.js';
import { LogWriter, type CatalogLogger, errorMessage } from '../utils/logger.js';
import { sendStaticBuffer, withStaticCompression } from './static-compression.js';

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
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

/**
 * Slow-loris cutoff for reading a request body. Pinned explicitly at the
 * value distributed-core currently defaults to, so an upstream change to
 * `DEFAULT_READ_TIMEOUT_MS` can't quietly move this server's threshold the
 * way the dropped body cap did.
 */
export const BODY_READ_TIMEOUT_MS = 30_000;

/**
 * The exact `bodyLimits` object handed to AdmissionHttpServer. Annotated as
 * `BodyLimitsConfig` so a misspelled key is a compile error rather than a
 * silently ignored property, and exported so `tests/server-body-limits.test.ts`
 * can bind a server with THIS object and prove the cap is enforced.
 */
export const REQUEST_BODY_LIMITS: BodyLimitsConfig = {
  maxBytes: MAX_REQUEST_BODY_BYTES,
  readTimeoutMs: BODY_READ_TIMEOUT_MS,
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
export const SHUTDOWN_DRAIN_MS = 10_000;

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
export function resolveCorsOrigin(raw: string | undefined): string | boolean {
  if (raw === undefined) return false;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'false') return false;
  if (trimmed === '*' || trimmed === 'true') return true;
  return trimmed;
}

/**
 * Strip credentials from a connection URL before it is logged.
 * `redis://default:hunter2@cache:6379` is the documented node-redis
 * form, and this server printed it verbatim at boot — into container
 * logs, into whatever ships them, forever.
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = url.username ? '***' : '';
      url.password = url.password ? '***' : '';
      return url.toString();
    }
    return raw;
  } catch {
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
function readServiceVersion(): string {
  try {
    const pkgPath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Phase 20-d — DLQ handler context. Built once per dead-letter event by
 * looking the envelope's eventName up in the local Registry, so operator
 * handlers get the canonical RegistryEntry + namespace without a second
 * lookup. Both fields are optional because dead-letters can fire on
 * undeclared events (consumer drift).
 */
export interface DeadLetterContext {
  entry?: RegistryEntry;
  namespace?: string;
}

/** Phase 20-d — server-side DLQ handler. */
export type DeadLetterHandler =
  (message: DeadLetteredMessage, context: DeadLetterContext) => void | Promise<void>;

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
export function buildDeadLetterCallback(deps: {
  registry: { get(name: string): RegistryEntry | undefined };
  dlqStore: { put(entry: { eventName: string; payload: unknown; error: string; attempts: number; deadAt: string }, retentionSeconds?: number): Promise<unknown> };
  additionalHandlers: DeadLetterHandler[];
  /** Diagnostics sink. Omitted ⇒ console, byte-for-byte as before. */
  logger?: CatalogLogger;
}): (message: DeadLetteredMessage) => void {
  const log = new LogWriter(deps.logger);
  // Dead-lettering is driven by the failure rate of the durable
  // transport, not by anything this process controls: a queue whose
  // consumer is broken dead-letters every message it holds, so both
  // lines below fire once per message. Keyed by event name so one bad
  // event does not hide another.
  const storeWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5, maxKeys: 128 });
  const handlerWarnings = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 5, maxKeys: 128 });
  return (message) => {
    const entry = deps.registry.get(message.envelope.eventName);
    deps.dlqStore.put({
      eventName: message.envelope.eventName,
      payload: message.envelope.payload,
      error: message.error,
      attempts: message.attempts,
      deadAt: message.deadLetteredAt,
    }, entry?.dlqRetention).catch((err: Error) => {
      const suppressed = storeWarnings.attempt(message.envelope.eventName);
      if (suppressed !== null) {
        log.error(
          '[server] DLQ store write failed' + LogThrottle.suffix(suppressed) + ':',
          {
            component: 'server',
            action: 'dlq-store-write',
            eventName: message.envelope.eventName,
            error: err.message,
            suppressed,
          },
          err.message,
        );
      }
    });

    if (deps.additionalHandlers.length === 0) return;
    const context: DeadLetterContext = { entry, namespace: entry?.namespace };
    for (const handler of deps.additionalHandlers) {
      // Wrap with new Promise() so a SYNCHRONOUS throw inside the
      // handler is caught alongside async rejections.
      new Promise<void>((resolve) => {
        resolve(handler(message, context));
      }).catch((err: Error) => {
        const suppressed = handlerWarnings.attempt(message.envelope.eventName);
        if (suppressed !== null) {
          log.warn(
            `[server] DLQ handler threw on "${message.envelope.eventName}"`
            + LogThrottle.suffix(suppressed) + ':',
            {
              component: 'server',
              action: 'dlq-handler',
              eventName: message.envelope.eventName,
              error: err.message,
              suppressed,
            },
            err.message,
          );
        }
      });
    }
  };
}

export interface ServerConfig {
  port?: number;
  redisUrl?: string;
  messageQueueUrl?: string;
  /**
   * CORS policy for the admin API. `false` (the default — see
   * {@link resolveCorsOrigin}) emits no CORS headers at all; a string
   * pins `Access-Control-Allow-Origin` to that origin; `true` restores
   * the historical behavior of reflecting the caller's Origin.
   */
  corsOrigin?: string | boolean;
  /**
   * Phase 20-d — additional DLQ handlers run alongside the built-in
   * "write to DDB" handler. Each receives the failing message plus a
   * context with the canonical registry entry and namespace. Errors
   * thrown by these handlers are caught + logged so a webhook hiccup
   * can't fail the primary DLQ write.
   */
  onDeadLetter?: DeadLetterHandler[];
  /**
   * Phase 20-d — optional connect-style middleware gating every `/api`
   * route. The admin server is unauthenticated by default
   * (deliberately, for local dev); operators can inject a JWT / API-key
   * check here without forking startServer. Call `next()` to admit the
   * request; respond on `res` without calling next to reject it.
   *
   * Leave it unset and set `EVENT_CATALOG_AUTH_TOKEN` instead to get the
   * built-in shared-secret bearer scheme (`src/server/auth.ts`). An
   * explicit middleware here always wins over the environment variable.
   */
  authMiddleware?: Middleware;
  /**
   * How long `shutdown()` waits for in-flight requests before closing
   * the remaining sockets. Defaults to
   * `EVENT_CATALOG_SHUTDOWN_DRAIN_MS`, else {@link SHUTDOWN_DRAIN_MS}.
   */
  shutdownDrainMs?: number;
  /**
   * Response-compression policy. Defaults to whatever
   * `resolveServerConfig` derived from `$EVENT_CATALOG_COMPRESSION*`
   * (on, gzip/br/deflate, 1 KiB floor). Pass `{ ...DEFAULT_COMPRESSION,
   * enabled: false }` to force it off for one embedded server without
   * touching the environment.
   */
  compression?: CompressionConfig;
  /**
   * Where this server's own diagnostics go.
   *
   * The same {@link CatalogLogger} the client half takes — deliberately
   * one type, so a host process configures one sink and gets both the
   * library's publish-path lines and the service's boot, coordination,
   * request and shutdown lines through it.
   *
   * Omitted, every line goes to `console.warn` / `console.error` /
   * `console.log` with exactly the arguments it used before this option
   * existed; `tests/server-logger.test.ts` asserts the full
   * `console.*.mock.calls` arrays for the representative sites.
   *
   * Rate limiting stays in front of the sink: the per-request and
   * per-scrape paths are `LogThrottle`-guarded here, because only this
   * code knows which lines run at request rate.
   */
  logger?: CatalogLogger;
}

/**
 * Populate a FeatureBundleRegistry from the declared bundles.
 *
 * Exported so the e2e harness exercises THIS function rather than a faithful
 * copy of it — the registry was previously built inline and left empty, and a
 * duplicated loop in the test server would let that regression recur unseen.
 */
export function buildBundleRegistry(): FeatureBundleRegistry {
  const bundleRegistry = new FeatureBundleRegistry();
  for (const bundle of allBundles) {
    try {
      bundleRegistry.register(bundle);
    } catch (err) {
      // A duplicate name+version with a different event set is a source bug,
      // not a runtime condition; surface it without killing boot.
      console.warn(
        `[server] feature bundle "${bundle.name}@${bundle.version}" not registered:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return bundleRegistry;
}

export async function startServer(config: ServerConfig = {}): Promise<{
  /** Bound address (distributed-core AdmissionHttpServer.address()). */
  address: () => { port: number; hostname: string } | null;
  shutdown: () => Promise<void>;
}> {
  // Resolve the environment through the same validated path the CLI uses, so
  // a malformed $PORT fails loudly here instead of binding NaN, and the
  // documented $EVENT_CATALOG_PORT is actually honored. Caller overrides are
  // passed as flags so an explicit argument satisfies a requirement the
  // environment does not.
  const resolved = resolveServerConfig(process.env, {
    port: config.port !== undefined ? String(config.port) : undefined,
    'redis-url': config.redisUrl,
    'message-queue-url': config.messageQueueUrl,
  });
  if (!resolved.ok) {
    throw new Error(
      `event-catalog: invalid configuration\n  - ${resolved.errors.join('\n  - ')}`,
    );
  }

  const {
    port = resolved.config.port,
    redisUrl = resolved.config.redisUrl,
    messageQueueUrl = resolved.config.messageQueueUrl,
    corsOrigin = resolveCorsOrigin(process.env.EVENT_CATALOG_CORS_ORIGIN),
    onDeadLetter = [],
    shutdownDrainMs,
    compression = resolved.config.compression,
    logger,
  } = config;

  // One writer for this server's own lines; every sub-component below is
  // handed `logger` and builds its own so it can carry its own throttles.
  const log = new LogWriter(logger);
  // Point the process-wide SSE registry at the same sink. It is a module
  // singleton constructed at import time, long before this config exists.
  sseRegistry.useLogger(logger);
  /**
   * Periodic background lines: the health probe (every 15s), the metrics
   * snapshot and the subscriber sweep (every 60s). None of these is
   * request-driven, but all of them repeat forever while a dependency is
   * down — a Redis outage over a weekend is ~17k identical health lines.
   * Keyed by the condition so redis and message-queue are independently
   * visible.
   */
  const periodicWarnings = new LogThrottle({ keyIntervalMs: 300_000, maxPerWindow: 6, maxKeys: 32 });
  const periodicWarn = (
    key: string,
    message: string,
    fields: Record<string, unknown>,
    ...tail: unknown[]
  ): void => {
    const suppressed = periodicWarnings.attempt(key);
    if (suppressed === null) return;
    const suffix = LogThrottle.suffix(suppressed);
    const text = message.endsWith(':') ? message.slice(0, -1) + suffix + ':' : message + suffix;
    log.warn(text, { component: 'server', ...fields, suppressed }, ...tail);
  };

  // Auth is opt-in and off unless configured. With no explicit middleware
  // and no $EVENT_CATALOG_AUTH_TOKEN this is `undefined`, the `if
  // (authMiddleware)` gate below is never entered, and the request path is
  // exactly what it was before src/server/auth.ts existed.
  const authMiddleware = resolveAuthMiddleware(
    config.authMiddleware,
    resolved.config.authToken,
    config.logger,
  );

  const drainMs = shutdownDrainMs
    ?? (Number(process.env.EVENT_CATALOG_SHUTDOWN_DRAIN_MS) || SHUTDOWN_DRAIN_MS);

  // Boot-bounded reconnect: without this, a down Redis makes connect() retry
  // forever, the catch below never fires, and boot never reaches app.listen().
  const registryBootStrategy = createBootBoundedReconnectStrategy({ label: 'registry' });
  const redisClient = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: registryBootStrategy.reconnectStrategy },
  }) as RedisClientType;
  redisClient.on('error', (err: Error) => {
    // Fires once per failed reconnect attempt for the life of an outage.
    periodicWarn(
      'registry-redis-error',
      '[server] registry Redis error:',
      { action: 'registry-redis', error: formatRedisError(err) },
      formatRedisError(err),
    );
  });
  await redisClient.connect()
    .then(() => registryBootStrategy.markConnected())
    .catch(err => {
      log.warn(
        '[server] registry Redis connection failed:',
        {
          component: 'server',
          action: 'registry-redis-connect',
          status: 'degraded',
          error: formatRedisError(err),
        },
        formatRedisError(err),
        '— continuing in degraded mode (in-memory registry, no cross-replica sync)',
      );
    });

  const registry = new Registry(redisClient);
  // Hydration is best-effort: with Redis down the client is closed and
  // hGetAll throws ClientClosedError. Serve an empty in-memory registry
  // instead of failing boot — producers re-declare on their next sync.
  await registry.load().catch(err => {
    log.warn(
      '[server] registry hydration failed:',
      {
        component: 'server',
        action: 'registry-hydrate',
        status: 'degraded',
        error: formatRedisError(err),
      },
      formatRedisError(err),
      '— starting with an empty in-memory registry',
    );
  });

  const metrics = new MetricsCollector(60, undefined, logger);
  await metrics.restoreFromRedis(redisClient).catch(err => {
    log.warn(
      '[server] metrics restore failed:',
      { component: 'server', action: 'metrics-restore', error: formatRedisError(err) },
      formatRedisError(err),
    );
  });

  // The transports take the same sink, so the publish-path lines from
  // src/client land alongside the service's own.
  const signal = new SignalTransport({ url: redisUrl, logger });
  const durable = new DurableTransport({ url: messageQueueUrl, logger });
  const startedAt = Date.now();

  // Connect transports
  await signal.connect().catch(err => {
    log.warn(
      '[server] Redis connection failed:',
      { component: 'server', action: 'signal-connect', error: errorMessage(err) },
      (err as Error).message,
    );
  });

  await durable.connect().catch(err => {
    log.warn(
      '[server] message-queue connection failed:',
      { component: 'server', action: 'message-queue-connect', error: errorMessage(err) },
      (err as Error).message,
    );
  });

  await ensureTable(logger).catch(err => {
    log.warn(
      '[server] DLQ table auto-provision failed:',
      { component: 'server', action: 'dlq-table-provision', error: errorMessage(err) },
      (err as Error).message,
    );
  });

  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const dlqTableName = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';
  const dlqStore = new DLQStore(dynamoClient, dlqTableName);

  durable.onDeadLetter(buildDeadLetterCallback({
    registry,
    dlqStore,
    additionalHandlers: onDeadLetter,
    logger,
  }));

  const attribution = new ProducerAttributionStore();
  const poisonDetector = new PoisonEventDetector();
  const metricsObserver = new MetricsObserver({ registry, signal, durable, metrics, attribution, poisonDetector, logger });

  // wave26-d — multi-replica registry coordination via Redis pub/sub.
  const coordinator = new RegistryCoordinator(logger);
  coordinator.start(redisUrl, registry).catch(err => {
    log.warn(
      '[server] registry coordinator start failed:',
      { component: 'server', action: 'coordinator-start', error: errorMessage(err) },
      (err as Error).message,
    );
  });
  await metricsObserver.start().catch(err => {
    log.warn(
      '[server] metrics observer start failed:',
      { component: 'server', action: 'metrics-observer-start', error: errorMessage(err) },
      (err as Error).message,
    );
  });

  const promMetrics = new PromMetrics(undefined, { logger });
  const serviceVersion = readServiceVersion();

  // Pull-style gauges, sampled at scrape time rather than pushed on a timer —
  // registry size, poisoned events and SSE saturation are all cheap reads whose
  // value is "what is true right now", and a timer would only add staleness.
  // recordSseRejected had no caller, so stream saturation was invisible.
  sseRegistry.useRejectionHook(() => promMetrics.recordSseRejected());

  promMetrics.collect(() => {
    promMetrics.setRegistrySize(registry.size());
    promMetrics.setPoisonedEvents(poisonDetector.listPoisoned().length);
    promMetrics.setSseStreams(sseRegistry.size, sseRegistry.getLimits().maxStreams);
  });

  // Bridge: original DLQ deadLetter hook also bumps the prom gauge.
  durable.onDeadLetter((message) => {
    promMetrics.recordFailure(message.envelope.eventName, 'transport');
  });

  // Root-level routes (health + prom metrics), served alongside /api.
  const rootRouter = Router();

  // Tri-state /health endpoint at root (service-runtime shape)
  rootRouter.get('/health', makeHealthHandler({
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
      const counts = new Map<string, number>();
      for (const entry of dlqEntries) {
        counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
      }
      // syncDLQEntries, not a setDLQEntries loop: a drained queue has no entry
      // to iterate, so per-event sets left stale non-zero depths forever.
      promMetrics.syncDLQEntries(counts);
    } catch {
      // swallow; gauges may be stale but text rendering still works
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(promMetrics.renderProm());
  });

  // wave23-a — persistent audit log. Capped Redis list keyed at
  // `event-catalog:audit-log` so audit events survive replicas
  // restarts and SSE clients get history-on-connect via ?replay=N.
  // Best-effort — Redis hiccups don't block live emits.
  const auditLog = startAuditLog({ redis: redisClient });

  // wave23-b — consumer manifest store. Backs /api/manifests/* so
  // consumers can pin "I depend on these N events at these N
  // fingerprints" and the catalog can report drift.
  const manifestStore = new RedisManifestStore(redisClient);

  // Admin API
  const routes = createRoutes({ registry, metrics, signal, durable, metricsObserver, dlqStore, startedAt, promMetrics, auditLog, manifestStore, attribution, poisonDetector, coordinator, logger });

  // FeatureBundle admin surface — CRD query endpoints for dc-k8s-operator.
  //
  // The registry was constructed empty and never populated, so every
  // /api/feature-bundles response was `{bundles: [], total: 0}` in
  // production while 18 bundles sat declared in the source. ec-lint-crd
  // reads them from the package rather than the server, which is why
  // nothing failed loudly — the HTTP surface was simply blank.
  const bundleRegistry = buildBundleRegistry();

  const bundleRoutes = createBundleRoutes({ bundleRegistry, registry, logger });

  // Longest prefix first so /api/feature-bundles/* reaches its router
  // before the general /api router gets a shot.
  const apiMounts: Mount[] = [
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
  const adminDistDir = join(__dirname, '../admin/dist');
  const staticHandler = withStaticCompression(
    serveStatic({ staticDir: adminDistDir }),
    { compression },
  );
  const spaIndexPath = join(adminDistDir, 'index.html');
  /** Headers the SPA fallback sends — matches serveStatic's HTML policy. */
  const spaIndexHeaders = new Map<string, string>([
    ['content-type', 'text/html'],
    ['cache-control', 'no-cache'],
  ]);

  /**
   * The single request entrypoint handed to AdmissionHttpServer.
   * Request order mirrors the old Express middleware stack:
   * CORS → auth (on /api) → API routers → root routes → static → SPA.
   */
  const onRequest = async (areq: AdmissionRequest, ares: AdmissionResponse): Promise<void> => {
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
      if (allowOrigin !== '*') nodeRes.setHeader('Vary', 'Origin');
      nodeRes.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      nodeRes.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Event-Catalog-Strict');
    }
    if (areq.method === 'OPTIONS') {
      ares.raw(204, '');
      return;
    }

    // JSON body parse (AdmissionHttpServer already buffered + capped it).
    let body: unknown;
    const contentType = areq.headers['content-type'] ?? '';
    if (areq.body.length > 0 && contentType.includes('application/json')) {
      try {
        body = JSON.parse(areq.body);
      } catch {
        ares.json(400, { error: 'InvalidJson' });
        return;
      }
    }

    const req = makeRouteRequest(nodeReq, body);
    // Content coding is negotiated per request from its Accept-Encoding —
    // never assumed. `compressionFor` returns undefined when the policy is
    // off, and the response path is then byte-for-byte what it was before.
    // Note the SSE routes (/api/flow, /api/audit) opt out structurally:
    // they reach the socket through flushHeaders()/write(), which
    // makeRouteResponse never compresses.
    const res = makeRouteResponse(nodeRes, compressionFor(nodeReq, compression));

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
          if (!res.headersSent) res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }
      const handled = await dispatchMounts(req, res, apiMounts);
      if (!handled && !res.headersSent) {
        res.status(404).json({ error: 'NotFound', path: req.path });
      }
      return;
    }

    if (await rootRouter.handle(req, res, req.path)) return;

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (staticHandler(nodeReq, nodeRes)) return;
      // SPA fallback for admin UI routes. Goes through sendStaticBuffer
      // rather than `ares.raw` so this last static path negotiates its
      // coding like every other one (index.html is 481 bytes today, so
      // it lands under the threshold and is sent identity — but it still
      // needs the `Vary: Accept-Encoding` that keeps caches honest).
      try {
        const html = await readFile(spaIndexPath);
        sendStaticBuffer(nodeReq, nodeRes, 200, html, spaIndexHeaders, compression);
      } catch {
        ares.json(404, { error: 'NotFound', detail: 'admin UI not built (src/admin: npm run build)' });
      }
      return;
    }

    ares.json(404, { error: 'NotFound', path: req.path });
  };

  const metricsSnapshotInterval = setInterval(() => {
    metrics.snapshotToRedis(redisClient).catch(err => {
      periodicWarn(
        'metrics-snapshot',
        '[server] metrics snapshot failed:',
        { action: 'metrics-snapshot', error: errorMessage(err) },
        (err as Error).message,
      );
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
        } catch (err) {
          periodicWarn(
            'subscriber-sweep',
            '[server] subscriber sweep failed:',
            { action: 'subscriber-sweep', error: errorMessage(err) },
            (err as Error).message,
          );
        }
      }, 60_000)
    : null;

  const alertManager = new AlertManager({ logger });

  // Periodic background health probe
  const healthInterval = setInterval(async () => {
    const [redisHealth, mqHealth] = await Promise.all([
      signal.healthCheck(),
      durable.healthCheck(),
    ]);
    if (redisHealth.status !== 'connected') {
      periodicWarn(
        `health:redis:${redisHealth.status}`,
        `[event-catalog] redis health: ${redisHealth.status} (${redisHealth.latencyMs}ms)`,
        { action: 'health-probe', transport: 'redis', status: redisHealth.status, latencyMs: redisHealth.latencyMs },
      );
    }
    if (mqHealth.status !== 'connected') {
      periodicWarn(
        `health:message-queue:${mqHealth.status}`,
        `[event-catalog] message-queue health: ${mqHealth.status} (${mqHealth.latencyMs}ms)`,
        { action: 'health-probe', transport: 'message-queue', status: mqHealth.status, latencyMs: mqHealth.latencyMs },
      );
    }

    const checks: Array<{
      component: TransportName;
      status: string;
      latencyMs: number | undefined;
    }> = [
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
  const requestErrors = new LogThrottle({ keyIntervalMs: 60_000, maxPerWindow: 10, maxKeys: 64 });
  const admission = new AdmissionHttpServer({
    port,
    // Bind all interfaces (AdmissionHttpServer defaults to 127.0.0.1,
    // which would break the Docker deployment).
    hostname: process.env.HOST ?? '0.0.0.0',
    bodyLimits: REQUEST_BODY_LIMITS,
    onRequest,
    onError: err => {
      // Transport-level, so one line per failing request: a client that
      // resets connections mid-body drives this as fast as it can open
      // sockets. Keyed by the error text so distinct causes stay visible.
      const suppressed = requestErrors.attempt(err.message);
      if (suppressed === null) return;
      log.warn(
        '[server] unhandled request error' + LogThrottle.suffix(suppressed) + ':',
        {
          component: 'server',
          action: 'unhandled-request-error',
          error: err.message,
          suppressed,
        },
        err.message,
      );
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
    if (subscriberSweepInterval) clearInterval(subscriberSweepInterval);
    auditLog.stop();

    // End every SSE stream first. `admission.stop()` below is
    // `http.Server.close()`, which resolves only once every connection
    // has ended — an open /api/flow or /api/audit stream never ends on
    // its own, so awaiting the close with one attached used to hang the
    // whole shutdown (verified: stop() had not resolved 1.5s after a
    // single SSE client connected, and resolved immediately once the
    // connection was closed). Redis was therefore never disconnected
    // and the process died to the orchestrator's SIGKILL.
    const closedStreams = sseRegistry.closeAll();
    if (closedStreams > 0) {
      log.info(`[event-catalog] closed ${closedStreams} open event stream(s)`, {
        component: 'server', action: 'shutdown', phase: 'sse-closed', closedStreams,
      });
    }

    await metrics.snapshotToRedis(redisClient).catch(() => {});

    // Drain: stop accepting, release idle keep-alive sockets right away,
    // and give anything still in flight a bounded window to finish
    // before the remaining sockets are closed out from under it.
    const stopped = admission.stop().catch(() => {});
    admission.nodeServer.closeIdleConnections?.();
    const drainTimer = new Promise<'timeout'>(resolve => {
      const t = setTimeout(() => resolve('timeout'), drainMs);
      t.unref?.();
    });
    if (await Promise.race([stopped.then(() => 'closed' as const), drainTimer]) === 'timeout') {
      log.warn(
        `[event-catalog] requests still in flight after ${drainMs}ms — closing connections`,
        { component: 'server', action: 'shutdown', phase: 'drain-timeout', drainMs },
      );
      admission.nodeServer.closeAllConnections?.();
      await stopped;
    }

    await metricsObserver.stop();
    await coordinator.stop();
    await signal.disconnect();
    await durable.disconnect();
    await redisClient.quit().catch(() => {});
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
function runMiddleware(
  middleware: Middleware,
  req: RouteRequest,
  res: RouteResponse,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    res.raw.on('finish', () => settle(false));
    res.raw.on('close', () => settle(false));
    try {
      middleware(req, res, (err?: unknown) => settle(err === undefined || err === null));
    } catch {
      settle(false);
    }
  });
}
