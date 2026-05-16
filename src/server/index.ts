import express from 'express';
import cors from 'cors';
import { createClient, type RedisClientType } from 'redis';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
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
import { makeHealthHandler } from './health.js';
import { PromMetrics } from './prom-metrics.js';
import { ProducerAttributionStore } from './producer-attribution.js';
import { readFileSync } from 'node:fs';
import type { RegistryEntry } from '../types/index.js';

function readServiceVersion(): string {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url).pathname;
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
}): (message: DeadLetteredMessage) => void {
  return (message) => {
    const entry = deps.registry.get(message.envelope.eventName);
    deps.dlqStore.put({
      eventName: message.envelope.eventName,
      payload: message.envelope.payload,
      error: message.error,
      attempts: message.attempts,
      deadAt: message.deadLetteredAt,
    }, entry?.dlqRetention).catch((err: Error) => {
      console.error('[server] DLQ store write failed:', err.message);
    });

    if (deps.additionalHandlers.length === 0) return;
    const context: DeadLetterContext = { entry, namespace: entry?.namespace };
    for (const handler of deps.additionalHandlers) {
      // Wrap with new Promise() so a SYNCHRONOUS throw inside the
      // handler is caught alongside async rejections.
      new Promise<void>((resolve) => {
        resolve(handler(message, context));
      }).catch((err: Error) => {
        console.warn(
          `[server] DLQ handler threw on "${message.envelope.eventName}":`,
          err.message,
        );
      });
    }
  };
}

export interface ServerConfig {
  port?: number;
  redisUrl?: string;
  messageQueueUrl?: string;
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
   * Phase 20-d — optional Express middleware mounted before `/api`
   * routes. The admin server is unauthenticated by default
   * (deliberately, for local dev); operators can inject a JWT / API-key
   * check here without forking startServer.
   */
  authMiddleware?: express.RequestHandler;
}

export async function startServer(config: ServerConfig = {}): Promise<{
  app: ReturnType<typeof express>;
  shutdown: () => Promise<void>;
}> {
  const {
    port = parseInt(process.env.PORT ?? '3010'),
    redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379',
    messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004',
    corsOrigin = true,
    onDeadLetter = [],
    authMiddleware,
  } = config;

  const redisClient = createClient({ url: redisUrl }) as RedisClientType;
  redisClient.on('error', (err: Error) => {
    console.warn('[server] registry Redis error:', err.message);
  });
  await redisClient.connect().catch(err => {
    console.warn('[server] registry Redis connection failed:', (err as Error).message);
  });

  const registry = new Registry(redisClient);
  await registry.load();

  const metrics = new MetricsCollector(60);
  await metrics.restoreFromRedis(redisClient).catch(err => {
    console.warn('[server] metrics restore failed:', (err as Error).message);
  });

  const signal = new SignalTransport({ url: redisUrl });
  const durable = new DurableTransport({ url: messageQueueUrl });
  const startedAt = Date.now();

  // Connect transports
  await signal.connect().catch(err => {
    console.warn('[server] Redis connection failed:', (err as Error).message);
  });

  await durable.connect().catch(err => {
    console.warn('[server] message-queue connection failed:', (err as Error).message);
  });

  await ensureTable().catch(err => {
    console.warn('[server] DLQ table auto-provision failed:', (err as Error).message);
  });

  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const dlqTableName = process.env.DLQ_TABLE_NAME ?? 'event-catalog-dlq';
  const dlqStore = new DLQStore(dynamoClient, dlqTableName);

  durable.onDeadLetter(buildDeadLetterCallback({
    registry,
    dlqStore,
    additionalHandlers: onDeadLetter,
  }));

  const attribution = new ProducerAttributionStore();
  const metricsObserver = new MetricsObserver({ registry, signal, durable, metrics, attribution });
  await metricsObserver.start().catch(err => {
    console.warn('[server] metrics observer start failed:', (err as Error).message);
  });

  const promMetrics = new PromMetrics();
  const serviceVersion = readServiceVersion();

  // Bridge: original DLQ deadLetter hook also bumps the prom gauge.
  durable.onDeadLetter((message) => {
    promMetrics.recordFailure(message.envelope.eventName, 'transport');
  });

  // Build Express app
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  // Tri-state /health endpoint at root (service-runtime shape)
  app.get('/health', makeHealthHandler({
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
      const counts = new Map<string, number>();
      for (const entry of dlqEntries) {
        counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
      }
      for (const [event, count] of counts) {
        promMetrics.setDLQEntries(event, count);
      }
    } catch {
      // swallow; gauges may be stale but text rendering still works
    }
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
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
  const routes = createRoutes({ registry, metrics, signal, durable, metricsObserver, dlqStore, startedAt, promMetrics, auditLog, manifestStore, attribution });
  // Phase 20-d — auth middleware injection (optional). Mounted before
  // the /api router so it gates every admin endpoint. The catalog
  // itself ships with no auth on purpose (local dev / in-cluster
  // private surface) but operators deploying outside that envelope
  // pass their JWT / API-key middleware here.
  if (authMiddleware) {
    app.use('/api', authMiddleware);
  }
  app.use('/api', routes);

  // Static admin UI (production)
  app.use(express.static(new URL('../admin/dist', import.meta.url).pathname));

  // SPA fallback for admin UI routes
  app.get('*', (_req, res) => {
    res.sendFile('index.html', { root: new URL('../admin/dist', import.meta.url).pathname });
  });

  const metricsSnapshotInterval = setInterval(() => {
    metrics.snapshotToRedis(redisClient).catch(err => {
      console.warn('[server] metrics snapshot failed:', (err as Error).message);
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
          console.warn('[server] subscriber sweep failed:', (err as Error).message);
        }
      }, 60_000)
    : null;

  const alertManager = new AlertManager();

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
        } else if (status !== 'connected') {
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
    if (subscriberSweepInterval) clearInterval(subscriberSweepInterval);
    auditLog.stop();
    await metrics.snapshotToRedis(redisClient).catch(() => {});
    server.close();
    await metricsObserver.stop();
    await signal.disconnect();
    await durable.disconnect();
    await redisClient.quit().catch(() => {});
    console.log('[event-catalog] shutdown complete');
  };

  return { app, shutdown };
}
