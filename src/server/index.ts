import express from 'express';
import cors from 'cors';
import { Registry } from '../registry/index.js';
import { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import { MetricsCollector } from './metrics.js';
import { createRoutes } from './routes.js';

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

  const registry = new Registry();
  const metrics = new MetricsCollector(60);
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

  // Build Express app
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  // Admin API
  const routes = createRoutes({ registry, metrics, signal, durable, startedAt });
  app.use('/api', routes);

  // Static admin UI (production)
  app.use(express.static(new URL('../admin/dist', import.meta.url).pathname));

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
