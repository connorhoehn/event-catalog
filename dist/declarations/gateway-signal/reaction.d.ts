import type { EventDeclaration } from '../../types/index';
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
//# sourceMappingURL=reaction.d.ts.map