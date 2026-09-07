import type { EventDeclaration } from '../../types/index';
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
//# sourceMappingURL=presence.d.ts.map