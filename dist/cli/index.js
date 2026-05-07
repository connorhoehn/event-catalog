#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("../server/index.js");
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1])
        return args[idx + 1];
    return defaultValue;
}
const port = parseInt(getArg('port', process.env.PORT ?? '3010'));
const redisUrl = getArg('redis-url', process.env.REDIS_URL ?? 'redis://localhost:6379');
const messageQueueUrl = getArg('message-queue-url', process.env.MESSAGE_QUEUE_URL ?? 'http://localhost:3004');
console.log('╔══════════════════════════════════════╗');
console.log('║        event-catalog v0.1.0          ║');
console.log('╚══════════════════════════════════════╝');
const { shutdown } = await (0, index_js_1.startServer)({ port, redisUrl, messageQueueUrl });
process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
});
//# sourceMappingURL=index.js.map