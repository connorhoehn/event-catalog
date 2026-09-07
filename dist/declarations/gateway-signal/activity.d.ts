import type { EventDeclaration } from '../../types/index';
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
//# sourceMappingURL=activity.d.ts.map