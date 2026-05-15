#!/usr/bin/env node

// src/cli/index.ts
//
// wave24-a — subcommand dispatcher. The default ("server") preserves
// the prior behavior so existing scripts (`node dist/cli/index.js`)
// keep working unchanged.

import { startServer } from '../server/index.js';
import { lint } from './commands/lint.js';
import { snapshot } from './commands/snapshot.js';
import { drift } from './commands/drift.js';
import { manifest } from './commands/manifest.js';

const args = process.argv.slice(2);
const subcommand = args[0];

const HELP = `
event-catalog — schema registry + observability for cross-service events

USAGE
  event-catalog [server] [--port=N] [--redis-url=URL] [--message-queue-url=URL]
  event-catalog lint <file>
  event-catalog snapshot --catalog-url=<url> [--namespace=X]
  event-catalog drift --catalog-url=<url> --against=<snapshot.json>
  event-catalog manifest pin --catalog-url=<url> --consumer=<name>
                              [--snapshot=<file> | --events=name=fp,...]
  event-catalog --help

EXAMPLES
  event-catalog snapshot --catalog-url=https://catalog > snapshot.json
  event-catalog drift --catalog-url=https://catalog --against=snapshot.json
  event-catalog lint declarations.json
  event-catalog manifest pin --catalog-url=https://catalog \\
      --consumer=audit-worker --snapshot=current.json

The default subcommand (`server`) is the long-running HTTP service.
All other subcommands are short-lived CI / ops utilities and exit
non-zero when they detect a problem (lint shape errors, drift, etc.).
`;

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return defaultValue;
}

async function runServer(): Promise<void> {
  const port = parseInt(getArg('port', process.env.PORT ?? '3010'));
  const redisUrl = getArg('redis-url', process.env.REDIS_URL ?? 'redis://localhost:6379');
  const messageQueueUrl = getArg('message-queue-url', process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004');

  console.log('╔══════════════════════════════════════╗');
  console.log('║         event-catalog server         ║');
  console.log('╚══════════════════════════════════════╝');

  const { shutdown } = await startServer({ port, redisUrl, messageQueueUrl });
  process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
}

void (async () => {
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    console.log(HELP.trim());
    return;
  }
  if (!subcommand || subcommand === 'server' || subcommand.startsWith('--')) {
    // No subcommand or first arg is a flag → run the server (default).
    await runServer();
    return;
  }
  if (subcommand === 'lint') {
    process.exit(await lint(args.slice(1)));
  }
  if (subcommand === 'snapshot') {
    process.exit(await snapshot(args.slice(1)));
  }
  if (subcommand === 'drift') {
    process.exit(await drift(args.slice(1)));
  }
  if (subcommand === 'manifest') {
    process.exit(await manifest(args.slice(1)));
  }
  console.error(`event-catalog: unknown subcommand "${subcommand}"`);
  console.error('run `event-catalog --help` for usage');
  process.exit(2);
})();
