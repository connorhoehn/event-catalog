import type { EventDeclaration } from '../../types/index';
/** A mediasoup Producer was created on the cluster. */
export declare const sfuProducerAdded: EventDeclaration;
/** A mediasoup Producer was closed. */
export declare const sfuProducerRemoved: EventDeclaration;
/** Recording started or stopped for a channel. */
export declare const sfuRecordingStateChanged: EventDeclaration;
/** A producer's runtime state was patched by its owner (or a moderator). */
export declare const sfuProducerStateChanged: EventDeclaration;
/** A participant was forcibly disconnected from a channel. */
export declare const sfuParticipantDisconnected: EventDeclaration;
/** Cross-tab owner arbitration resolved for one member. */
export declare const sfuMemberOwnerChanged: EventDeclaration;
/**
 * A custom application chat event.
 *
 * NOTE ON THE NAME: this is a `stream-events` bus event, NOT one of the five
 * `chat-bus:<arn>` frames in ./chat-bus.ts, despite sharing the `sfu.chat.`
 * prefix. The wire type is the colon form `chat:event`; the catalog name uses
 * a dot because a `:` inside an `sfu.`-prefixed name would mix separators.
 */
export declare const sfuChatEvent: EventDeclaration;
//# sourceMappingURL=control-plane.d.ts.map