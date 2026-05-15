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
 * Sent to all subscribers when a snapshot restore replaces the document.
 * Note: frame type is `crdt:doc-replaced`.
 */
export declare const wsCrdtDocReplaced: EventDeclaration;
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
/** Sent when a client subscribes to reactions in a channel. */
export declare const wsReactionSubscribed: EventDeclaration;
/** Broadcast to all channel subscribers when a reaction is sent. */
export declare const wsReactionReceived: EventDeclaration;
/** Confirmation sent to the sender after their reaction is broadcast. */
export declare const wsReactionSent: EventDeclaration;
export declare const wsCallInvite: EventDeclaration;
export declare const wsCallAccepted: EventDeclaration;
export declare const wsCallDeclined: EventDeclaration;
export declare const wsCallCancelled: EventDeclaration;
export declare const wsCallEnded: EventDeclaration;
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
/** Generic error frame sent when any service encounters a client-visible error. */
export declare const wsError: EventDeclaration;
/**
 * All gateway WS signal frame declarations.
 * Pass to `catalog.declare()` at boot to register every frame type the
 * websocket-gateway sends to clients.
 */
export declare const gatewaySignalDeclarations: EventDeclaration[];
//# sourceMappingURL=gateway-signal.d.ts.map