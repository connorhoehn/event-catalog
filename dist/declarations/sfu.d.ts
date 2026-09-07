import type { EventDeclaration } from '../types/index';
/** A WebRTC transport session opened for one participant. */
export declare const sfuSessionCreated: EventDeclaration;
/** A WebRTC transport session closed. */
export declare const sfuSessionEnded: EventDeclaration;
/** A producer track was added — a live stream going online. */
export declare const sfuStreamStarted: EventDeclaration;
/** A producer track was removed. */
export declare const sfuStreamEnded: EventDeclaration;
/** Stream health fell below thresholds. */
export declare const sfuStreamHealthDegraded: EventDeclaration;
/** Stream health returned to nominal. */
export declare const sfuStreamHealthRecovered: EventDeclaration;
/** A new thumbnail snapshot was written. */
export declare const sfuStreamThumbnailUpdated: EventDeclaration;
/** A recording session opened. */
export declare const sfuRecordingStarted: EventDeclaration;
/**
 * A recording session finalized.
 *
 * The widest schema in the namespace, and the one LVS's own copy got most
 * wrong: seven producer fields were missing under `additionalProperties:
 * false`. platform-api's lvsWebhooks route is the live consumer and reads
 * every one of them.
 */
export declare const sfuRecordingCompleted: EventDeclaration;
/** A new channel was created. */
export declare const sfuChannelCreated: EventDeclaration;
/** A field on an existing channel was mutated. */
export declare const sfuChannelUpdated: EventDeclaration;
/** A channel was hard-deleted. */
export declare const sfuChannelDeleted: EventDeclaration;
/** A mediasoup Producer was created on the cluster. */
export declare const sfuProducerAdded: EventDeclaration;
/** A mediasoup Producer was closed. */
export declare const sfuProducerRemoved: EventDeclaration;
/** Recording started or stopped for a channel. */
export declare const sfuRecordingStateChanged: EventDeclaration;
/** A chat message was sent. */
export declare const sfuChatMessage: EventDeclaration;
/** A chat message was deleted by a moderator. */
export declare const sfuChatMessageDeleted: EventDeclaration;
/** A user was forcibly disconnected from chat. */
export declare const sfuChatUserDisconnected: EventDeclaration;
/** A user was banned from chat. */
export declare const sfuChatUserBanned: EventDeclaration;
/** A previously banned user was unbanned. */
export declare const sfuChatUserUnbanned: EventDeclaration;
/** Every event the SFU emits: 12 durable webhook, 3 control-plane, 5 chat-bus. */
export declare const sfuDeclarations: EventDeclaration[];
//# sourceMappingURL=sfu.d.ts.map