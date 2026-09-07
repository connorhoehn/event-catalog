import type { EventDeclaration } from '../types/index';
/**
 * `activity.recorded` — every user-initiated activity-feed entry.
 *
 * Dual transport, and both halves are load-bearing:
 *   - durable: platform-api's activity-consumer drains the queue and writes
 *     the `user-activity` DDB table idempotently (sort key
 *     `<timestamp>#<envelope id>`), then re-dispatches the event as a
 *     pipeline trigger.
 *   - signal: the live `activity:event` WS frame subscribers already see.
 *
 * The durable copy is produced by intercepting the activity library's single
 * `historyStore.append()` call, so the persisted payload is byte-identical to
 * the one broadcast — no re-enrichment, no timestamp drift.
 */
export declare const activityRecorded: EventDeclaration;
/**
 * `call:reaction.recorded` — durable capture of one in-call emoji reaction.
 *
 * Published from the ReactionService `onReaction` tap for `call:`-prefixed
 * channels only; targeted (message) reactions go to the reactions store
 * instead and never reach here. Live fan-out stays on the signal reaction
 * frames — this event exists so playback, retros and transcript injection
 * can query the exact [startedAt, endedAt] window of a recording.
 */
export declare const callReactionRecorded: EventDeclaration;
/** Every durable business event the websocket-gateway publishes. */
export declare const gatewayDurableDeclarations: EventDeclaration[];
//# sourceMappingURL=gateway-durable.d.ts.map