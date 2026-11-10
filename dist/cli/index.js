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
const auth_js_1 = require("../server/auth.js");
const lint_js_1 = require("./commands/lint.js");
const snapshot_js_1 = require("./commands/snapshot.js");
const drift_js_1 = require("./commands/drift.js");
const manifest_js_1 = require("./commands/manifest.js");
const deprecate_js_1 = require("./commands/deprecate.js");
const asyncapi_js_1 = require("./commands/asyncapi.js");
const _args_js_1 = require("./_args.js");
const config_js_1 = require("./config.js");
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
  --port=<n>                 Listen port (default: $PORT, else 3010)
  --redis-url=<url>          REQUIRED. Redis for the registry, signal
                             transport and audit log (default: $REDIS_URL)
  --message-queue-url=<url>  message-queue base URL
                             (default: $MESSAGE_QUEUE_URL, else
                             http://localhost:3004)

SERVER ENVIRONMENT
  REDIS_URL                    required; redis:// or rediss://
  PORT                         default 3010
  HOST                         default 127.0.0.1
  MESSAGE_QUEUE_URL            default http://localhost:3004
  DLQ_TABLE_NAME               default event-catalog-dlq
  SUBSCRIBER_TTL_SECONDS       default 1800 (0 disables the sweeper)
  REDIS_BOOT_CONNECT_ATTEMPTS  default 3
  EVENT_CATALOG_STRICT         default false
  EVENT_CATALOG_AUTH_TOKEN     requires "Authorization: Bearer <token>" on
                               every /api request, reads included (the
                               health route excepted). Required in
                               production and whenever
                               MQ_SERVICE_AUTH_SECRET is set; unset only
                               for local development. Min 16 chars, no
                               whitespace.
  ALERT_WEBHOOK_URL            optional http(s) webhook
  DYNAMODB_ENDPOINT            optional; LocalStack / DynamoDB Local

Every one of these is validated at startup; a bad value exits 2 with a
line naming the variable rather than booting a half-configured service.

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
    // Single validated config gate. Everything the server reads out of the
    // environment is checked HERE, before any socket is opened, so a bad
    // value is one labelled line at boot instead of a NaN port bind or a
    // node-redis AggregateError with an empty message ten seconds later.
    const resolved = (0, config_js_1.resolveServerConfig)(process.env, {
        ...(parsed.args.values['port'] !== undefined ? { port: parsed.args.values['port'] } : {}),
        ...(parsed.args.values['redis-url'] !== undefined
            ? { 'redis-url': parsed.args.values['redis-url'] } : {}),
        ...(parsed.args.values['message-queue-url'] !== undefined
            ? { 'message-queue-url': parsed.args.values['message-queue-url'] } : {}),
    });
    if (!resolved.ok) {
        console.error(`${BIN}: invalid configuration — refusing to start`);
        for (const line of resolved.errors)
            console.error(`  - ${line}`);
        console.error(`usage: ${SERVER_USAGE}`);
        return 2;
    }
    for (const warning of resolved.warnings)
        console.warn(`${BIN}: ${warning}`);
    const { port, redisUrl, messageQueueUrl, authToken } = resolved.config;
    console.log('╔══════════════════════════════════════╗');
    console.log('║         event-catalog server         ║');
    console.log('╚══════════════════════════════════════╝');
    for (const line of (0, config_js_1.describeConfig)(resolved.config))
        console.log(`  ${line}`);
    // The bearer gate is built from the ALREADY-VALIDATED token, and only
    // when one is configured. With $EVENT_CATALOG_AUTH_TOKEN unset this
    // spreads nothing into the options object and startServer runs exactly
    // the unauthenticated path it always has.
    const { shutdown } = await (0, index_js_1.startServer)({
        port,
        redisUrl,
        messageQueueUrl,
        ...(authToken !== undefined
            ? { authMiddleware: (0, auth_js_1.createBearerAuthMiddleware)({ token: authToken }) }
            : {}),
    });
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