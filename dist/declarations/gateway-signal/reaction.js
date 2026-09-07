"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsReactionSent = exports.wsReactionList = exports.wsReactionRemoved = exports.wsReactionReceived = exports.wsReactionSubscribed = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// REACTION frames — src/realtime-fanout/reaction-service.ts
// ===========================================================================
/**
 * Sent when a client subscribes to reactions in a channel.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): the gateway dist
 * ReactionService.handleSubscribeToReactions emits this via sendSuccess, so
 * the wire frame carries success:true and data:{ channel, message,
 * availableReactions } (message was previously missing; success was undeclared).
 */
exports.wsReactionSubscribed = {
    namespace: 'ws',
    name: 'ws.reaction.subscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to reactions in a channel. GROUND TRUTH (gateway dist ReactionService.handleSubscribeToReactions → sendSuccess): { type:"reaction", action:"reaction_subscribed", success:true, data:{ channel, message, availableReactions } } — availableReactions is the emoji-name list.',
    tags: [..._shared_1.BASE_TAGS, 'reaction'],
    schema: (0, _shared_1.wsSchema)('reaction', {
        action: { type: 'string', const: 'reaction_subscribed' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                message: { type: 'string' },
                availableReactions: { type: 'array', items: { type: 'string' } },
            },
            required: ['channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to all channel subscribers when a reaction is sent. */
exports.wsReactionReceived = {
    namespace: 'ws',
    name: 'ws.reaction.received',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when an emoji reaction is sent.',
    tags: [..._shared_1.BASE_TAGS, 'reaction'],
    schema: (0, _shared_1.wsSchema)('reaction', {
        action: { type: 'string', const: 'reaction_received' },
        data: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                clientId: { type: 'string' },
                channel: { type: 'string' },
                emoji: { type: 'string' },
                effect: { type: 'string' },
            },
            required: ['emoji', 'channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to channel subscribers when a reaction is removed. */
exports.wsReactionRemoved = {
    namespace: 'ws',
    name: 'ws.reaction.removed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when a previously sent reaction is removed. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-remove action — this frame is a historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [..._shared_1.BASE_TAGS, 'reaction'],
    schema: (0, _shared_1.wsSchema)('reaction', {
        action: { type: 'string', const: 'reaction_removed' },
        data: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                clientId: { type: 'string' },
                channel: { type: 'string' },
                emoji: { type: 'string' },
            },
            required: ['id', 'channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** List of current reactions in a channel, sent in response to a list request. */
exports.wsReactionList = {
    namespace: 'ws',
    name: 'ws.reaction.list',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Current reaction list for a channel, sent in response to a list request. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-list action — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [..._shared_1.BASE_TAGS, 'reaction'],
    schema: (0, _shared_1.wsSchema)('reaction', {
        action: { type: 'string', const: 'reaction_list' },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                reactions: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/**
 * Confirmation sent to the sender after their reaction is broadcast.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): emitted via
 * sendSuccess, so the wire frame carries success:true and
 * data:{ reactionId, emoji, channel, timestamp } (the data fields and the
 * success flag were previously undeclared).
 */
exports.wsReactionSent = {
    namespace: 'ws',
    name: 'ws.reaction.sent',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Confirmation sent to the reaction sender after their reaction is broadcast. GROUND TRUTH (gateway dist ReactionService.handleSendReaction → sendSuccess): { type:"reaction", action:"reaction_sent", success:true, data:{ reactionId, emoji, channel, timestamp } }.',
    tags: [..._shared_1.BASE_TAGS, 'reaction'],
    schema: (0, _shared_1.wsSchema)('reaction', {
        action: { type: 'string', const: 'reaction_sent' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                reactionId: { type: 'string' },
                emoji: { type: 'string' },
                channel: { type: 'string' },
                timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
            },
            required: ['reactionId', 'emoji', 'channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
//# sourceMappingURL=reaction.js.map