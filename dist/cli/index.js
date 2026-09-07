#!/usr/bin/env node
"use strict";
// src/cli/index.ts
//
// wave24-a — subcommand dispatcher. The default ("server") preserves
// the prior behavior so existing scripts (`node dist/cli/index.js`)
// keep working unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const index_js_1 = require("../server/index.js");
const lint_js_1 = require("./commands/lint.js");
const snapshot_js_1 = require("./commands/snapshot.js");
const drift_js_1 = require("./commands/drift.js");
const manifest_js_1 = require("./commands/manifest.js");
const deprecate_js_1 = require("./commands/deprecate.js");
const asyncapi_js_1 = require("./commands/asyncapi.js");
const _args_js_1 = require("./_args.js");
const BIN = 'event-catalog';
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

SERVER OPTIONS
  --port=<n>                 Listen port (default: $PORT or 3010)
  --redis-url=<url>          Redis for signal transport (default: $REDIS_URL)
  --message-queue-url=<url>  message-queue base URL (default: $MESSAGE_QUEUE_URL)

Every subcommand accepts \`--help\` for its own flags, e.g.
\`event-catalog drift --help\`.

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
`.trim();
const SERVER_USAGE = 'event-catalog [server] [--port=N] [--redis-url=URL] [--message-queue-url=URL]';
const SERVER_SPEC = { value: ['port', 'redis-url', 'message-queue-url'] };
/**
 * Start the long-running HTTP service. Resolves only on a fatal startup
 * error; on success the process stays alive until a signal arrives, so
 * this returns a promise that never settles in the happy path.
 */
async function runServer(args) {
    const parsed = (0, _args_js_1.parseFlags)(args, SERVER_SPEC);
    if (!parsed.ok)
        return (0, _args_js_1.usageError)(BIN, parsed.error, SERVER_USAGE);
    if (parsed.args.help) {
        console.log(HELP);
        return 0;
    }
    if (parsed.args.positional.length > 0) {
        return (0, _args_js_1.usageError)(BIN, `unknown subcommand "${parsed.args.positional[0]}"`, SERVER_USAGE);
    }
    const rawPort = parsed.args.values['port'] ?? process.env.PORT ?? '3010';
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return (0, _args_js_1.usageError)(BIN, `invalid --port "${rawPort}" — expected an integer between 0 and 65535`, SERVER_USAGE);
    }
    const redisUrl = parsed.args.values['redis-url'] ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    const messageQueueUrl = parsed.args.values['message-queue-url']
        ?? process.env.MESSAGE_QUEUE_URL
        ?? 'http://localhost:3004';
    console.log('╔══════════════════════════════════════╗');
    console.log('║         event-catalog server         ║');
    console.log('╚══════════════════════════════════════╝');
    const { shutdown } = await (0, index_js_1.startServer)({ port, redisUrl, messageQueueUrl });
    process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });
    // Server mode never resolves — the process lives until a signal.
    return new Promise(() => { });
}
/**
 * Dispatch one argv to a subcommand and resolve with its exit code.
 *
 * NOTE: importing this module runs the CLI (see the `runCli` call at the
 * bottom), so tests exercise the dispatcher by spawning the bin rather
 * than importing `main`.
 */
async function main(argv) {
    const subcommand = argv[0];
    if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
        console.log(HELP);
        return 0;
    }
    // No subcommand, an explicit `server`, or a leading flag → server mode.
    if (subcommand === undefined || subcommand === 'server' || subcommand.startsWith('-')) {
        return runServer(subcommand === 'server' ? argv.slice(1) : argv);
    }
    const rest = argv.slice(1);
    switch (subcommand) {
        case 'lint': return (0, lint_js_1.lint)(rest);
        case 'snapshot': return (0, snapshot_js_1.snapshot)(rest);
        case 'drift': return (0, drift_js_1.drift)(rest);
        case 'manifest': return (0, manifest_js_1.manifest)(rest);
        case 'deprecate': return (0, deprecate_js_1.deprecate)(rest);
        case 'undeprecate': return (0, deprecate_js_1.undeprecate)(rest);
        case 'asyncapi': return (0, asyncapi_js_1.asyncapi)(rest);
        default:
            console.error(`${BIN}: unknown subcommand "${subcommand}"`);
            console.error('run `event-catalog --help` for usage');
            return 2;
    }
}
(0, _args_js_1.runCli)(BIN, () => main(process.argv.slice(2)));
//# sourceMappingURL=index.js.map