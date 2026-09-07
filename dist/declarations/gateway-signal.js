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
//
// FILE LAYOUT (2026-09-07 decomposition — declarations unchanged, fingerprints
// identical): the frames themselves now live one file per gateway fan-out
// service under `./gateway-signal/`, mirroring the source files listed above.
// This module stays the single public entry point: it re-exports every
// declaration under its original name, owns the aggregate array in its
// original order, and — critically — owns the ONE `annotateDeclarations()`
// call and the local field glossary it applies. Keeping both here is what
// guarantees the split cannot silently change which description lands on
// which property. Never call `annotateDeclarations` from a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsPipelineAck = exports.wsPipelineUnsubscribed = exports.wsPipelineSubscribed = exports.wsCallRecordingCompleted = exports.wsCallRecordingStarted = exports.wsCallVideoOff = exports.wsCallVideoOn = exports.wsCallEnded = exports.wsCallCancelled = exports.wsCallDeclined = exports.wsCallAccepted = exports.wsCallInvite = exports.wsReactionSent = exports.wsReactionList = exports.wsReactionRemoved = exports.wsReactionReceived = exports.wsReactionSubscribed = exports.wsPresenceOffline = exports.wsPresenceData = exports.wsPresenceUnsubscribed = exports.wsPresenceSubscribed = exports.wsPresenceUpdate = exports.wsPresenceSet = exports.wsCrdtAwarenessBatch = exports.wsCrdtSnapshotStored = exports.wsCrdtDocReplaced = exports.wsCrdtSyncResponse = exports.wsCrdtSyncRequest = exports.wsCrdtUpdate = exports.wsCrdtSnapshot = exports.wsCrdtUnsubscribed = exports.wsCrdtSubscribed = exports.wsActivityEvent = exports.wsActivityHistory = exports.wsActivityPublished = exports.wsActivityUnsubscribed = exports.wsActivitySubscribed = exports.wsCursorModes = exports.wsCursorList = exports.wsCursorBatch = exports.wsCursorClear = exports.wsCursorRemove = exports.wsCursorUpdate = exports.wsCursorUnsubscribed = exports.wsCursorSubscribed = exports.wsChatHistory = exports.wsChatSent = exports.wsChatMessage = exports.wsChatLeft = exports.wsChatJoined = void 0;
exports.gatewaySignalDeclarations = exports.wsError = exports.wsUploadUrlRevoked = exports.wsUploadScanQuarantined = exports.wsUploadScanned = exports.wsUploadFailed = exports.wsUploadCompleted = exports.wsUploadUrlIssued = exports.wsUploadRequested = exports.wsPipelineEvent = exports.wsPipelineHistory = exports.wsPipelineSnapshot = void 0;
const field_glossary_1 = require("./field-glossary");
const chat_1 = require("./gateway-signal/chat");
const cursor_1 = require("./gateway-signal/cursor");
const activity_1 = require("./gateway-signal/activity");
const crdt_1 = require("./gateway-signal/crdt");
const presence_1 = require("./gateway-signal/presence");
const reaction_1 = require("./gateway-signal/reaction");
const call_1 = require("./gateway-signal/call");
const pipeline_1 = require("./gateway-signal/pipeline");
const upload_1 = require("./gateway-signal/upload");
const error_1 = require("./gateway-signal/error");
// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------
var chat_2 = require("./gateway-signal/chat");
Object.defineProperty(exports, "wsChatJoined", { enumerable: true, get: function () { return chat_2.wsChatJoined; } });
Object.defineProperty(exports, "wsChatLeft", { enumerable: true, get: function () { return chat_2.wsChatLeft; } });
Object.defineProperty(exports, "wsChatMessage", { enumerable: true, get: function () { return chat_2.wsChatMessage; } });
Object.defineProperty(exports, "wsChatSent", { enumerable: true, get: function () { return chat_2.wsChatSent; } });
Object.defineProperty(exports, "wsChatHistory", { enumerable: true, get: function () { return chat_2.wsChatHistory; } });
var cursor_2 = require("./gateway-signal/cursor");
Object.defineProperty(exports, "wsCursorSubscribed", { enumerable: true, get: function () { return cursor_2.wsCursorSubscribed; } });
Object.defineProperty(exports, "wsCursorUnsubscribed", { enumerable: true, get: function () { return cursor_2.wsCursorUnsubscribed; } });
Object.defineProperty(exports, "wsCursorUpdate", { enumerable: true, get: function () { return cursor_2.wsCursorUpdate; } });
Object.defineProperty(exports, "wsCursorRemove", { enumerable: true, get: function () { return cursor_2.wsCursorRemove; } });
Object.defineProperty(exports, "wsCursorClear", { enumerable: true, get: function () { return cursor_2.wsCursorClear; } });
Object.defineProperty(exports, "wsCursorBatch", { enumerable: true, get: function () { return cursor_2.wsCursorBatch; } });
Object.defineProperty(exports, "wsCursorList", { enumerable: true, get: function () { return cursor_2.wsCursorList; } });
Object.defineProperty(exports, "wsCursorModes", { enumerable: true, get: function () { return cursor_2.wsCursorModes; } });
var activity_2 = require("./gateway-signal/activity");
Object.defineProperty(exports, "wsActivitySubscribed", { enumerable: true, get: function () { return activity_2.wsActivitySubscribed; } });
Object.defineProperty(exports, "wsActivityUnsubscribed", { enumerable: true, get: function () { return activity_2.wsActivityUnsubscribed; } });
Object.defineProperty(exports, "wsActivityPublished", { enumerable: true, get: function () { return activity_2.wsActivityPublished; } });
Object.defineProperty(exports, "wsActivityHistory", { enumerable: true, get: function () { return activity_2.wsActivityHistory; } });
Object.defineProperty(exports, "wsActivityEvent", { enumerable: true, get: function () { return activity_2.wsActivityEvent; } });
var crdt_2 = require("./gateway-signal/crdt");
Object.defineProperty(exports, "wsCrdtSubscribed", { enumerable: true, get: function () { return crdt_2.wsCrdtSubscribed; } });
Object.defineProperty(exports, "wsCrdtUnsubscribed", { enumerable: true, get: function () { return crdt_2.wsCrdtUnsubscribed; } });
Object.defineProperty(exports, "wsCrdtSnapshot", { enumerable: true, get: function () { return crdt_2.wsCrdtSnapshot; } });
Object.defineProperty(exports, "wsCrdtUpdate", { enumerable: true, get: function () { return crdt_2.wsCrdtUpdate; } });
Object.defineProperty(exports, "wsCrdtSyncRequest", { enumerable: true, get: function () { return crdt_2.wsCrdtSyncRequest; } });
Object.defineProperty(exports, "wsCrdtSyncResponse", { enumerable: true, get: function () { return crdt_2.wsCrdtSyncResponse; } });
Object.defineProperty(exports, "wsCrdtDocReplaced", { enumerable: true, get: function () { return crdt_2.wsCrdtDocReplaced; } });
Object.defineProperty(exports, "wsCrdtSnapshotStored", { enumerable: true, get: function () { return crdt_2.wsCrdtSnapshotStored; } });
Object.defineProperty(exports, "wsCrdtAwarenessBatch", { enumerable: true, get: function () { return crdt_2.wsCrdtAwarenessBatch; } });
var presence_2 = require("./gateway-signal/presence");
Object.defineProperty(exports, "wsPresenceSet", { enumerable: true, get: function () { return presence_2.wsPresenceSet; } });
Object.defineProperty(exports, "wsPresenceUpdate", { enumerable: true, get: function () { return presence_2.wsPresenceUpdate; } });
Object.defineProperty(exports, "wsPresenceSubscribed", { enumerable: true, get: function () { return presence_2.wsPresenceSubscribed; } });
Object.defineProperty(exports, "wsPresenceUnsubscribed", { enumerable: true, get: function () { return presence_2.wsPresenceUnsubscribed; } });
Object.defineProperty(exports, "wsPresenceData", { enumerable: true, get: function () { return presence_2.wsPresenceData; } });
Object.defineProperty(exports, "wsPresenceOffline", { enumerable: true, get: function () { return presence_2.wsPresenceOffline; } });
var reaction_2 = require("./gateway-signal/reaction");
Object.defineProperty(exports, "wsReactionSubscribed", { enumerable: true, get: function () { return reaction_2.wsReactionSubscribed; } });
Object.defineProperty(exports, "wsReactionReceived", { enumerable: true, get: function () { return reaction_2.wsReactionReceived; } });
Object.defineProperty(exports, "wsReactionRemoved", { enumerable: true, get: function () { return reaction_2.wsReactionRemoved; } });
Object.defineProperty(exports, "wsReactionList", { enumerable: true, get: function () { return reaction_2.wsReactionList; } });
Object.defineProperty(exports, "wsReactionSent", { enumerable: true, get: function () { return reaction_2.wsReactionSent; } });
var call_2 = require("./gateway-signal/call");
Object.defineProperty(exports, "wsCallInvite", { enumerable: true, get: function () { return call_2.wsCallInvite; } });
Object.defineProperty(exports, "wsCallAccepted", { enumerable: true, get: function () { return call_2.wsCallAccepted; } });
Object.defineProperty(exports, "wsCallDeclined", { enumerable: true, get: function () { return call_2.wsCallDeclined; } });
Object.defineProperty(exports, "wsCallCancelled", { enumerable: true, get: function () { return call_2.wsCallCancelled; } });
Object.defineProperty(exports, "wsCallEnded", { enumerable: true, get: function () { return call_2.wsCallEnded; } });
Object.defineProperty(exports, "wsCallVideoOn", { enumerable: true, get: function () { return call_2.wsCallVideoOn; } });
Object.defineProperty(exports, "wsCallVideoOff", { enumerable: true, get: function () { return call_2.wsCallVideoOff; } });
Object.defineProperty(exports, "wsCallRecordingStarted", { enumerable: true, get: function () { return call_2.wsCallRecordingStarted; } });
Object.defineProperty(exports, "wsCallRecordingCompleted", { enumerable: true, get: function () { return call_2.wsCallRecordingCompleted; } });
var pipeline_2 = require("./gateway-signal/pipeline");
Object.defineProperty(exports, "wsPipelineSubscribed", { enumerable: true, get: function () { return pipeline_2.wsPipelineSubscribed; } });
Object.defineProperty(exports, "wsPipelineUnsubscribed", { enumerable: true, get: function () { return pipeline_2.wsPipelineUnsubscribed; } });
Object.defineProperty(exports, "wsPipelineAck", { enumerable: true, get: function () { return pipeline_2.wsPipelineAck; } });
Object.defineProperty(exports, "wsPipelineSnapshot", { enumerable: true, get: function () { return pipeline_2.wsPipelineSnapshot; } });
Object.defineProperty(exports, "wsPipelineHistory", { enumerable: true, get: function () { return pipeline_2.wsPipelineHistory; } });
Object.defineProperty(exports, "wsPipelineEvent", { enumerable: true, get: function () { return pipeline_2.wsPipelineEvent; } });
var upload_2 = require("./gateway-signal/upload");
Object.defineProperty(exports, "wsUploadRequested", { enumerable: true, get: function () { return upload_2.wsUploadRequested; } });
Object.defineProperty(exports, "wsUploadUrlIssued", { enumerable: true, get: function () { return upload_2.wsUploadUrlIssued; } });
Object.defineProperty(exports, "wsUploadCompleted", { enumerable: true, get: function () { return upload_2.wsUploadCompleted; } });
Object.defineProperty(exports, "wsUploadFailed", { enumerable: true, get: function () { return upload_2.wsUploadFailed; } });
Object.defineProperty(exports, "wsUploadScanned", { enumerable: true, get: function () { return upload_2.wsUploadScanned; } });
Object.defineProperty(exports, "wsUploadScanQuarantined", { enumerable: true, get: function () { return upload_2.wsUploadScanQuarantined; } });
Object.defineProperty(exports, "wsUploadUrlRevoked", { enumerable: true, get: function () { return upload_2.wsUploadUrlRevoked; } });
var error_2 = require("./gateway-signal/error");
Object.defineProperty(exports, "wsError", { enumerable: true, get: function () { return error_2.wsError; } });
// ---------------------------------------------------------------------------
// Field glossary
// ---------------------------------------------------------------------------
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
    chat_1.wsChatJoined,
    chat_1.wsChatLeft,
    chat_1.wsChatMessage,
    chat_1.wsChatSent,
    chat_1.wsChatHistory,
    // cursor
    cursor_1.wsCursorSubscribed,
    cursor_1.wsCursorUnsubscribed,
    cursor_1.wsCursorUpdate,
    cursor_1.wsCursorRemove,
    cursor_1.wsCursorList,
    cursor_1.wsCursorModes,
    cursor_1.wsCursorClear,
    cursor_1.wsCursorBatch,
    // activity
    activity_1.wsActivitySubscribed,
    activity_1.wsActivityUnsubscribed,
    activity_1.wsActivityPublished,
    activity_1.wsActivityHistory,
    activity_1.wsActivityEvent,
    // crdt
    crdt_1.wsCrdtSubscribed,
    crdt_1.wsCrdtUnsubscribed,
    crdt_1.wsCrdtSnapshot,
    crdt_1.wsCrdtUpdate,
    crdt_1.wsCrdtDocReplaced,
    crdt_1.wsCrdtSyncRequest,
    crdt_1.wsCrdtSyncResponse,
    crdt_1.wsCrdtSnapshotStored,
    crdt_1.wsCrdtAwarenessBatch,
    // presence
    presence_1.wsPresenceSet,
    presence_1.wsPresenceUpdate,
    presence_1.wsPresenceSubscribed,
    presence_1.wsPresenceUnsubscribed,
    presence_1.wsPresenceData,
    presence_1.wsPresenceOffline,
    // reaction
    reaction_1.wsReactionSubscribed,
    reaction_1.wsReactionReceived,
    reaction_1.wsReactionRemoved,
    reaction_1.wsReactionList,
    reaction_1.wsReactionSent,
    // call
    call_1.wsCallInvite,
    call_1.wsCallAccepted,
    call_1.wsCallDeclined,
    call_1.wsCallCancelled,
    call_1.wsCallEnded,
    call_1.wsCallVideoOn,
    call_1.wsCallVideoOff,
    call_1.wsCallRecordingStarted,
    call_1.wsCallRecordingCompleted,
    // upload
    upload_1.wsUploadRequested,
    upload_1.wsUploadUrlIssued,
    upload_1.wsUploadCompleted,
    upload_1.wsUploadFailed,
    upload_1.wsUploadScanned,
    upload_1.wsUploadScanQuarantined,
    upload_1.wsUploadUrlRevoked,
    // pipeline WS push frames
    pipeline_1.wsPipelineSubscribed,
    pipeline_1.wsPipelineUnsubscribed,
    pipeline_1.wsPipelineAck,
    pipeline_1.wsPipelineSnapshot,
    pipeline_1.wsPipelineHistory,
    pipeline_1.wsPipelineEvent,
    // error
    error_1.wsError,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.gatewaySignalDeclarations, FIELDS);
//# sourceMappingURL=gateway-signal.js.map