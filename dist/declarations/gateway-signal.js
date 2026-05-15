"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatewaySignalDeclarations = exports.wsError = exports.wsPipelineEvent = exports.wsPipelineHistory = exports.wsPipelineSnapshot = exports.wsPipelineAck = exports.wsPipelineUnsubscribed = exports.wsPipelineSubscribed = exports.wsCallEnded = exports.wsCallCancelled = exports.wsCallDeclined = exports.wsCallAccepted = exports.wsCallInvite = exports.wsReactionSent = exports.wsReactionReceived = exports.wsReactionSubscribed = exports.wsPresenceOffline = exports.wsPresenceData = exports.wsPresenceUnsubscribed = exports.wsPresenceSubscribed = exports.wsPresenceUpdate = exports.wsPresenceSet = exports.wsCrdtDocReplaced = exports.wsCrdtUpdate = exports.wsCrdtSnapshot = exports.wsCrdtUnsubscribed = exports.wsCrdtSubscribed = exports.wsActivityEvent = exports.wsActivityHistory = exports.wsActivityPublished = exports.wsActivityUnsubscribed = exports.wsActivitySubscribed = exports.wsCursorModes = exports.wsCursorList = exports.wsCursorRemove = exports.wsCursorUpdate = exports.wsCursorUnsubscribed = exports.wsCursorSubscribed = exports.wsChatHistory = exports.wsChatSent = exports.wsChatMessage = exports.wsChatLeft = exports.wsChatJoined = void 0;
const PRODUCER = 'websocket-gateway';
const BASE_TAGS = ['gateway', 'signal', `producer:${PRODUCER}`];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Build a loose WS frame schema with an explicit `type` value. */
function wsSchema(typeLiteral, extra = {}, required = []) {
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
exports.wsChatJoined = {
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
exports.wsChatLeft = {
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
exports.wsChatMessage = {
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
exports.wsChatSent = {
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
exports.wsChatHistory = {
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
exports.wsCursorSubscribed = {
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
exports.wsCursorUnsubscribed = {
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
exports.wsCursorUpdate = {
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
exports.wsCursorRemove = {
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
/** Current cursor list for a channel, sent in response to a `get` request. */
exports.wsCursorList = {
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
exports.wsCursorModes = {
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
exports.wsActivitySubscribed = {
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
exports.wsActivityUnsubscribed = {
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
exports.wsActivityPublished = {
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
exports.wsActivityHistory = {
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
exports.wsActivityEvent = {
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
exports.wsCrdtSubscribed = {
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
exports.wsCrdtUnsubscribed = {
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
exports.wsCrdtSnapshot = {
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
exports.wsCrdtUpdate = {
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
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
exports.wsCrdtDocReplaced = {
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
exports.wsPresenceSet = {
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
exports.wsPresenceUpdate = {
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
exports.wsPresenceSubscribed = {
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
exports.wsPresenceUnsubscribed = {
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
exports.wsPresenceData = {
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
exports.wsPresenceOffline = {
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
exports.wsReactionSubscribed = {
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
exports.wsReactionReceived = {
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
/** Confirmation sent to the sender after their reaction is broadcast. */
exports.wsReactionSent = {
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
function callSchema(action) {
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
exports.wsCallInvite = {
    name: 'ws.call.invite',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call invitation broadcast to target users (or all users when no targets specified).',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('invite'),
};
exports.wsCallAccepted = {
    name: 'ws.call.accepted',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call accepted signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('accepted'),
};
exports.wsCallDeclined = {
    name: 'ws.call.declined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call declined signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('declined'),
};
exports.wsCallCancelled = {
    name: 'ws.call.cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call cancelled signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('cancelled'),
};
exports.wsCallEnded = {
    name: 'ws.call.ended',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call ended signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('ended'),
};
// ===========================================================================
// PIPELINE WS push frames — src/services/pipeline-service.ts
//
// Frames pushed FROM the gateway TO subscribed clients (not the
// pipeline:run:* BusEvent declarations which live in pipeline*.ts).
// ===========================================================================
/** Subscription confirmation for a pipeline channel. */
exports.wsPipelineSubscribed = {
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
exports.wsPipelineUnsubscribed = {
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
exports.wsPipelineAck = {
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
exports.wsPipelineSnapshot = {
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
exports.wsPipelineHistory = {
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
exports.wsPipelineEvent = {
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
// ERROR frame — src/core/message-router.ts + all service sendError() methods
// ===========================================================================
/** Generic error frame sent when any service encounters a client-visible error. */
exports.wsError = {
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
exports.gatewaySignalDeclarations = [
    // chat
    exports.wsChatJoined,
    exports.wsChatLeft,
    exports.wsChatMessage,
    exports.wsChatSent,
    exports.wsChatHistory,
    // cursor
    exports.wsCursorSubscribed,
    exports.wsCursorUnsubscribed,
    exports.wsCursorUpdate,
    exports.wsCursorRemove,
    exports.wsCursorList,
    exports.wsCursorModes,
    // activity
    exports.wsActivitySubscribed,
    exports.wsActivityUnsubscribed,
    exports.wsActivityPublished,
    exports.wsActivityHistory,
    exports.wsActivityEvent,
    // crdt
    exports.wsCrdtSubscribed,
    exports.wsCrdtUnsubscribed,
    exports.wsCrdtSnapshot,
    exports.wsCrdtUpdate,
    exports.wsCrdtDocReplaced,
    // presence
    exports.wsPresenceSet,
    exports.wsPresenceUpdate,
    exports.wsPresenceSubscribed,
    exports.wsPresenceUnsubscribed,
    exports.wsPresenceData,
    exports.wsPresenceOffline,
    // reaction
    exports.wsReactionSubscribed,
    exports.wsReactionReceived,
    exports.wsReactionSent,
    // call
    exports.wsCallInvite,
    exports.wsCallAccepted,
    exports.wsCallDeclined,
    exports.wsCallCancelled,
    exports.wsCallEnded,
    // pipeline WS push frames
    exports.wsPipelineSubscribed,
    exports.wsPipelineUnsubscribed,
    exports.wsPipelineAck,
    exports.wsPipelineSnapshot,
    exports.wsPipelineHistory,
    exports.wsPipelineEvent,
    // error
    exports.wsError,
];
//# sourceMappingURL=gateway-signal.js.map