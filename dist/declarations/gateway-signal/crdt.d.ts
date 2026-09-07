import type { EventDeclaration } from '../../types/index';
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
//# sourceMappingURL=crdt.d.ts.map