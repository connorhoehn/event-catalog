"use strict";
// src/server/asyncapi.ts
//
// wave24-c — generate an AsyncAPI 3.0 spec from the registry. Lets
// operators feed catalog declarations into existing AsyncAPI tooling
// (codegen, validators, doc renderers) without adopting a separate
// schema-of-record.
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
//   transport: 'signal'        → channel binding: redis pub/sub
//   transport: 'durable'       → channel binding: messaging-queue
//   transport: 'both'          → two operations on two channels (signal + durable)
//   namespace                 → channel grouping (one channel per namespace)
//
// We don't use AsyncAPI's protocol bindings spec rigorously — Redis +
// the platform's MQ aren't in the bindings catalog. The `bindings`
// field is left as a stub that names the protocol so external
// tooling can recognize it without false-precision claims.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAsyncApiSpec = buildAsyncApiSpec;
function buildAsyncApiSpec(registry, opts = {}) {
    const entries = registry.list(opts.namespace ? { namespace: opts.namespace } : undefined);
    const channels = {};
    const operations = {};
    const messages = {};
    const schemas = {};
    for (const entry of entries) {
        const transports = entry.transport === 'both'
            ? ['signal', 'durable']
            : [entry.transport];
        for (const transport of transports) {
            const channelKey = channelKeyFor(transport, entry);
            const messageKey = messageKeyFor(entry, transport);
            const schemaKey = schemaKeyFor(entry);
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
                    payload: { $ref: `#/components/schemas/${schemaKey}` },
                };
            }
            // Channels — one per (transport, eventName). Address mirrors the
            // resolved channel pattern (signal: declared `channel` or event
            // name; durable: queue name or event-derived default).
            if (!channels[channelKey]) {
                channels[channelKey] = {
                    address: addressFor(transport, entry),
                    messages: { [messageKey]: { $ref: `#/components/messages/${messageKey}` } },
                    bindings: {
                        [transport === 'signal' ? 'redis' : 'mq']: { 'x-event-catalog-transport': transport },
                    },
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
                    summary: `${producer} publishes ${entry.name}`,
                    ...(entry.description ? { description: entry.description } : {}),
                    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags.map((name) => ({ name })) } : {}),
                };
            }
        }
    }
    return {
        asyncapi: '3.0.0',
        info: {
            title: opts.title ?? 'event-catalog',
            version: opts.version ?? '0.0.0',
            description: 'Auto-generated from the event-catalog registry. Source of truth for cross-service event contracts.',
        },
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
    return entry.queue ?? entry.name;
}
//# sourceMappingURL=asyncapi.js.map