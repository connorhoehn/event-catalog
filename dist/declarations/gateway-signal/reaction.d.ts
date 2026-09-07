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
/**
 * Broadcast to channel subscribers when a reaction is removed.
 *
 * CORRECTED 2026-09-07. This declaration carried a 2026-06-12 note claiming
 * the dist ReactionService the gateway runs "has NO reaction-remove action".
 * That is false and was false when the note was written: the service builds
 * the frame at realtime-modules:dist/reactions/ReactionService.js:330 (src at
 * src/reactions/ReactionService.ts:403) and useReactions filters state on it
 * at realtime-modules:src/client/useReactions.ts:163.
 *
 * The stale note hid a live (e)-class defect: `data.id` was REQUIRED and the
 * producer has never sent it, so every real removal frame failed validation.
 * The consumer does not want `id` either — it matches on the durable
 * (targetId, emoji, userId) triple precisely BECAUSE ids differ between the
 * live broadcast and the history replay.
 */
export declare const wsReactionRemoved: EventDeclaration;
/** List of current reactions in a channel, sent in response to a list request. */
export declare const wsReactionList: EventDeclaration;
/**
 * Durable reaction replay, sent to ONE client on subscribe.
 *
 * DECLARED 2026-09-07. This is the frame that actually replays stored
 * reactions, and until now it was invisible to the catalog: the only
 * replay event declared was `ws.reaction.list` (action `reaction_list`),
 * an action no producer uses. So the catalog documented a frame that never
 * arrives and said nothing about the one that carries the data.
 *
 * Producer: realtime-modules:src/reactions/ReactionService.ts:473
 * (`_replayStoredReactions` → `sendSuccess(clientId, 'reaction_history', …)`,
 * so the frame gets `success: true` from `sendSuccess` at :537).
 * Consumer: realtime-modules:src/client/useReactions.ts:143, which REPLACES
 * its list rather than appending — this frame is the state, not more events.
 *
 * Transport is `signal`: it is addressed to a single live socket at
 * subscribe time and is meaningless once that connection is gone. The
 * durability lives in the store the rows are read from, not in this frame.
 *
 * `required` is deliberately just `{channel}` on `data`. The consumer's
 * guard is `data.channel === channel && Array.isArray(data.reactions)`, and
 * a channel with no stored reactions still gets a frame — with `reactions`
 * present but empty, never absent — so requiring more would reject nothing
 * real while risking a future emitter that omits the empty array.
 */
export declare const wsReactionHistory: EventDeclaration;
/**
 * Confirmation sent to the sender after their reaction is broadcast.
 * GROUND-TRUTH RECONCILE (2026-06-12, divergence note b): emitted via
 * sendSuccess, so the wire frame carries success:true and
 * data:{ reactionId, emoji, channel, timestamp } (the data fields and the
 * success flag were previously undeclared).
 */
export declare const wsReactionSent: EventDeclaration;
//# sourceMappingURL=reaction.d.ts.map