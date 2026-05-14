import express from 'express';
import cors from 'cors';
import { createClient, type RedisClientType } from 'redis';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Registry } from '../registry/index.js';
import { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import { MetricsCollector } from './metrics.js';
import { MetricsObserver } from './metrics-observer.js';
import { AlertManager } from './alerting.js';
import { DLQStore } from './dlq-store.js';
import { ensureTable } from './dynamo-setup.js';
import { createRoutes } from './routes.js';
import { makeHealthHandler } from './health.js';
import { PromMetrics } from './prom-metrics.js';
import { readFileSync } from 'node:fs';

function readServiceVersion(): string {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url).pathname;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface ServerConfig {
  port?: number;
  redisUrl?: string;
  messageQueueUrl?: string;
  corsOrigin?: string | boolean;
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

  durable.onDeadLetter((message) => {
    dlqStore.put({
      eventName: message.envelope.eventName,
      payload: message.envelope.payload,
      error: message.error,
      attempts: message.attempts,
      deadAt: message.deadLetteredAt,
    }).catch(err => {
      console.error('[server] DLQ store write failed:', (err as Error).message);
    });
  });

  const metricsObserver = new MetricsObserver({ registry, signal, durable, metrics });
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

  // Admin API
  const routes = createRoutes({ registry, metrics, signal, durable, metricsObserver, dlqStore, startedAt, promMetrics });
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
