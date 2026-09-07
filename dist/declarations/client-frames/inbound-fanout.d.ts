import type { EventDeclaration } from '../../types/index';
/** Consumed by usePresence: a client joined the presence channel. */
export declare const wsPresenceJoined: EventDeclaration;
/** Consumed by usePresence: a client left the presence channel. */
export declare const wsPresenceLeft: EventDeclaration;
/**
 * Consumed by useReactions: confirmation that an unsubscribe was accepted.
 * GROUND TRUTH: ReactionService.handleUnsubscribeFromReactions →
 * sendSuccess('reaction_unsubscribed', { channel, message }) which wraps as
 * { type:'reaction', action:'reaction_unsubscribed', success:true, data }.
 * The sibling reaction_subscribed frame is declared as ws.reaction.subscribed
 * in gateway-signal.ts (reconciled there to add success + data.message).
 */
export declare const wsReactionUnsubscribed: EventDeclaration;
/**
 * Consumed by clients that send client.reaction.getAvailable: the emoji →
 * effect catalog. GROUND TRUTH: ReactionService.handleGetAvailableReactions →
 * sendSuccess('available_reactions', { reactions }) wrapping as
 * { type:'reaction', action:'available_reactions', success:true, data }.
 */
export declare const wsReactionAvailable: EventDeclaration;
/**
 * Broadcast to CRDT channel subscribers: coalesced Y.js awareness updates.
 * GROUND TRUTH: server/AwarenessCoalescer._broadcast → sendToChannel(channel,
 * { type:'crdt:awareness', channel, updates:[{ clientId, update }] }). This is
 * the frame the dist actually emits — distinct from the historical
 * ws.crdt.awareness-batch declaration in gateway-signal.ts (different type
 * literal `crdt:awareness-batch` and different per-entry shape
 * { clientId, awareness }), which the current dist does NOT emit (noted there).
 */
export declare const wsCrdtAwareness: EventDeclaration;
//# sourceMappingURL=inbound-fanout.d.ts.map