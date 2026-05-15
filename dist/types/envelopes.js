"use strict";
/**
 * Wire envelope contracts used by signal-transport publishers.
 *
 * These shapes flow over Redis pub/sub between platform-api and
 * websocket-gateway (and any future signal-transport publisher) and are
 * defined here as the single source of truth — eliminating the prior
 * drift hazard where both ends hand-rolled the same shape independently.
 *
 * Phase 55 of the event-catalog roadmap (E2.1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastEnvelopeSchema = exports.directMessageEnvelopeSchema = exports.channelMessageEnvelopeSchema = exports.signalMessageSchema = exports.broadcastRedisChannel = void 0;
exports.buildSignalMessage = buildSignalMessage;
exports.buildChannelMessageEnvelope = buildChannelMessageEnvelope;
exports.isChannelMessageEnvelope = isChannelMessageEnvelope;
exports.channelMessageRedisChannel = channelMessageRedisChannel;
exports.channelNodesRedisKey = channelNodesRedisKey;
exports.buildDirectMessageEnvelope = buildDirectMessageEnvelope;
exports.directMessageRedisChannel = directMessageRedisChannel;
exports.buildBroadcastEnvelope = buildBroadcastEnvelope;
function buildSignalMessage(args) {
    return {
        type: args.eventName,
        channel: args.channel,
        payload: args.payload,
        timestamp: args.timestamp ?? new Date().toISOString(),
    };
}
function buildChannelMessageEnvelope(args) {
    const envelope = {
        type: 'channel_message',
        channel: args.channel,
        message: args.message,
        excludeClientId: args.excludeClientId ?? null,
        fromNode: args.fromNode,
        seq: args.seq ?? 0,
        timestamp: args.timestamp ?? new Date().toISOString(),
    };
    if (args.targetNodes !== undefined) {
        envelope.targetNodes = args.targetNodes;
    }
    return envelope;
}
function isChannelMessageEnvelope(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return (v.type === 'channel_message'
        && typeof v.channel === 'string'
        && typeof v.message === 'object'
        && v.message !== null
        && typeof v.fromNode === 'string'
        && typeof v.seq === 'number'
        && typeof v.timestamp === 'string');
}
/**
 * Redis channel pattern producers publish to and the gateway pSubscribes.
 * Exported so consumers don't hard-code the string.
 */
function channelMessageRedisChannel(channelId) {
    return `websocket:route:${channelId}`;
}
/**
 * Redis key for the set of gateway node IDs subscribed to a given channel.
 * Producers read this to populate `targetNodes`; the gateway's NodeManager
 * writes it.
 */
function channelNodesRedisKey(channelId) {
    return `websocket:channel:${channelId}:nodes`;
}
function buildDirectMessageEnvelope(args) {
    return {
        type: 'direct_message',
        clientId: args.clientId,
        message: args.message,
        fromNode: args.fromNode,
        targetNode: args.targetNode,
        timestamp: args.timestamp ?? new Date().toISOString(),
    };
}
/** Redis channel a DirectMessageEnvelope is published on. */
function directMessageRedisChannel(targetNode) {
    return `websocket:direct:${targetNode}`;
}
function buildBroadcastEnvelope(args) {
    return {
        type: 'broadcast',
        message: args.message,
        excludeClientId: args.excludeClientId ?? null,
        fromNode: args.fromNode,
        timestamp: args.timestamp ?? new Date().toISOString(),
    };
}
/** Redis channel a BroadcastEnvelope is published on (always the same). */
exports.broadcastRedisChannel = 'websocket:broadcast:all';
// ── JSON Schemas (Phase E2.1 close-out) ───────────────────────────────
//
// The TS types above describe the shape at compile time. The schemas
// below describe the same shape at runtime — for cross-language
// consumers, registry storage, and gateway-side drift guards on the
// pSubscribe path (today an envelope missing `targetNodes` would crash
// the gateway's `data.targetNodes.includes()` call; with a validator,
// the publisher can be rejected before that path runs).
//
// Schemas are draft-07. The `payload` field on SignalMessage is left
// unconstrained — per-event payload schemas live on individual
// EventDeclaration entries, not on the transport envelope.
/** JSON Schema for {@link SignalMessage}. */
exports.signalMessageSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://event-catalog/schemas/SignalMessage',
    type: 'object',
    properties: {
        type: { type: 'string' },
        channel: { type: 'string' },
        payload: {},
        timestamp: { type: 'string', format: 'date-time' },
    },
    required: ['type', 'channel', 'payload', 'timestamp'],
    additionalProperties: true,
};
/** JSON Schema for {@link ChannelMessageEnvelope}. */
exports.channelMessageEnvelopeSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://event-catalog/schemas/ChannelMessageEnvelope',
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['channel_message'] },
        channel: { type: 'string' },
        message: exports.signalMessageSchema,
        excludeClientId: { type: ['string', 'null'] },
        fromNode: { type: 'string' },
        seq: { type: 'number' },
        timestamp: { type: 'string', format: 'date-time' },
        targetNodes: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: [
        'type',
        'channel',
        'message',
        'excludeClientId',
        'fromNode',
        'seq',
        'timestamp',
    ],
    additionalProperties: false,
};
/** JSON Schema for {@link DirectMessageEnvelope}. */
exports.directMessageEnvelopeSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://event-catalog/schemas/DirectMessageEnvelope',
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['direct_message'] },
        clientId: { type: 'string' },
        message: {},
        fromNode: { type: 'string' },
        targetNode: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
    },
    required: ['type', 'clientId', 'message', 'fromNode', 'targetNode', 'timestamp'],
    additionalProperties: false,
};
/** JSON Schema for {@link BroadcastEnvelope}. */
exports.broadcastEnvelopeSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://event-catalog/schemas/BroadcastEnvelope',
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['broadcast'] },
        message: {},
        excludeClientId: { type: ['string', 'null'] },
        fromNode: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
    },
    required: ['type', 'message', 'excludeClientId', 'fromNode', 'timestamp'],
    additionalProperties: false,
};
//# sourceMappingURL=envelopes.js.map