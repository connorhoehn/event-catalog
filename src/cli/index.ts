#!/usr/bin/env node

import { startServer } from '../server/index.js';

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const port = parseInt(getArg('port', process.env.PORT ?? '3010'));
const redisUrl = getArg('redis-url', process.env.REDIS_URL ?? 'redis://localhost:6379');
const messageQueueUrl = getArg('message-queue-url', process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004');

console.log('╔══════════════════════════════════════╗');
console.log('║        event-catalog v0.1.0          ║');
console.log('╚══════════════════════════════════════╝');

const { shutdown } = await startServer({ port, redisUrl, messageQueueUrl });

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});
