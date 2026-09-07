"use strict";
// src/server/asyncapi.ts
//
// wave24-c — generate an AsyncAPI 3.0 spec from the registry. Lets
// operators feed catalog declarations into existing AsyncAPI tooling
// (codegen, validators, doc renderers) without adopting a separate
// schema-of-record.
//
// Two callers, one builder:
//   - `GET /api/asyncapi` renders it live from whatever is registered now.
//   - `scripts/generate-asyncapi.ts` renders it offline over
//     `allDeclarations` and commits the result as
//     `contracts/asyncapi.registry.yaml`.
// Sharing the builder is deliberate: the published artifact and the live
// endpoint cannot describe the backbone differently.
//
// Mapping conventions:
//
//   declaration               → AsyncAPI primitive
//   ---------------------------+--------------------------------
//   name                      → operation.operationId, message.name
//   description               → operation.summary, message.description
//   tags                      → message.tags
//   producer (string|string[]) → operation.action: 'send' (one operation per producer)
//   schema                    → message.payload  (JSON Schema directly — same draft)
//   transport: 'signal'        → channel on the Redis pub/sub server
//   transport: 'durable'       → channel on the message-queue server
//   transport: 'both'          → two operations on two channels (signal + durable)
//   aliases                   → message['x-aliases']
//   deprecation               → message['x-deprecated'] + a `deprecated` tag
//
// BINDINGS, HONESTLY. AsyncAPI's bindings catalog has a `redis` entry
// (reserved, no properties yet) and nothing at all for this platform's
// message-queue. Earlier revisions invented a `bindings.mq` key, which is
// not a protocol any tool recognizes — false precision. So: signal channels
// carry the real (empty) `redis` binding, durable channels carry none, and
// BOTH carry `x-event-catalog-transport` plus a `servers` reference, which
// is where the transport fact actually belongs in 3.0.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASYNCAPI_SERVER_KEYS = void 0;
exports.buildAsyncApiSpec = buildAsyncApiSpec;
const durable_js_1 = require("../client/durable.js");
/**
 * Server keys. Exported so a generator can assert it referenced the servers
 * it thinks it did.
 */
exports.ASYNCAPI_SERVER_KEYS = {
    signal: 'signalRedis',
    durable: 'durableMessageQueue',
};
function serverDefinitions() {
    return {
        [exports.ASYNCAPI_SERVER_KEYS.signal]: {
            host: '{redisHost}:{redisPort}',
            protocol: 'redis',
            description: 'Redis pub/sub — the ephemeral "signal" transport. A signal event is fire-and-forget: '
                + 'no persistence, no retry, no delivery guarantee. Subscribers that are not connected at '
                + 'publish time never see the message. Configured via REDIS_URL.',
            variables: {
                redisHost: { default: 'localhost', description: 'Redis host from REDIS_URL.' },
                redisPort: { default: '6379', description: 'Redis port from REDIS_URL.' },
            },
        },
        [exports.ASYNCAPI_SERVER_KEYS.durable]: {
            host: '{messageQueueHost}',
            protocol: 'http',
            protocolVersion: '1.1',
            pathname: '/api/v1/queues',
            description: 'The @connorhoehn/message-queue service — the persisted, retryable "durable" transport. '
                + 'Producers POST an envelope to /api/v1/queues/{queue}/messages; consumers long-poll the '
                + 'same queue. Messages survive a consumer restart and dead-letter after the declared '
                + 'attempt budget. Configured via MESSAGE_QUEUE_URL.',
            variables: {
                messageQueueHost: {
                    default: 'localhost:3004',
                    description: 'message-queue host:port from MESSAGE_QUEUE_URL.',
                },
            },
        },
    };
}
function buildAsyncApiSpec(registry, opts = {}) {
    const excluded = new Set(opts.excludeNamespaces ?? []);
    const entries = registry
        .list(opts.namespace ? { namespace: opts.namespace } : undefined)
        .filter((entry) => !excluded.has(entry.namespace));
    const channels = {};
    const operations = {};
    const messages = {};
    const schemas = {};
    const usedServers = new Set();
    for (const entry of entries) {
        const transports = entry.transport === 'both'
            ? ['signal', 'durable']
            : [entry.transport];
        for (const transport of transports) {
            const channelKey = channelKeyFor(transport, entry);
            const messageKey = messageKeyFor(entry, transport);
            const schemaKey = schemaKeyFor(entry);
            const serverKey = exports.ASYNCAPI_SERVER_KEYS[transport];
            usedServers.add(serverKey);
            // Schemas — dedupe by event name (one schema per event regardless of transport).
            if (!schemas[schemaKey]) {
                schemas[schemaKey] = entry.schema;
            }
            // Messages — dedupe similarly. Per-transport message refs the same schema.
            // wave25-a — deprecated events get a synthetic 'deprecated' tag so any
            // AsyncAPI consumer (Studio, codegen, lint) can surface the warning.
            if (!messages[messageKey]) {
                const baseTags = (entry.tags ?? []).map((name) => ({ name }));
                const tags = entry.deprecation
                    ? [...baseTags, { name: 'deprecated', description: entry.deprecation.reason ?? 'Deprecated event.' }]
                    : baseTags;
                messages[messageKey] = {
                    name: entry.name,
                    title: entry.name,
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(tags.length > 0 ? { tags } : {}),
                    ...(entry.deprecation ? { 'x-deprecated': entry.deprecation } : {}),
                    // A deprecated alias is a name still on the wire. Omitting it means
                    // a consumer written from this document silently drops those
                    // messages, so it is emitted even though AsyncAPI has no native
                    // slot for "this message also arrives under these older names".
                    ...(entry.aliases && entry.aliases.length > 0 ? { 'x-aliases': entry.aliases } : {}),
                    payload: { $ref: `#/components/schemas/${schemaKey}` },
                };
            }
            // Channels — one per (transport, eventName). Address mirrors the
            // resolved channel pattern (signal: declared `channel` or event name;
            // durable: declared `queue` or the name-derived queue), and points at
            // the server that address is valid on.
            if (!channels[channelKey]) {
                channels[channelKey] = {
                    address: addressFor(transport, entry),
                    title: entry.name,
                    ...(entry.description ? { description: entry.description } : {}),
                    servers: [{ $ref: `#/servers/${serverKey}` }],
                    messages: { [messageKey]: { $ref: `#/components/messages/${messageKey}` } },
                    // See the BINDINGS note in the file header: `redis` is a real (empty)
                    // AsyncAPI binding; the platform MQ has none, so durable channels
                    // get no `bindings` object rather than an invented one.
                    ...(transport === 'signal' ? { bindings: { redis: {} } } : {}),
                    'x-event-catalog-transport': transport,
                    ...(transport === 'durable'
                        ? {
                            'x-event-catalog-queue-source': entry.queue ? 'declared' : 'derived-from-event-name',
                            ...(entry.fifo ? { 'x-event-catalog-fifo': true } : {}),
                            ...(entry.retention ? { 'x-event-catalog-retention-seconds': entry.retention } : {}),
                            ...(entry.dlqAfterAttempts
                                ? { 'x-event-catalog-dlq-after-attempts': entry.dlqAfterAttempts }
                                : {}),
                        }
                        : {}),
                    ...(transport === 'signal' && !entry.channel
                        ? { 'x-event-catalog-channel-source': 'derived-from-event-name' }
                        : {}),
                };
            }
            // Operations — one per producer. AsyncAPI 3.0 splits "send" /
            // "receive" but with a producer-only registry we always emit
            // 'send' operations; subscribers can be inferred from the
            // separate /api/subscribers surface.
            const producers = Array.isArray(entry.producer) ? entry.producer : [entry.producer];
            for (const producer of producers) {
                const opKey = operationKeyFor(producer, entry, transport);
                operations[opKey] = {
                    action: 'send',
                    channel: { $ref: `#/channels/${channelKey}` },
                    messages: [{ $ref: `#/channels/${channelKey}/messages/${messageKey}` }],
                    title: `${producer} → ${entry.name}`,
                    summary: `${producer} publishes ${entry.name}`,
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags.map((name) => ({ name })) } : {}),
                };
            }
        }
    }
    const allServers = serverDefinitions();
    const servers = {};
    for (const key of Object.keys(allServers)) {
        // Only ship a server some channel actually sits on — an unreferenced
        // server is an orphan, and orphans are what make a spec untrustworthy.
        if (usedServers.has(key))
            servers[key] = allServers[key];
    }
    return {
        asyncapi: '3.0.0',
        info: {
            title: opts.title ?? 'event-catalog',
            version: opts.version ?? '0.0.0',
            description: opts.description
                ?? 'Auto-generated from the event-catalog registry. Source of truth for cross-service event contracts.',
            ...(opts.infoExtensions ?? {}),
        },
        ...(opts.externalDocs ? { externalDocs: opts.externalDocs } : {}),
        defaultContentType: 'application/json',
        servers,
        channels,
        operations,
        components: {
            messages,
            schemas,
        },
    };
}
function asyncSafeId(s) {
    // AsyncAPI-3 ids must be JSON-pointer-safe. Convert : / . / - to _.
    return s.replace(/[^A-Za-z0-9_]/g, '_');
}
function channelKeyFor(transport, entry) {
    return asyncSafeId(`${transport}__${entry.name}`);
}
function messageKeyFor(entry, transport) {
    return asyncSafeId(`${transport}__${entry.name}__msg`);
}
function schemaKeyFor(entry) {
    return asyncSafeId(`${entry.name}__schema`);
}
function operationKeyFor(producer, entry, transport) {
    return asyncSafeId(`${transport}__${entry.name}__send_by__${producer}`);
}
function addressFor(transport, entry) {
    if (transport === 'signal') {
        return typeof entry.channel === 'string' ? entry.channel : entry.name;
    }
    // Must match the publish path exactly (`EventCatalog.publish`:
    // `entry.queue ?? DurableTransport.eventNameToQueueName(name)`). The old
    // fallback here was the raw event name, which is NOT a queue name —
    // `activity.recorded` publishes to `activity-recorded`.
    return entry.queue ?? durable_js_1.DurableTransport.eventNameToQueueName(entry.name);
}
//# sourceMappingURL=asyncapi.js.map