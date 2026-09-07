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
exports.wsPipelineAck = exports.wsPipelineUnsubscribed = exports.wsPipelineSubscribed = exports.wsCallRecordingCompleted = exports.wsCallRecordingStarted = exports.wsCallVideoOff = exports.wsCallVideoOn = exports.wsCallEnded = exports.wsCallCancelled = exports.wsCallDeclined = exports.wsCallAccepted = exports.wsCallInvite = exports.wsReactionSent = exports.wsReactionList = exports.wsReactionRemoved = exports.wsReactionReceived = exports.wsReactionSubscribed = exports.wsPresenceOffline = exports.wsPresenceData = exports.wsPresenceUnsubscribed = exports.wsPresenceSubscribed = exports.wsPresenceUpdate = exports.wsPresenceSet = exports.wsCrdtAwarenessBatch = exports.wsCrdtSnapshotStored = exports.wsCrdtDocReplaced = exports.wsCrdtSyncResponse = exports.wsCrdtSyncRequest = exports.wsCrdtUpdate = exports.wsCrdtSnapshot = exports.wsCrdtUnsubscribed = exports.wsCrdtSubscribed = exports.wsActivityEvent = exports.wsActivityHistory = exports.wsActivityPublished = exports.wsActivityUnsubscribed = exports.wsActivitySubscribed = exports.wsCursorModes = exports.wsCursorList = exports.wsCursorBatch = exports.wsCursorClear = exports.wsCursorRemove = exports.wsCursorUpdate = exports.wsCursorUnsubscribed = exports.wsCursorSubscribed = exports.wsChatHistory = exports.wsChatSent = exports.wsChatMessage = exports.wsChatLeft = exports.wsChatJoined = void 0;
exports.gatewaySignalDeclarations = exports.wsError = exports.wsUploadUrlRevoked = exports.wsUploadScanQuarantined = exports.wsUploadScanned = exports.wsUploadFailed = exports.wsUploadCompleted = exports.wsUploadUrlIssued = exports.wsUploadRequested = exports.wsPipelineEvent = exports.wsPipelineHistory = exports.wsPipelineSnapshot = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'websocket-gateway';
const BASE_TAGS = ['gateway', 'signal', `producer:${PRODUCER}`];
/**
 * Meanings for the WS-frame envelope plus the fan-out-service fields that
 * only exist on gateway push frames. Dotted keys pin down a name whose
 * meaning changes with position (`action` on the frame vs `payload.action`
 * on a notification body).
 */
const FIELDS = {
    type: 'WebSocket frame type — names the gateway fan-out service that produced this frame.',
    action: 'Which action of the frame\'s service this frame reports.',
    // cursor / crdt
    cursor: 'Cursor position and styling for one client.',
    modes: 'Per-client cursor display modes currently in force for the channel.',
    awareness: 'Yjs awareness state for one client (selection, cursor, user colour).',
    'updates.awareness': 'Yjs awareness state for the client named by this entry.',
    update: 'Base64-encoded Yjs update payload.',
    'updates.update': 'Base64-encoded Yjs update payload for the client named by this entry.',
    // presence
    presence: 'Presence record(s) for the channel — who is here and what state they are in.',
    client: 'Presence record of the client that triggered this frame.',
    // reactions
    'data.effect': 'Optional visual effect to play alongside the reaction (confetti, burst, …).',
    'data.reactionId': 'Identifier of the reaction that was recorded.',
    'data.availableReactions': 'Emoji names the channel accepts as reactions.',
    // calls
    'data.targetUserIds': 'User ids the call invitation is addressed to.',
    participant: 'Participant record describing one member of the hangout.',
    // notifications — `action` here is a UI affordance, not a service verb
    'payload.action': 'Optional call-to-action rendered with the notification.',
    'payload.action.onClickEvent': 'Event name the frontend dispatches when the action is clicked.',
    'payload.notifications.action': 'Optional call-to-action rendered with the notification.',
    'payload.notifications.action.onClickEvent': 'Event name the frontend dispatches when the action is clicked.',
    'payload.payload': 'Application-defined body of the notification.',
    'payload.notifications.payload': 'Application-defined body of the notification.',
    'payload.name': 'Identifier of the capability or feature flag whose state changed.',
    // errors
    'error.service': 'Gateway fan-out service whose handler produced the error.',
    // pipeline fan-out
    run: 'Current run state, or null when the run id is unknown to the gateway.',
    fromVersion: 'Run version the history was requested from; events before it are omitted.',
    sourceNodeId: 'Cluster node id of the gateway that originated the fan-out.',
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Build a loose WS frame schema with an explicit `type` value. */
function wsSchema(typeLiteral, extra = {}, required = []) {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: typeLiteral },
            timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
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
exports.wsChatLeft = {
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
exports.wsChatMessage = {
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
exports.wsChatSent = {
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
exports.wsChatHistory = {
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
exports.wsCursorSubscribed = {
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
exports.wsCursorUnsubscribed = {
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
exports.wsCursorUpdate = {
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
exports.wsCursorRemove = {
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
exports.wsCursorClear = {
    namespace: 'ws',
    name: 'ws.cursor.clear',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to channel subscribers when a client clears (removes) their cursor from the canvas. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO clear action (cursor removal flows through the remove/update verbs) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'clear' },
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['action', 'channel', 'clientId']),
};
/** Batched cursor position update for multiple clients, sent as a single frame. */
exports.wsCursorBatch = {
    namespace: 'ws',
    name: 'ws.cursor.batch',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Batched cursor positions for multiple clients delivered in a single frame to reduce message volume. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO batch action (it broadcasts per-client cursor:update frames and returns the full list via cursor:subscribed/cursors) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
    tags: [...BASE_TAGS, 'cursor'],
    schema: wsSchema('cursor', {
        action: { type: 'string', const: 'batch' },
        channel: { type: 'string' },
        cursors: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }, ['action', 'channel', 'cursors']),
};
/** Current cursor list for a channel, sent in response to a `get` request. */
exports.wsCursorList = {
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
exports.wsCursorModes = {
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
exports.wsActivitySubscribed = {
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
exports.wsActivityUnsubscribed = {
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
exports.wsActivityPublished = {
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
exports.wsActivityHistory = {
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
exports.wsActivityEvent = {
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
exports.wsCrdtSubscribed = {
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
exports.wsCrdtUnsubscribed = {
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
exports.wsCrdtSnapshot = {
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
exports.wsCrdtUpdate = {
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
exports.wsCrdtSyncRequest = {
    namespace: 'ws',
    name: 'ws.crdt.sync-request',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Client-initiated Y.js state vector sent to the gateway to request missing updates from peers. NOTE (2026-06-12 dist re-audit): not emitted/handled by the realtime-modules dist CRDTService the gateway currently runs (sync flows via crdt:subscribed + the pushed crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
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
exports.wsCrdtSyncResponse = {
    namespace: 'ws',
    name: 'ws.crdt.sync-response',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Gateway response to a sync-request containing the Y.js updates needed to bring the client up to date. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs — historical/in-tree-gateway surface, retained for back-compat.',
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
exports.wsCrdtDocReplaced = {
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
/**
 * Emitted when the gateway persists a Y.Doc state snapshot to durable storage.
 * Used for recovery flows — clients can request the latest stored snapshot
 * instead of replaying the full update log.
 */
exports.wsCrdtSnapshotStored = {
    namespace: 'ws',
    name: 'ws.crdt.snapshot-stored',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast when a Y.Doc state snapshot is durably stored by the gateway. Carries the snapshot ID and byte size so clients can decide whether to fetch the new baseline. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs (snapshots are persisted silently; clients re-fetch via getSnapshot → crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt', 'snapshot'],
    schema: wsSchema('crdt:snapshot-stored', {
        docId: { type: 'string' },
        snapshotId: { type: 'string' },
        size: { type: 'number', description: 'Size in bytes of the stored snapshot' },
    }, ['docId', 'snapshotId', 'size']),
};
/**
 * Batched Y.js awareness updates forwarded to channel subscribers.
 * Coalescing multiple individual awareness ticks into a single frame reduces
 * WebSocket frame overhead for channels with many concurrent editors.
 */
exports.wsCrdtAwarenessBatch = {
    namespace: 'ws',
    name: 'ws.crdt.awareness-batch',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Batched Y.js awareness updates (cursor positions, user metadata) forwarded to CRDT channel subscribers in a single frame to reduce overhead. NOTE (2026-06-12 dist re-audit): the realtime-modules dist the gateway currently runs emits awareness as type:"crdt:awareness" with { channel, updates:[{ clientId, update }] } (declared as ws.crdt.awareness in client-frames.ts), NOT this "crdt:awareness-batch" / { clientId, awareness } shape — this declaration is a historical/in-tree-gateway surface, retained for back-compat.',
    tags: [...BASE_TAGS, 'crdt', 'awareness'],
    schema: wsSchema('crdt:awareness-batch', {
        docId: { type: 'string' },
        updates: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    clientId: { type: 'number' },
                    awareness: { type: 'object', additionalProperties: true },
                },
                required: ['clientId'],
                additionalProperties: true,
            },
            description: 'Array of per-client awareness state updates',
        },
    }, ['docId', 'updates']),
};
// ===========================================================================
// PRESENCE frames — src/realtime-fanout/presence-service.ts
// ===========================================================================
/** Sent to the client when their presence is successfully set/updated. */
exports.wsPresenceSet = {
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
exports.wsPresenceUpdate = {
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
exports.wsPresenceSubscribed = {
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
exports.wsPresenceUnsubscribed = {
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
exports.wsPresenceData = {
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
exports.wsPresenceOffline = {
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
exports.wsReactionReceived = {
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
exports.wsReactionRemoved = {
    namespace: 'ws',
    name: 'ws.reaction.removed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all reaction channel subscribers when a previously sent reaction is removed. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-remove action — this frame is a historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service.',
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
exports.wsReactionList = {
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
    namespace: 'ws',
    name: 'ws.call.invite',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call invitation broadcast to target users (or all users when no targets specified).',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('invite'),
};
exports.wsCallAccepted = {
    namespace: 'ws',
    name: 'ws.call.accepted',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call accepted signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('accepted'),
};
exports.wsCallDeclined = {
    namespace: 'ws',
    name: 'ws.call.declined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call declined signal delivered to the call initiator.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('declined'),
};
exports.wsCallCancelled = {
    namespace: 'ws',
    name: 'ws.call.cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call cancelled signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('cancelled'),
};
exports.wsCallEnded = {
    namespace: 'ws',
    name: 'ws.call.ended',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Call ended signal broadcast to all parties.',
    tags: [...BASE_TAGS, 'call'],
    schema: callSchema('ended'),
};
/** Broadcast when a participant enables their video feed. */
exports.wsCallVideoOn = {
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
exports.wsCallVideoOff = {
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
/** Broadcast to all call participants when server-side recording begins. */
exports.wsCallRecordingStarted = {
    namespace: 'ws',
    name: 'ws.call.recording-started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all call participants when server-side recording of the session starts.',
    tags: [...BASE_TAGS, 'call', 'recording'],
    schema: wsSchema('call', {
        action: { type: 'string', const: 'recording-started' },
        data: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                recordingId: { type: 'string' },
                format: { type: 'string', description: 'Recording format (e.g. "mp4", "webm")' },
            },
            required: ['sessionId', 'recordingId', 'format'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to all call participants when server-side recording finishes and a download is available. */
exports.wsCallRecordingCompleted = {
    namespace: 'ws',
    name: 'ws.call.recording-completed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Broadcast to all call participants when recording ends and a download URL for the recording is available.',
    tags: [...BASE_TAGS, 'call', 'recording'],
    schema: wsSchema('call', {
        action: { type: 'string', const: 'recording-completed' },
        data: {
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                recordingId: { type: 'string' },
                downloadUrl: { type: 'string' },
            },
            required: ['sessionId', 'recordingId', 'downloadUrl'],
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
exports.wsPipelineSubscribed = {
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
exports.wsPipelineUnsubscribed = {
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
exports.wsPipelineAck = {
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
exports.wsPipelineSnapshot = {
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
exports.wsPipelineHistory = {
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
exports.wsPipelineEvent = {
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
exports.wsUploadRequested = {
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
exports.wsUploadUrlIssued = {
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
                expiresAt: { type: 'string', description: 'ISO-8601 timestamp after which the presigned URL stops working.' },
            },
            required: ['uploadId', 'presignedUrl', 'expiresAt'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/** Broadcast to the channel when a file upload completes successfully. */
exports.wsUploadCompleted = {
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
exports.wsUploadFailed = {
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
exports.wsUploadScanned = {
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
/**
 * Sent to the uploading client when a security scan finds a threat and the
 * file is quarantined. The presigned download URL is revoked; the client
 * should display an error and optionally prompt for re-upload.
 */
exports.wsUploadScanQuarantined = {
    namespace: 'ws',
    name: 'ws.upload.scan-quarantined',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when a security scan detects a threat. The file is quarantined and the download URL is revoked.',
    tags: [...BASE_TAGS, 'upload', 'security'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'scan-quarantined' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                reason: { type: 'string', description: 'Human-readable quarantine reason (e.g. threat name)' },
            },
            required: ['uploadId', 'reason'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
/**
 * Sent to the uploading client when a previously issued presigned download
 * URL is explicitly revoked (e.g. after quarantine, policy change, or TTL
 * expiry before download).
 */
exports.wsUploadUrlRevoked = {
    namespace: 'ws',
    name: 'ws.upload.url-revoked',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Sent to the uploading client when a presigned download URL is explicitly revoked. Clients should discard any cached URL.',
    tags: [...BASE_TAGS, 'upload', 'security'],
    schema: wsSchema('upload', {
        action: { type: 'string', const: 'url-revoked' },
        data: {
            type: 'object',
            properties: {
                uploadId: { type: 'string' },
                reason: { type: 'string', description: 'Reason for revocation (e.g. "quarantine", "policy", "expired")' },
            },
            required: ['uploadId', 'reason'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};
// ===========================================================================
// ERROR frame — src/core/message-router.ts + all service sendError() methods
// ===========================================================================
/**
 * Generic error frame sent when any service encounters a client-visible error.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): the gateway dist
 * services emit TWO error-envelope shapes on the wire, both modelled here:
 *   - NESTED (chat / reaction / cursor / crdt): { type:'error', service,
 *     error:{ code, message, service, clientId, timestamp } } — via
 *     createErrorResponse/sendError.
 *   - FLAT (presence / activity): { type:'error', service, message } — these
 *     services have no ErrorCodes/createErrorResponse and send a bare message.
 * Both top-level `message` (flat) and the nested `error` object are therefore
 * declared optional; `service` names the originating service in both shapes.
 */
exports.wsError = {
    namespace: 'ws',
    name: 'ws.error',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Generic error frame sent to a client when any gateway service encounters a client-visible error. GROUND TRUTH (gateway dist): chat/reaction/cursor/crdt nest under error:{ code, message, service, clientId, timestamp }; presence/activity send a flat top-level message. `service` names the originating service in both shapes.',
    tags: [...BASE_TAGS, 'error'],
    schema: wsSchema('error', {
        service: { type: 'string', description: 'The service that generated the error (chat, cursor, presence, etc.)' },
        // FLAT shape (presence / activity)
        code: { type: 'string', description: 'flat-shape error code (when no nested error object is present)' },
        message: { type: 'string', description: 'flat-shape human-readable message (presence/activity); for chat/reaction/cursor/crdt the message lives under error.message' },
        // NESTED shape (chat / reaction / cursor / crdt) via createErrorResponse
        error: {
            type: 'object',
            description: 'nested error envelope emitted by chat/reaction/cursor/crdt',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                service: { type: 'string' },
                clientId: { type: 'string' },
                timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
            },
            required: ['code', 'message'],
            additionalProperties: true,
        },
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
    exports.wsCursorClear,
    exports.wsCursorBatch,
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
    exports.wsCrdtSyncRequest,
    exports.wsCrdtSyncResponse,
    exports.wsCrdtSnapshotStored,
    exports.wsCrdtAwarenessBatch,
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
    exports.wsReactionRemoved,
    exports.wsReactionList,
    exports.wsReactionSent,
    // call
    exports.wsCallInvite,
    exports.wsCallAccepted,
    exports.wsCallDeclined,
    exports.wsCallCancelled,
    exports.wsCallEnded,
    exports.wsCallVideoOn,
    exports.wsCallVideoOff,
    exports.wsCallRecordingStarted,
    exports.wsCallRecordingCompleted,
    // upload
    exports.wsUploadRequested,
    exports.wsUploadUrlIssued,
    exports.wsUploadCompleted,
    exports.wsUploadFailed,
    exports.wsUploadScanned,
    exports.wsUploadScanQuarantined,
    exports.wsUploadUrlRevoked,
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
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.gatewaySignalDeclarations, FIELDS);
//# sourceMappingURL=gateway-signal.js.map