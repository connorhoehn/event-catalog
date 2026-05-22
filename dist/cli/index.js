#!/usr/bin/env node
"use strict";
// src/cli/index.ts
//
// wave24-a — subcommand dispatcher. The default ("server") preserves
// the prior behavior so existing scripts (`node dist/cli/index.js`)
// keep working unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("../server/index.js");
const lint_js_1 = require("./commands/lint.js");
const snapshot_js_1 = require("./commands/snapshot.js");
const drift_js_1 = require("./commands/drift.js");
const manifest_js_1 = require("./commands/manifest.js");
const deprecate_js_1 = require("./commands/deprecate.js");
const asyncapi_js_1 = require("./commands/asyncapi.js");
const args = process.argv.slice(2);
const subcommand = args[0];
const HELP = `
event-catalog — schema registry + observability for cross-service events

USAGE
  event-catalog [server] [--port=N] [--redis-url=URL] [--message-queue-url=URL]
  event-catalog lint <file>
  event-catalog snapshot --catalog-url=<url> [--namespace=X]
  event-catalog snapshot --from-source --declarations=<path> [--export=N]
                          [--namespace=X]
  event-catalog drift --against=<snapshot.json>
                       (--catalog-url=<url> | --registry-snapshot=<file>)
  event-catalog manifest pin --catalog-url=<url> --consumer=<name>
                              [--snapshot=<file> | --events=name=fp,...]
  event-catalog manifest verify --against=<consumed.manifest.json>
                                 --registry-snapshot=<registry.snapshot.json>
  event-catalog deprecate <name> --catalog-url=<url> [--reason=...] [--by=...]
  event-catalog undeprecate <name> --catalog-url=<url>
  event-catalog asyncapi --catalog-url=<url> [--output=file] [--namespace=ns]
                          [--title=T] [--version=V]
  event-catalog --help

EXAMPLES
  # live mode (requires running catalog server)
  event-catalog snapshot --catalog-url=https://catalog > snapshot.json
  event-catalog drift --catalog-url=https://catalog --against=snapshot.json

  # offline mode for producer CI (no server, no network)
  event-catalog snapshot --from-source --declarations=src/event-declarations.ts \\
      > contracts/produced.snapshot.json
  event-catalog drift --against=contracts/produced.snapshot.json \\
      --registry-snapshot=node_modules/@connorhoehn/event-catalog/contracts/registry.snapshot.json
  event-catalog manifest verify --against=contracts/consumed.manifest.json \\
      --registry-snapshot=node_modules/@connorhoehn/event-catalog/contracts/registry.snapshot.json

  # consumer pinning (live)
  event-catalog manifest pin --catalog-url=https://catalog \\
      --consumer=audit-worker --snapshot=current.json

The default subcommand (\`server\`) is the long-running HTTP service.
All other subcommands are short-lived CI / ops utilities and exit
non-zero when they detect a problem (lint shape errors, drift, etc.).
`;
function getArg(name, defaultValue) {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1])
        return args[idx + 1];
    for (const arg of args) {
        if (arg.startsWith(`--${name}=`))
            return arg.slice(name.length + 3);
    }
    return defaultValue;
}
async function runServer() {
    const port = parseInt(getArg('port', process.env.PORT ?? '3010'));
    const redisUrl = getArg('redis-url', process.env.REDIS_URL ?? 'redis://localhost:6379');
    const messageQueueUrl = getArg('message-queue-url', process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         event-catalog server         ║');
    console.log('╚══════════════════════════════════════╝');
    const { shutdown } = await (0, index_js_1.startServer)({ port, redisUrl, messageQueueUrl });
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
        process.exit(await (0, lint_js_1.lint)(args.slice(1)));
    }
    if (subcommand === 'snapshot') {
        process.exit(await (0, snapshot_js_1.snapshot)(args.slice(1)));
    }
    if (subcommand === 'drift') {
        process.exit(await (0, drift_js_1.drift)(args.slice(1)));
    }
    if (subcommand === 'manifest') {
        process.exit(await (0, manifest_js_1.manifest)(args.slice(1)));
    }
    if (subcommand === 'deprecate') {
        process.exit(await (0, deprecate_js_1.deprecate)(args.slice(1)));
    }
    if (subcommand === 'undeprecate') {
        process.exit(await (0, deprecate_js_1.undeprecate)(args.slice(1)));
    }
    if (subcommand === 'asyncapi') {
        process.exit(await (0, asyncapi_js_1.asyncapi)(args.slice(1)));
    }
    console.error(`event-catalog: unknown subcommand "${subcommand}"`);
    console.error('run `event-catalog --help` for usage');
    process.exit(2);
})();
//# sourceMappingURL=index.js.map