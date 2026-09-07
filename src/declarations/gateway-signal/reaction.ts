import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

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
export const wsReactionSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to reactions in a channel. GROUND TRUTH (gateway dist ReactionService.handleSubscribeToReactions → sendSuccess): { type:"reaction", action:"reaction_subscribed", success:true, data:{ channel, message, availableReactions } } — availableReactions is the emoji-name list.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
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
export const wsReactionReceived: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.received',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when an emoji reaction is sent.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
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

/**
 * Broadcast to channel subscribers when a reaction is removed.
 *
 * CORRECTED 2026-09-07. This declaration carried a 2026-06-12 note claiming
 * the dist ReactionService the gateway runs "has NO reaction-remove action".
 * That is false and was false when the note was written: the service builds
 * the frame at realtime-modules:dist/reactions/ReactionService.js:330 (src at
 * src/reactions/ReactionService.ts:403) and useReactions filters state on it
 * at realtime-modules:src/client/useReactions.ts:163.
 *
 * The stale note hid a live (e)-class defect: `data.id` was REQUIRED and the
 * producer has never sent it, so every real removal frame failed validation.
 * The consumer does not want `id` either — it matches on the durable
 * (targetId, emoji, userId) triple precisely BECAUSE ids differ between the
 * live broadcast and the history replay.
 */
export const wsReactionRemoved: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.removed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when a previously sent reaction is removed. GROUND TRUTH (realtime-modules:dist/reactions/ReactionService.js:330, src at src/reactions/ReactionService.ts:403): { type:"reaction", action:"reaction_removed", data:{ channel, targetId, emoji, userId, timestamp } }. The removal is keyed by the durable (targetId, emoji, userId) triple, not by a reaction id — realtime-modules:src/client/useReactions.ts:163 filters on exactly that triple because ids differ between the live broadcast and the stored replay.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
        action: { type: 'string', const: 'reaction_removed' },
        data: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description:
                        'NEVER EMITTED — ReactionService builds the removal frame from the durable key '
                        + '(targetId, emoji, userId) and never assigns an id; useReactions matches on that '
                        + 'triple for the same reason. Was `required` until 2026-09-07, which rejected every '
                        + 'real removal frame. Declared-but-optional only because removing a property is '
                        + 'breaking; do not re-add it to `required`.',
                },
                clientId: { type: 'string' },
                channel: { type: 'string' },
                emoji: { type: 'string' },
                targetId: {
                    type: 'string',
                    description:
                        'Identifier of the thing the reaction was attached to (message, article, …). Half of the durable key the consumer matches on.',
                },
                userId: { type: 'string' },
                timestamp: {
                    type: 'string',
                    description: 'ISO-8601 timestamp at which the producer removed the reaction.',
                },
            },
            required: ['channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** List of current reactions in a channel, sent in response to a list request. */
export const wsReactionList: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.list',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current reaction list for a channel, sent in response to a list request. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-list action — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
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
 * Durable reaction replay, sent to ONE client on subscribe.
 *
 * DECLARED 2026-09-07. This is the frame that actually replays stored
 * reactions, and until now it was invisible to the catalog: the only
 * replay event declared was `ws.reaction.list` (action `reaction_list`),
 * an action no producer uses. So the catalog documented a frame that never
 * arrives and said nothing about the one that carries the data.
 *
 * Producer: realtime-modules:src/reactions/ReactionService.ts:473
 * (`_replayStoredReactions` → `sendSuccess(clientId, 'reaction_history', …)`,
 * so the frame gets `success: true` from `sendSuccess` at :537).
 * Consumer: realtime-modules:src/client/useReactions.ts:143, which REPLACES
 * its list rather than appending — this frame is the state, not more events.
 *
 * Transport is `signal`: it is addressed to a single live socket at
 * subscribe time and is meaningless once that connection is gone. The
 * durability lives in the store the rows are read from, not in this frame.
 *
 * `required` is deliberately just `{channel}` on `data`. The consumer's
 * guard is `data.channel === channel && Array.isArray(data.reactions)`, and
 * a channel with no stored reactions still gets a frame — with `reactions`
 * present but empty, never absent — so requiring more would reject nothing
 * real while risking a future emitter that omits the empty array.
 */
export const wsReactionHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Durable reaction replay delivered to one client when it subscribes to a channel. GROUND TRUTH (realtime-modules:src/reactions/ReactionService.ts:473 `_replayStoredReactions` via sendSuccess): { type:"reaction", action:"reaction_history", success:true, data:{ channel, reactions } }. Each row is rehydrated into full Reaction shape by `_fromStored` (:452), whose `id` is DERIVED from the durable key so replaying twice cannot look like two reactions. realtime-modules:src/client/useReactions.ts:143 REPLACES its reaction list with this payload — it is the channel state, not additional events. This is the frame the previously declared ws.reaction.list (action "reaction_list") was mistaken for; no producer uses that action.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
        action: { type: 'string', const: 'reaction_history' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                reactions: {
                    type: 'array',
                    description:
                        'Stored reactions for the channel, oldest first, capped by the service\'s maxHistoryReplay. Present and empty when nothing is stored.',
                    items: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description:
                                    'Identifier derived from the durable key (`reaction_<targetId>_<emoji>_<userId>`), so a re-replay is recognisably the same fact rather than a new one.',
                            },
                            clientId: { type: 'string' },
                            channel: { type: 'string' },
                            emoji: { type: 'string' },
                            effect: {
                                type: 'string',
                                description:
                                    'Visual effect to play alongside the reaction, resolved from the service\'s emoji catalog. Empty string when the emoji has no catalog entry.',
                            },
                            position: {
                                description:
                                    'Screen position the reaction was placed at, when the sender supplied one. Always null on a replayed row — the store does not keep it.',
                            },
                            metadata: {},
                            timestamp: {
                                type: 'string',
                                description: 'ISO-8601 timestamp at which the reaction was originally sent.',
                            },
                            targetId: {
                                type: 'string',
                                description:
                                    'Identifier of the thing the reaction is attached to. A reaction is only durable when it names one, so every replayed row carries it.',
                            },
                            userId: { type: 'string' },
                            displayName: { type: 'string' },
                        },
                        required: ['id', 'clientId', 'channel', 'emoji'],
                        additionalProperties: true,
                    },
                },
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
export const wsReactionSent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.sent',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to the reaction sender after their reaction is broadcast. GROUND TRUTH (gateway dist ReactionService.handleSendReaction → sendSuccess): { type:"reaction", action:"reaction_sent", success:true, data:{ reactionId, emoji, channel, timestamp } }.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
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
