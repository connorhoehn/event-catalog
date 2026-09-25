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

import type { EventDeclaration } from '../types/index';
import { annotateDeclarations, type FieldGlossary } from './field-glossary';

import {
    wsChatJoined,
    wsChatLeft,
    wsChatMessage,
    wsChatSent,
    wsChatHistory,
} from './gateway-signal/chat';
import {
    wsCursorSubscribed,
    wsCursorUnsubscribed,
    wsCursorUpdate,
    wsCursorRemove,
    wsCursorClear,
    wsCursorBatch,
    wsCursorList,
    wsCursorModes,
} from './gateway-signal/cursor';
import {
    wsActivitySubscribed,
    wsActivityUnsubscribed,
    wsActivityPublished,
    wsActivityHistory,
    wsActivityEvent,
} from './gateway-signal/activity';
import {
    wsCrdtSubscribed,
    wsCrdtUnsubscribed,
    wsCrdtSnapshot,
    wsCrdtUpdate,
    wsCrdtPersisted,
    wsCrdtPersistenceError,
    wsCrdtSeeded,
    wsCrdtSyncRequest,
    wsCrdtSyncResponse,
    wsCrdtDocReplaced,
    wsCrdtSnapshotStored,
    wsCrdtAwarenessBatch,
} from './gateway-signal/crdt';
import {
    wsPresenceSet,
    wsPresenceUpdate,
    wsPresenceSubscribed,
    wsPresenceUnsubscribed,
    wsPresenceData,
    wsPresenceOffline,
} from './gateway-signal/presence';
import {
    wsReactionSubscribed,
    wsReactionReceived,
    wsReactionRemoved,
    wsReactionList,
    wsReactionHistory,
    wsReactionSent,
} from './gateway-signal/reaction';
import {
    wsCallInvite,
    wsCallAccepted,
    wsCallDeclined,
    wsCallCancelled,
    wsCallEnded,
    wsCallVideoOn,
    wsCallVideoOff,
    wsCallRecordingStarted,
    wsCallRecordingCompleted,
    wsCallCallMeta,
    wsCallInviteExpired,
    wsCallParticipantState,
    wsCallUserStatus,
} from './gateway-signal/call';
import {
    wsPipelineSubscribed,
    wsPipelineUnsubscribed,
    wsPipelineAck,
    wsPipelineSnapshot,
    wsPipelineHistory,
    wsPipelineEvent,
} from './gateway-signal/pipeline';
import {
    wsUploadRequested,
    wsUploadUrlIssued,
    wsUploadCompleted,
    wsUploadFailed,
    wsUploadScanned,
    wsUploadScanQuarantined,
    wsUploadUrlRevoked,
} from './gateway-signal/upload';
import { wsError } from './gateway-signal/error';
import { wsSessionConnected } from './gateway-signal/session';
import { wsSubscribeSubscribed, wsSubscribeUnsubscribed } from './gateway-signal/subscribe';

// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------

export {
    wsChatJoined,
    wsChatLeft,
    wsChatMessage,
    wsChatSent,
    wsChatHistory,
} from './gateway-signal/chat';
export {
    wsCursorSubscribed,
    wsCursorUnsubscribed,
    wsCursorUpdate,
    wsCursorRemove,
    wsCursorClear,
    wsCursorBatch,
    wsCursorList,
    wsCursorModes,
} from './gateway-signal/cursor';
export {
    wsActivitySubscribed,
    wsActivityUnsubscribed,
    wsActivityPublished,
    wsActivityHistory,
    wsActivityEvent,
} from './gateway-signal/activity';
export {
    wsCrdtSubscribed,
    wsCrdtUnsubscribed,
    wsCrdtSnapshot,
    wsCrdtUpdate,
    wsCrdtPersisted,
    wsCrdtPersistenceError,
    wsCrdtSeeded,
    wsCrdtSyncRequest,
    wsCrdtSyncResponse,
    wsCrdtDocReplaced,
    wsCrdtSnapshotStored,
    wsCrdtAwarenessBatch,
} from './gateway-signal/crdt';
export {
    wsPresenceSet,
    wsPresenceUpdate,
    wsPresenceSubscribed,
    wsPresenceUnsubscribed,
    wsPresenceData,
    wsPresenceOffline,
} from './gateway-signal/presence';
export {
    wsReactionSubscribed,
    wsReactionReceived,
    wsReactionRemoved,
    wsReactionList,
    wsReactionHistory,
    wsReactionSent,
} from './gateway-signal/reaction';
export {
    wsCallInvite,
    wsCallAccepted,
    wsCallDeclined,
    wsCallCancelled,
    wsCallEnded,
    wsCallVideoOn,
    wsCallVideoOff,
    wsCallRecordingStarted,
    wsCallRecordingCompleted,
    wsCallCallMeta,
    wsCallInviteExpired,
    wsCallParticipantState,
    wsCallUserStatus,
} from './gateway-signal/call';
export {
    wsPipelineSubscribed,
    wsPipelineUnsubscribed,
    wsPipelineAck,
    wsPipelineSnapshot,
    wsPipelineHistory,
    wsPipelineEvent,
} from './gateway-signal/pipeline';
export {
    wsUploadRequested,
    wsUploadUrlIssued,
    wsUploadCompleted,
    wsUploadFailed,
    wsUploadScanned,
    wsUploadScanQuarantined,
    wsUploadUrlRevoked,
} from './gateway-signal/upload';
export { wsError } from './gateway-signal/error';
export { wsSessionConnected } from './gateway-signal/session';
export { wsSubscribeSubscribed, wsSubscribeUnsubscribed } from './gateway-signal/subscribe';

// ---------------------------------------------------------------------------
// Field glossary
// ---------------------------------------------------------------------------

/**
 * Meanings for the WS-frame envelope plus the fan-out-service fields that
 * only exist on gateway push frames. Dotted keys pin down a name whose
 * meaning changes with position (`action` on the frame vs `payload.action`
 * on a notification body).
 */
const FIELDS: FieldGlossary = {
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
    wsCrdtPersisted,
    wsCrdtPersistenceError,
    wsCrdtSeeded,
    wsCrdtDocReplaced,
    wsCrdtSyncRequest,
    wsCrdtSyncResponse,
    wsCrdtSnapshotStored,
    wsCrdtAwarenessBatch,
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
    wsReactionHistory,
    wsReactionSent,
    // call
    wsCallInvite,
    wsCallAccepted,
    wsCallDeclined,
    wsCallCancelled,
    wsCallEnded,
    wsCallVideoOn,
    wsCallVideoOff,
    wsCallRecordingStarted,
    wsCallRecordingCompleted,
    wsCallCallMeta,
    wsCallInviteExpired,
    wsCallParticipantState,
    wsCallUserStatus,
    // upload
    wsUploadRequested,
    wsUploadUrlIssued,
    wsUploadCompleted,
    wsUploadFailed,
    wsUploadScanned,
    wsUploadScanQuarantined,
    wsUploadUrlRevoked,
    // pipeline WS push frames
    wsPipelineSubscribed,
    wsPipelineUnsubscribed,
    wsPipelineAck,
    wsPipelineSnapshot,
    wsPipelineHistory,
    wsPipelineEvent,
    // error
    wsError,
    // session bootstrap + generic multiplexer acks (added 2026-09-07)
    wsSessionConnected,
    wsSubscribeSubscribed,
    wsSubscribeUnsubscribed,
];

// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
annotateDeclarations(gatewaySignalDeclarations, FIELDS);
