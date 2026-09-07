import type { EventDeclaration } from '../types/index';
export { wsChatJoined, wsChatLeft, wsChatMessage, wsChatSent, wsChatHistory, } from './gateway-signal/chat';
export { wsCursorSubscribed, wsCursorUnsubscribed, wsCursorUpdate, wsCursorRemove, wsCursorClear, wsCursorBatch, wsCursorList, wsCursorModes, } from './gateway-signal/cursor';
export { wsActivitySubscribed, wsActivityUnsubscribed, wsActivityPublished, wsActivityHistory, wsActivityEvent, } from './gateway-signal/activity';
export { wsCrdtSubscribed, wsCrdtUnsubscribed, wsCrdtSnapshot, wsCrdtUpdate, wsCrdtSyncRequest, wsCrdtSyncResponse, wsCrdtDocReplaced, wsCrdtSnapshotStored, wsCrdtAwarenessBatch, } from './gateway-signal/crdt';
export { wsPresenceSet, wsPresenceUpdate, wsPresenceSubscribed, wsPresenceUnsubscribed, wsPresenceData, wsPresenceOffline, } from './gateway-signal/presence';
export { wsReactionSubscribed, wsReactionReceived, wsReactionRemoved, wsReactionList, wsReactionSent, } from './gateway-signal/reaction';
export { wsCallInvite, wsCallAccepted, wsCallDeclined, wsCallCancelled, wsCallEnded, wsCallVideoOn, wsCallVideoOff, wsCallRecordingStarted, wsCallRecordingCompleted, } from './gateway-signal/call';
export { wsPipelineSubscribed, wsPipelineUnsubscribed, wsPipelineAck, wsPipelineSnapshot, wsPipelineHistory, wsPipelineEvent, } from './gateway-signal/pipeline';
export { wsUploadRequested, wsUploadUrlIssued, wsUploadCompleted, wsUploadFailed, wsUploadScanned, wsUploadScanQuarantined, wsUploadUrlRevoked, } from './gateway-signal/upload';
export { wsError } from './gateway-signal/error';
/**
 * All gateway WS signal frame declarations.
 * Pass to `catalog.declare()` at boot to register every frame type the
 * websocket-gateway sends to clients.
 */
export declare const gatewaySignalDeclarations: EventDeclaration[];
//# sourceMappingURL=gateway-signal.d.ts.map