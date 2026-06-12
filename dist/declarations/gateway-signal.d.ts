import type { EventDeclaration } from '../types/index';
/** Sent to the joining client after they successfully join a chat channel. */
export declare const wsChatJoined: EventDeclaration;
/** Sent to the leaving client after they successfully leave a chat channel. */
export declare const wsChatLeft: EventDeclaration;
/** Broadcast to all channel subscribers when a new chat message is posted. */
export declare const wsChatMessage: EventDeclaration;
/** Confirmation sent to the message sender after their message is stored+broadcast. */
export declare const wsChatSent: EventDeclaration;
/** Recent message history delivered to a client on join or explicit history request. */
export declare const wsChatHistory: EventDeclaration;
/** Subscription confirmation + current snapshot of all cursors in the channel. */
export declare const wsCursorSubscribed: EventDeclaration;
/** Unsubscription confirmation. */
export declare const wsCursorUnsubscribed: EventDeclaration;
/** Broadcast when a client moves their cursor (throttled). */
export declare const wsCursorUpdate: EventDeclaration;
/** Broadcast when a client disconnects and their cursor should be removed. */
export declare const wsCursorRemove: EventDeclaration;
/** Broadcast to all channel subscribers when a client clears their cursor. */
export declare const wsCursorClear: EventDeclaration;
/** Batched cursor position update for multiple clients, sent as a single frame. */
export declare const wsCursorBatch: EventDeclaration;
/** Current cursor list for a channel, sent in response to a `get` request. */
export declare const wsCursorList: EventDeclaration;
/** Supported cursor modes (freeform, table, text, canvas). */
export declare const wsCursorModes: EventDeclaration;
/** Subscription confirmation for an activity channel. */
export declare const wsActivitySubscribed: EventDeclaration;
/** Unsubscription confirmation for an activity channel. */
export declare const wsActivityUnsubscribed: EventDeclaration;
/** Confirmation sent to the publishing client after their activity event is broadcast. */
export declare const wsActivityPublished: EventDeclaration;
/** History response for an activity channel. */
export declare const wsActivityHistory: EventDeclaration;
/**
 * Broadcast to all subscribers of `activity:broadcast` when an activity event fires.
 * Note: this frame uses type `activity:event`, not `activity`.
 */
export declare const wsActivityEvent: EventDeclaration;
/** Subscription confirmation after a client subscribes to a CRDT channel. */
export declare const wsCrdtSubscribed: EventDeclaration;
/** Unsubscription confirmation after a client leaves a CRDT channel. */
export declare const wsCrdtUnsubscribed: EventDeclaration;
/**
 * Full Y.Doc state snapshot pushed to a client on subscribe or explicit getSnapshot.
 * Note: frame type is `crdt:snapshot`.
 */
export declare const wsCrdtSnapshot: EventDeclaration;
/**
 * CRDT update broadcast to all channel subscribers (excluding the sender).
 * Note: frame type is `crdt:update`.
 */
export declare const wsCrdtUpdate: EventDeclaration;
/**
 * Client-initiated request to sync Y.js state with a peer.
 * Note: frame type is `crdt:sync-request`.
 */
export declare const wsCrdtSyncRequest: EventDeclaration;
/**
 * Gateway response to a sync-request, containing the missing Y.js updates.
 * Note: frame type is `crdt:sync-response`.
 */
export declare const wsCrdtSyncResponse: EventDeclaration;
/**
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
export declare const wsCrdtDocReplaced: EventDeclaration;
/**
 * Emitted when the gateway persists a Y.Doc state snapshot to durable storage.
 * Used for recovery flows — clients can request the latest stored snapshot
 * instead of replaying the full update log.
 */
export declare const wsCrdtSnapshotStored: EventDeclaration;
/**
 * Batched Y.js awareness updates forwarded to channel subscribers.
 * Coalescing multiple individual awareness ticks into a single frame reduces
 * WebSocket frame overhead for channels with many concurrent editors.
 */
export declare const wsCrdtAwarenessBatch: EventDeclaration;
/** Sent to the client when their presence is successfully set/updated. */
export declare const wsPresenceSet: EventDeclaration;
/** Broadcast to channel subscribers when a client's presence changes. */
export declare const wsPresenceUpdate: EventDeclaration;
/** Subscription confirmation + current presence snapshot for the channel. */
export declare const wsPresenceSubscribed: EventDeclaration;
/** Unsubscription confirmation from a presence channel. */
export declare const wsPresenceUnsubscribed: EventDeclaration;
/** Presence data response to a get request (specific client or channel). */
export declare const wsPresenceData: EventDeclaration;
/** Broadcast when a client goes offline (disconnects or times out). */
export declare const wsPresenceOffline: EventDeclaration;
/**
 * Sent when a client subscribes to reactions in a channel.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): the gateway dist
 * ReactionService.handleSubscribeToReactions emits this via sendSuccess, so
 * the wire frame carries success:true and data:{ channel, message,
 * availableReactions } (message was previously missing; success was undeclared).
 */
export declare const wsReactionSubscribed: EventDeclaration;
/** Broadcast to all channel subscribers when a reaction is sent. */
export declare const wsReactionReceived: EventDeclaration;
/** Broadcast to channel subscribers when a reaction is removed. */
export declare const wsReactionRemoved: EventDeclaration;
/** List of current reactions in a channel, sent in response to a list request. */
export declare const wsReactionList: EventDeclaration;
/**
 * Confirmation sent to the sender after their reaction is broadcast.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): emitted via
 * sendSuccess, so the wire frame carries success:true and
 * data:{ reactionId, emoji, channel, timestamp } (the data fields and the
 * success flag were previously undeclared).
 */
export declare const wsReactionSent: EventDeclaration;
export declare const wsCallInvite: EventDeclaration;
export declare const wsCallAccepted: EventDeclaration;
export declare const wsCallDeclined: EventDeclaration;
export declare const wsCallCancelled: EventDeclaration;
export declare const wsCallEnded: EventDeclaration;
/** Broadcast when a participant enables their video feed. */
export declare const wsCallVideoOn: EventDeclaration;
/** Broadcast when a participant disables their video feed. */
export declare const wsCallVideoOff: EventDeclaration;
/** Broadcast to all call participants when server-side recording begins. */
export declare const wsCallRecordingStarted: EventDeclaration;
/** Broadcast to all call participants when server-side recording finishes and a download is available. */
export declare const wsCallRecordingCompleted: EventDeclaration;
/** Subscription confirmation for a pipeline channel. */
export declare const wsPipelineSubscribed: EventDeclaration;
/** Unsubscription confirmation for a pipeline channel. */
export declare const wsPipelineUnsubscribed: EventDeclaration;
/**
 * Acknowledgement frame for client-initiated pipeline actions
 * (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).
 * Note: frame type is `pipeline:ack`.
 */
export declare const wsPipelineAck: EventDeclaration;
/**
 * Pipeline run state snapshot sent in response to a `getRun` request.
 * Note: frame type is `pipeline:snapshot`.
 */
export declare const wsPipelineSnapshot: EventDeclaration;
/**
 * BusEvent history for a run, sent in response to a `getHistory` request.
 * Note: frame type is `pipeline:history`.
 */
export declare const wsPipelineHistory: EventDeclaration;
/**
 * Pipeline BusEvent broadcast to channel subscribers by PipelineBridge.
 * Note: frame type is `pipeline:event`.
 */
export declare const wsPipelineEvent: EventDeclaration;
/** Acknowledgement that the gateway received a file upload request and is issuing a presigned URL. */
export declare const wsUploadRequested: EventDeclaration;
/** Presigned upload URL issued to the requesting client. */
export declare const wsUploadUrlIssued: EventDeclaration;
/** Broadcast to the channel when a file upload completes successfully. */
export declare const wsUploadCompleted: EventDeclaration;
/** Sent to the uploading client when a file upload fails. */
export declare const wsUploadFailed: EventDeclaration;
/** Sent to the channel after a security scan completes on the uploaded file. */
export declare const wsUploadScanned: EventDeclaration;
/**
 * Sent to the uploading client when a security scan finds a threat and the
 * file is quarantined. The presigned download URL is revoked; the client
 * should display an error and optionally prompt for re-upload.
 */
export declare const wsUploadScanQuarantined: EventDeclaration;
/**
 * Sent to the uploading client when a previously issued presigned download
 * URL is explicitly revoked (e.g. after quarantine, policy change, or TTL
 * expiry before download).
 */
export declare const wsUploadUrlRevoked: EventDeclaration;
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
export declare const wsError: EventDeclaration;
/**
 * All gateway WS signal frame declarations.
 * Pass to `catalog.declare()` at boot to register every frame type the
 * websocket-gateway sends to clients.
 */
export declare const gatewaySignalDeclarations: EventDeclaration[];
//# sourceMappingURL=gateway-signal.d.ts.map