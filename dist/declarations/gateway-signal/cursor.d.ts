import type { EventDeclaration } from '../../types/index';
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
//# sourceMappingURL=cursor.d.ts.map