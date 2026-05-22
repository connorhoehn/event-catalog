// src/declarations/gateway-signal.ts
//
// M1 milestone — declare all WebSocket frame types that websocket-gateway
// sends to clients as `signal` events in the event-catalog.
//
// These are ephemeral WS push frames (not durable). Every declaration here
// uses:
//   transport: 'signal'
//   producer:  'websocket-gateway'
//   tags:      ['gateway', 'signal', 'producer:websocket-gateway', <service>]
//
// Naming convention: ws.<service>.<action>
//   - action comes from the frame's `action` field where applicable
//   - for frames with a `type` of form `<service>:<variant>` (e.g.
//     `crdt:update`, `pipeline:event`) the name mirrors the type form
//
// Schema philosophy: additionalProperties: true throughout — these frames
// are produced by JS service objects whose shapes are loose. Required fields
// are only listed where a field is structurally guaranteed by every code path.
//
// Cross-reference: gateway source files scanned at commit ~f5ccd0c:
//   src/realtime-fanout/{chat,cursor,activity,crdt,presence,reaction}-service.ts
//   src/services/{call,pipeline}-service.ts
//   src/core/message-router.ts

import type { EventDeclaration } from '../types/index';

const PRODUCER = 'websocket-gateway';
const BASE_TAGS = ['gateway', 'signal', `producer:${PRODUCER}`];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a loose WS frame schema with an explicit `type` value. */
function wsSchema(
    typeLiteral: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: typeLiteral },
            timestamp: { type: 'string', description: 'ISO-8601' },
            ...extra,
        },
        required: ['type', ...required],
        additionalProperties: true,
    };
}

// ===========================================================================
// CHAT frames — src/realtime-fanout/chat-service.ts
// ===========================================================================

/** Sent to the joining client after they successfully join a chat channel. */
export const wsChatJoined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.joined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when they successfully join a chat channel.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'joined' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Sent to the leaving client after they successfully leave a chat channel. */
export const wsChatLeft: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.left',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when they leave a chat channel.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'left' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Broadcast to all channel subscribers when a new chat message is posted. */
export const wsChatMessage: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.message',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all channel subscribers when a new chat message is posted.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'message' },
        channel: { type: 'string' },
        message: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'message']),
};

/** Confirmation sent to the message sender after their message is stored+broadcast. */
export const wsChatSent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.sent',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to the message sender after their message is stored and broadcast.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'sent' },
        channel: { type: 'string' },
        messageId: { type: 'string' },
    }, ['action', 'channel', 'messageId']),
};

/** Recent message history delivered to a client on join or explicit history request. */
export const wsChatHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.chat.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Recent message history delivered to a client on channel join or explicit history request.',
    tags: [...BASE_TAGS, 'chat'],
    schema: wsSchema('chat', {
        action: { type: 'string', const: 'history' },
        channel: { type: 'string' },
        messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'messages']),
};

// ===========================================================================
// CURSOR frames — src/realtime-fanout/cursor-service.ts
// ===========================================================================

/** Subscription confirmation + current snapshot of all cursors in the channel. */
export const wsCursorSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent with current cursors for the channel.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation. */
export const wsCursorUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from cursor channel.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Broadcast when a client moves their cursor (throttled). */
export const wsCursorUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to channel subscribers when a client updates their cursor position.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'update' },
        channel: { type: 'string' },
        cursor: { type: 'object', additionalProperties: true },
    }, ['action', 'channel', 'cursor']),
};

/** Broadcast when a client disconnects and their cursor should be removed. */
export const wsCursorRemove: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.remove',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast when a client disconnects and their cursor should be removed from the canvas.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'remove' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};

/** Broadcast to all channel subscribers when a client clears their cursor. */
export const wsCursorClear: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.clear',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to channel subscribers when a client clears (removes) their cursor from the canvas.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'clear' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};

/** Batched cursor position update for multiple clients, sent as a single frame. */
export const wsCursorBatch: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.batch',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Batched cursor positions for multiple clients delivered in a single frame to reduce message volume.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'batch' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'cursors']),
};

/** Current cursor list for a channel, sent in response to a `get` request. */
export const wsCursorList: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.cursors',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current cursor list for a channel, sent in response to a get request.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'cursors' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Supported cursor modes (freeform, table, text, canvas). */
export const wsCursorModes: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.cursor.modes',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Supported cursor tracking modes sent to a client on request.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'modes' },
        modes: { type: 'object', additionalProperties: true },
    }, ['action']),
};

// ===========================================================================
// ACTIVITY frames — src/realtime-fanout/activity-service.ts
// ===========================================================================

/** Subscription confirmation for an activity channel. */
export const wsActivitySubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation for an activity channel.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'subscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};

/** Unsubscription confirmation for an activity channel. */
export const wsActivityUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation for an activity channel.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'unsubscribed' },
        channelId: { type: 'string' },
    }, ['action', 'channelId']),
};

/** Confirmation sent to the publishing client after their activity event is broadcast. */
export const wsActivityPublished: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.published',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent back to the client that published an activity event.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'published' },
        eventType: { type: 'string' },
    }, ['action', 'eventType']),
};

/** History response for an activity channel. */
export const wsActivityHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Recent activity history delivered to a client on request.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity', {
        action: { type: 'string', const: 'history' },
        channelId: { type: 'string' },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channelId', 'events']),
};

/**
 * Broadcast to all subscribers of `activity:broadcast` when an activity event fires.
 * Note: this frame uses type `activity:event`, not `activity`.
 */
export const wsActivityEvent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.activity.event',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all subscribers of activity:broadcast when an activity event is published.',
    tags: [...BASE_TAGS, 'activity'],
    schema: wsSchema('activity:event', {
        payload: {
            type: 'object',
            properties: {
                eventType: { type: 'string' },
                detail: { type: 'object', additionalProperties: true },
                timestamp: { type: 'string' },
                userId: { type: ['string', 'null'] },
                displayName: { type: 'string' },
            },
            required: ['eventType'],
            additionalProperties: true,
        },
    }, ['payload']),
};

// ===========================================================================
// CRDT frames — src/realtime-fanout/crdt-service.ts
// ===========================================================================

/** Subscription confirmation after a client subscribes to a CRDT channel. */
export const wsCrdtSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client joins a CRDT channel.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation after a client leaves a CRDT channel. */
export const wsCrdtUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation sent when a client leaves a CRDT channel.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/**
 * Full Y.Doc state snapshot pushed to a client on subscribe or explicit getSnapshot.
 * Note: frame type is `crdt:snapshot`.
 */
export const wsCrdtSnapshot: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Full Y.Doc state (base64 encoded) pushed to a client on channel subscribe or explicit snapshot request.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:snapshot', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded Y.js state update' },
    }, ['channel', 'snapshot']),
};

/**
 * CRDT update broadcast to all channel subscribers (excluding the sender).
 * Note: frame type is `crdt:update`.
 */
export const wsCrdtUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Y.js update broadcast to all CRDT channel subscribers, excluding the sender.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:update', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update' },
    }, ['channel', 'update']),
};

/**
 * Client-initiated request to sync Y.js state with a peer.
 * Note: frame type is `crdt:sync-request`.
 */
export const wsCrdtSyncRequest: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.sync-request',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Client-initiated Y.js state vector sent to the gateway to request missing updates from peers.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:sync-request', {
        channel: { type: 'string' },
        stateVector: { type: 'string', description: 'base64-encoded Y.js state vector' },
    }, ['channel', 'stateVector']),
};

/**
 * Gateway response to a sync-request, containing the missing Y.js updates.
 * Note: frame type is `crdt:sync-response`.
 */
export const wsCrdtSyncResponse: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.sync-response',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Gateway response to a sync-request containing the Y.js updates needed to bring the client up to date.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:sync-response', {
        channel: { type: 'string' },
        update: { type: 'string', description: 'base64-encoded Y.js update diff' },
    }, ['channel', 'update']),
};

/**
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
export const wsCrdtDocReplaced: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.doc-replaced',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all CRDT channel subscribers when a snapshot restore replaces the document state.',
    tags: [...BASE_TAGS, 'crdt'],
    schema: wsSchema('crdt:doc-replaced', {
        channel: { type: 'string' },
        snapshot: { type: 'string', description: 'base64-encoded restored state' },
    }, ['channel']),
};

// ===========================================================================
// PRESENCE frames — src/realtime-fanout/presence-service.ts
// ===========================================================================

/** Sent to the client when their presence is successfully set/updated. */
export const wsPresenceSet: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.set',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to a client when their presence status is successfully set.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'set' },
        presence: { type: 'object', additionalProperties: true },
    }, ['action']),
};

/** Broadcast to channel subscribers when a client's presence changes. */
export const wsPresenceUpdate: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.update',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to presence channel subscribers when a client\'s presence status changes.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'update' },
        presence: { type: 'object', additionalProperties: true },
    }, ['action']),
};

/** Subscription confirmation + current presence snapshot for the channel. */
export const wsPresenceSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation with current presence snapshot for the channel.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
        presence: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation from a presence channel. */
export const wsPresenceUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from a presence channel.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Presence data response to a get request (specific client or channel). */
export const wsPresenceData: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.data',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presence data returned in response to a get-presence request.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'presence' },
        data: {},
    }, ['action']),
};

/** Broadcast when a client goes offline (disconnects or times out). */
export const wsPresenceOffline: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.offline',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to presence channel subscribers when a client disconnects or times out.',
    tags: [...BASE_TAGS, 'presence'],
    schema: wsSchema('presence', {
        action: { type: 'string', const: 'offline' },
        clientId: { type: 'string' },
    }, ['action', 'clientId']),
};

// ===========================================================================
// REACTION frames — src/realtime-fanout/reaction-service.ts
// ===========================================================================

/** Sent when a client subscribes to reactions in a channel. */
export const wsReactionSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to reactions in a channel.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
        action: { type: 'string', const: 'reaction_subscribed' },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                availableReactions: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: true,
        },
    }, ['action']),
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

/** Broadcast to channel subscribers when a reaction is removed. */
export const wsReactionRemoved: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.removed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when a previously sent reaction is removed.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
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
export const wsReactionList: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.list',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current reaction list for a channel, sent in response to a list request.',
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

/** Confirmation sent to the sender after their reaction is broadcast. */
export const wsReactionSent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.sent',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Confirmation sent to the reaction sender after their reaction is broadcast.',
    tags: [...BASE_TAGS, 'reaction'],
    schema: wsSchema('reaction', {
        action: { type: 'string', const: 'reaction_sent' },
        data: { type: 'object', additionalProperties: true },
    }, ['action']),
};

// ===========================================================================
// CALL frames — src/services/call-service.ts
//
// All five call signaling actions share the same envelope shape.
// Each is declared separately so the catalog can track cardinality
// per action.
// ===========================================================================

function callSchema(action: string): Record<string, unknown> {
    return wsSchema('call', {
        action: { type: 'string', const: action },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                lobbyName: { type: 'string' },
                targetUserIds: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: true,
        },
    }, ['action']);
}

export const wsCallInvite: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.invite',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call invitation broadcast to target users (or all users when no targets specified).',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('invite'),
};

export const wsCallAccepted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.accepted',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call accepted signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('accepted'),
};

export const wsCallDeclined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.declined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call declined signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('declined'),
};

export const wsCallCancelled: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call cancelled signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('cancelled'),
};

export const wsCallEnded: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.ended',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call ended signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('ended'),
};

/** Broadcast when a participant enables their video feed. */
export const wsCallVideoOn: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.video-on',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to call participants when a participant enables their video feed.',
    tags: [...BASE_TAGS, 'call'],
    schema: wsSchema('call', {
        action: { type: 'string', const: 'video-on' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                participantId: { type: 'string' },
                userId: { type: 'string' },
            },
            required: ['callId', 'participantId'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** Broadcast when a participant disables their video feed. */
export const wsCallVideoOff: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.call.video-off',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to call participants when a participant disables their video feed.',
    tags: [...BASE_TAGS, 'call'],
    schema: wsSchema('call', {
        action: { type: 'string', const: 'video-off' },
        data: {
            type: 'object',
            properties: {
                callId: { type: 'string' },
                participantId: { type: 'string' },
                userId: { type: 'string' },
            },
            required: ['callId', 'participantId'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

// ===========================================================================
// PIPELINE WS push frames — src/services/pipeline-service.ts
//
// Frames pushed FROM the gateway TO subscribed clients (not the
// pipeline:run:* BusEvent declarations which live in pipeline*.ts).
// ===========================================================================

/** Subscription confirmation for a pipeline channel. */
export const wsPipelineSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to a pipeline channel.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation for a pipeline channel. */
export const wsPipelineUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from a pipeline channel.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/**
 * Acknowledgement frame for client-initiated pipeline actions
 * (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).
 * Note: frame type is `pipeline:ack`.
 */
export const wsPipelineAck: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.ack',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Acknowledgement frame for client-initiated pipeline commands (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:ack', {
        action: { type: 'string' },
        runId: { type: 'string' },
        correlationId: {},
    }, ['action']),
};

/**
 * Pipeline run state snapshot sent in response to a `getRun` request.
 * Note: frame type is `pipeline:snapshot`.
 */
export const wsPipelineSnapshot: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.snapshot',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current pipeline run state sent in response to a getRun request.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:snapshot', {
        runId: { type: 'string' },
        run: { type: ['object', 'null'], additionalProperties: true },
        correlationId: {},
    }, ['runId']),
};

/**
 * BusEvent history for a run, sent in response to a `getHistory` request.
 * Note: frame type is `pipeline:history`.
 */
export const wsPipelineHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'BusEvent history for a pipeline run sent in response to a getHistory request.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:history', {
        runId: { type: 'string' },
        fromVersion: { type: 'number' },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
        correlationId: {},
    }, ['runId', 'events']),
};

/**
 * Pipeline BusEvent broadcast to channel subscribers by PipelineBridge.
 * Note: frame type is `pipeline:event`.
 */
export const wsPipelineEvent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.event',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Pipeline BusEvent fan-out frame delivered to channel subscribers (pipeline:run:{runId}, pipeline:all, pipeline:approvals).',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:event', {
        eventType: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
        channel: { type: 'string' },
        seq: { type: 'number' },
        sourceNodeId: { type: 'string' },
        emittedAt: { type: 'number' },
    }, ['eventType', 'channel']),
};

// ===========================================================================
// UPLOAD frames — presigned URL upload lifecycle pushed via WebSocket
// ===========================================================================

/** Acknowledgement that the gateway received a file upload request and is issuing a presigned URL. */
export const wsUploadRequested: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.requested',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Acknowledgement sent when the gateway receives a file upload request from a client.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'requested' },
        data: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                channel: { type: 'string' },
                filename: { type: 'string' },
                size: { type: 'number' },
                mimeType: { type: 'string' },
            },
            required: ['clientId', 'channel', 'filename'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** Presigned upload URL issued to the requesting client. */
export const wsUploadUrlIssued: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.url-issued',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Presigned S3 upload URL issued to the client so they can PUT the file directly.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'url-issued' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                presignedUrl: { type: 'string' },
                expiresAt: { type: 'string', description: 'ISO-8601' },
            },
            required: ['uploadId', 'presignedUrl', 'expiresAt'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** Broadcast to the channel when a file upload completes successfully. */
export const wsUploadCompleted: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.completed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to the channel when a file upload completes and a download URL is available.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'completed' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                downloadUrl: { type: 'string' },
            },
            required: ['uploadId', 'downloadUrl'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** Sent to the uploading client when a file upload fails. */
export const wsUploadFailed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.failed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when the file upload fails at any stage.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'failed' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                error: { type: 'string' },
            },
            required: ['uploadId', 'error'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/** Sent to the channel after a security scan completes on the uploaded file. */
export const wsUploadScanned: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.upload.scanned',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the channel after a security scan completes on the uploaded file, reporting clean or infected status.',
    tags: [...BASE_TAGS, 'upload'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'scanned' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                status: { type: 'string', enum: ['clean', 'infected'] },
            },
            required: ['uploadId', 'status'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

// ===========================================================================
// ERROR frame — src/core/message-router.ts + all service sendError() methods
// ===========================================================================

/** Generic error frame sent when any service encounters a client-visible error. */
export const wsError: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.error',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Generic error frame sent to a client when any gateway service encounters a client-visible error.',
    tags: [...BASE_TAGS, 'error'],
    schema: wsSchema('error', {
        service: { type: 'string', description: 'The service that generated the error (chat, cursor, presence, etc.)' },
        code: { type: 'string' },
        message: { type: 'string' },
    }, []),
};

// ===========================================================================
// Aggregate export
// ===========================================================================

/**
 * All gateway WS signal frame declarations.
 * Pass to `catalog.declare()` at boot to register every frame type the
 * websocket-gateway sends to clients.
 */
export const gatewaySignalDeclarations: EventDeclaration[] = [
    // chat
    wsChatJoined,
    wsChatLeft,
    wsChatMessage,
    wsChatSent,
    wsChatHistory,
    // cursor
    wsCursorSubscribed,
    wsCursorUnsubscribed,
    wsCursorUpdate,
    wsCursorRemove,
    wsCursorList,
    wsCursorModes,
    wsCursorClear,
    wsCursorBatch,
    // activity
    wsActivitySubscribed,
    wsActivityUnsubscribed,
    wsActivityPublished,
    wsActivityHistory,
    wsActivityEvent,
    // crdt
    wsCrdtSubscribed,
    wsCrdtUnsubscribed,
    wsCrdtSnapshot,
    wsCrdtUpdate,
    wsCrdtDocReplaced,
    wsCrdtSyncRequest,
    wsCrdtSyncResponse,
    // presence
    wsPresenceSet,
    wsPresenceUpdate,
    wsPresenceSubscribed,
    wsPresenceUnsubscribed,
    wsPresenceData,
    wsPresenceOffline,
    // reaction
    wsReactionSubscribed,
    wsReactionReceived,
    wsReactionRemoved,
    wsReactionList,
    wsReactionSent,
    // call
    wsCallInvite,
    wsCallAccepted,
    wsCallDeclined,
    wsCallCancelled,
    wsCallEnded,
    wsCallVideoOn,
    wsCallVideoOff,
    // upload
    wsUploadRequested,
    wsUploadUrlIssued,
    wsUploadCompleted,
    wsUploadFailed,
    wsUploadScanned,
    // pipeline WS push frames
    wsPipelineSubscribed,
    wsPipelineUnsubscribed,
    wsPipelineAck,
    wsPipelineSnapshot,
    wsPipelineHistory,
    wsPipelineEvent,
    // error
    wsError,
];
