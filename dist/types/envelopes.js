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
exports.buildSignalMessage = buildSignalMessage;
exports.buildChannelMessageEnvelope = buildChannelMessageEnvelope;
exports.isChannelMessageEnvelope = isChannelMessageEnvelope;
exports.channelMessageRedisChannel = channelMessageRedisChannel;
exports.channelNodesRedisKey = channelNodesRedisKey;
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
//# sourceMappingURL=envelopes.js.map