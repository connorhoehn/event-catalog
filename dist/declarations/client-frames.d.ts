import type { EventDeclaration } from '../types/index';
/** Sent by GatewaySocketProvider when the 'chat' feature is active. */
export declare const clientChatJoin: EventDeclaration;
/** Sent by useChat cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export declare const clientChatLeave: EventDeclaration;
/** Sent by useChat.sendMessage(). */
export declare const clientChatSend: EventDeclaration;
/** Sent by useChat.loadHistory(). */
export declare const clientChatHistory: EventDeclaration;
/** Sent by usePresence on mount and by GatewaySocketProvider on connect. */
export declare const clientPresenceSubscribe: EventDeclaration;
/** Sent by usePresence on unmount/channel change. */
export declare const clientPresenceUnsubscribe: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientPresenceGet: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientPresenceHeartbeat: EventDeclaration;
/** Sent by usePresence.setStatus() / updateMetadata(). */
export declare const clientPresenceSet: EventDeclaration;
/** Sent by useReactions on mount (channel subscribe) as of realtime-modules 0.14.0. */
export declare const clientReactionSubscribe: EventDeclaration;
/** Sent by useReactions cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export declare const clientReactionUnsubscribe: EventDeclaration;
/** Sent by useReactions.react() — the gateway verb is `send`. */
export declare const clientReactionSend: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientReactionGetAvailable: EventDeclaration;
/** Sent by useActivity on mount. */
export declare const clientActivitySubscribe: EventDeclaration;
/** Sent by useActivity on unmount/channel change. */
export declare const clientActivityUnsubscribe: EventDeclaration;
/** Sent by useActivity.loadHistory() — the gateway verb is `getHistory`. */
export declare const clientActivityGetHistory: EventDeclaration;
/** Sent by useCRDT/useYjsDoc when (re)connecting to a CRDT channel. */
export declare const clientCrdtSubscribe: EventDeclaration;
/** Sent by useCRDT/useYjsDoc on unmount/channel change. */
export declare const clientCrdtUnsubscribe: EventDeclaration;
/** Sent by GatewayProvider doc-update handler and useCRDT.applyLocalEdit(). */
export declare const clientCrdtUpdate: EventDeclaration;
/** Sent (debounced 50ms) by GatewayProvider awareness handler. */
export declare const clientCrdtAwareness: EventDeclaration;
/** Sent by useFileUpload.upload() step 1. */
export declare const clientFileuploadRequestUpload: EventDeclaration;
/** Sent by useFileUpload after the XHR PUT to the presigned URL completes. */
export declare const clientFileuploadComplete: EventDeclaration;
/** Sent by useFileUpload.cancel(). */
export declare const clientFileuploadCancel: EventDeclaration;
/** Sent by useVideoHangout.start(). */
export declare const clientVideohangoutStart: EventDeclaration;
/** Sent by useVideoHangout.join(). */
export declare const clientVideohangoutJoin: EventDeclaration;
/** Sent by useVideoHangout.leave(). */
export declare const clientVideohangoutLeave: EventDeclaration;
/** Sent by useVideoHangout.end(). */
export declare const clientVideohangoutEnd: EventDeclaration;
/** Sent by useVideoHangout.toggleVideo(). */
export declare const clientVideohangoutToggleVideo: EventDeclaration;
/** Sent by useVideoHangout.toggleAudio(). */
export declare const clientVideohangoutToggleAudio: EventDeclaration;
/** Sent by useWebSocket.subscribe() and the auto-resubscribe-on-reconnect path. */
export declare const clientSubscribeSubscribe: EventDeclaration;
/** Sent by useWebSocket.unsubscribe(). */
export declare const clientSubscribeUnsubscribe: EventDeclaration;
/** Consumed by usePresence: a client joined the presence channel. */
export declare const wsPresenceJoined: EventDeclaration;
/** Consumed by usePresence: a client left the presence channel. */
export declare const wsPresenceLeft: EventDeclaration;
/** Consumed by useFileUpload: optional server-side upload progress. */
export declare const wsFileuploadProgress: EventDeclaration;
/** Consumed by useFileUpload: antivirus scan in progress. */
export declare const wsFileuploadScanning: EventDeclaration;
/** Consumed by useFileUpload: cancel acknowledged. */
export declare const wsFileuploadCancelled: EventDeclaration;
/** Consumed by useVideoHangout: a participant joined or updated. */
export declare const wsVideohangoutParticipant: EventDeclaration;
/** Consumed by useVideoHangout: a participant toggled video/audio. */
export declare const wsVideohangoutMedia: EventDeclaration;
/** Consumed by useNotifications: a new user-scoped notification arrived. */
export declare const wsNotificationNew: EventDeclaration;
/** Consumed by useNotifications: a notification was marked read (e.g. from another tab/device). */
export declare const wsNotificationRead: EventDeclaration;
/** Consumed by useNotifications: bulk replace/merge of the notification list. */
export declare const wsNotificationBulkUpdate: EventDeclaration;
/** Consumed by useCapability: a CRD-derived capability changed. */
export declare const wsCapabilityUpdated: EventDeclaration;
/** Consumed by useFeatureFlag: an app-level feature flag changed. */
export declare const wsFeatureFlagUpdated: EventDeclaration;
/**
 * All OUTBOUND client→gateway frame declarations (namespace `client`).
 * Producer is the realtime-modules client hook layer; the gateway consumes.
 */
export declare const clientFrameOutboundDeclarations: EventDeclaration[];
/**
 * INBOUND gateway→client push-frame declarations added in Wave A2 (GAP 2) —
 * frames the client hooks consume that were missing from gateway-signal.ts.
 */
export declare const clientContractInboundDeclarations: EventDeclaration[];
/** All Wave A2 client-frame contract declarations (outbound + inbound additions). */
export declare const clientFrameDeclarations: EventDeclaration[];
//# sourceMappingURL=client-frames.d.ts.map