import type { EventDeclaration } from '../types/index';
export { clientChatJoin, clientChatLeave, clientChatSend, clientChatTyping, clientChatHistory, clientPresenceSubscribe, clientPresenceUnsubscribe, clientPresenceGet, clientPresenceHeartbeat, clientPresenceSet, clientReactionSubscribe, clientReactionUnsubscribe, clientReactionSend, clientReactionGetAvailable, clientActivitySubscribe, clientActivityUnsubscribe, clientActivityGetHistory, clientCrdtSubscribe, clientCrdtUnsubscribe, clientCrdtUpdate, clientCrdtAwareness, clientSubscribeSubscribe, clientSubscribeUnsubscribe, } from './client-frames/outbound-fanout';
export { clientFileuploadRequestUpload, clientFileuploadComplete, clientFileuploadCancel, clientVideohangoutStart, clientVideohangoutJoin, clientVideohangoutLeave, clientVideohangoutEnd, clientVideohangoutToggleVideo, clientVideohangoutToggleAudio, } from './client-frames/outbound-media';
export { wsPresenceJoined, wsPresenceLeft, wsReactionUnsubscribed, wsReactionAvailable, wsCrdtAwareness, } from './client-frames/inbound-fanout';
export { wsFileuploadUrl, wsFileuploadComplete, wsFileuploadFailed, wsFileuploadStarted, wsFileuploadProgress, wsFileuploadScanning, wsFileuploadCancelled, wsVideohangoutParticipant, wsVideohangoutMedia, } from './client-frames/inbound-media';
export { wsNotificationNew, wsNotificationRead, wsNotificationBulkUpdate, } from './client-frames/inbound-notification';
export { wsCapabilityUpdated, wsFeatureFlagUpdated, } from './client-frames/inbound-control-plane';
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