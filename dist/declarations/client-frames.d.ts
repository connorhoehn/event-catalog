import type { EventDeclaration } from '../types/index';
export { clientChatJoin, clientChatLeave, clientChatSend, clientChatTyping, clientChatMembers, clientChatAddMembers, clientChatRemoveMember, clientChatEdit, clientChatDelete, clientChatHistory, clientPresenceSubscribe, clientPresenceUnsubscribe, clientPresenceGet, clientPresenceHeartbeat, clientPresenceSet, clientReactionSubscribe, clientReactionUnsubscribe, clientReactionSend, clientReactionGetAvailable, clientActivitySubscribe, clientActivityUnsubscribe, clientActivityGetHistory, clientCrdtSubscribe, clientCrdtUnsubscribe, clientCrdtUpdate, clientCrdtSeedDocument, clientCrdtAwareness, clientSubscribeSubscribe, clientSubscribeUnsubscribe, } from './client-frames/outbound-fanout';
export { clientFileuploadRequestUpload, clientFileuploadComplete, clientFileuploadCancel, clientVideohangoutStart, clientVideohangoutJoin, clientVideohangoutLeave, clientVideohangoutEnd, clientVideohangoutToggleVideo, clientVideohangoutToggleAudio, } from './client-frames/outbound-media';
export { wsPresenceJoined, wsPresenceLeft, wsReactionUnsubscribed, wsReactionAvailable, wsCrdtAwareness, } from './client-frames/inbound-fanout';
export { wsFileuploadUrl, wsFileuploadComplete, wsFileuploadFailed, wsFileuploadStarted, wsFileuploadProgress, wsFileuploadScanning, wsFileuploadCancelled, wsVideohangoutParticipant, wsVideohangoutMedia, } from './client-frames/inbound-media';
export { wsNotificationNew, wsNotificationRead, wsNotificationBulkUpdate, } from './client-frames/inbound-notification';
export { wsCapabilityUpdated, wsFeatureFlagUpdated, } from './client-frames/inbound-control-plane';
export { clientCallMeta, clientCallSetDocuments, clientCallPresent, clientCallSetTitle, clientCallMuteParticipant, clientCallRemoveParticipant, clientCallTransferHost, } from './client-frames/outbound-call';
export { clientMeetingSubscribe, clientMeetingUnsubscribe, clientMeetingHandRaise, clientMeetingHandLower, clientMeetingHandLowerAll, clientMeetingBreakoutConfigure, clientMeetingBreakoutAddRoom, clientMeetingBreakoutRename, clientMeetingBreakoutAssign, clientMeetingBreakoutAutoAssign, clientMeetingBreakoutOpen, clientMeetingBreakoutClose, clientMeetingBreakoutTimer, clientMeetingBreakoutBroadcast, clientMeetingBreakoutJoin, clientMeetingBreakoutLeave, clientMeetingBreakoutEnd, clientMeetingDeclarations, } from './client-frames/outbound-meeting';
export declare const clientFrameOutboundDeclarations: EventDeclaration[];
/**
 * INBOUND gateway→client push-frame declarations added in Wave A2 (GAP 2) —
 * frames the client hooks consume that were missing from gateway-signal.ts.
 */
export declare const clientContractInboundDeclarations: EventDeclaration[];
/** All Wave A2 client-frame contract declarations (outbound + inbound additions). */
export declare const clientFrameDeclarations: EventDeclaration[];
//# sourceMappingURL=client-frames.d.ts.map