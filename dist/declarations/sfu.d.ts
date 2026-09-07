import type { EventDeclaration } from '../types/index';
export { sfuSessionCreated, sfuSessionEnded, sfuStreamStarted, sfuStreamEnded, sfuStreamHealthDegraded, sfuStreamHealthRecovered, sfuStreamThumbnailUpdated, sfuRecordingStarted, sfuRecordingCompleted, sfuChannelCreated, sfuChannelUpdated, sfuChannelDeleted, } from './sfu/webhook';
export { sfuProducerAdded, sfuProducerRemoved, sfuRecordingStateChanged, sfuProducerStateChanged, sfuParticipantDisconnected, sfuMemberOwnerChanged, sfuChatEvent, } from './sfu/control-plane';
export { sfuRecordingComposeQueued, sfuRecordingComposeStarted, sfuRecordingComposeProgress, sfuRecordingComposeFailed, sfuRecordingComposeCompleted, } from './sfu/recording-compose';
export { sfuChatMessage, sfuChatMessageDeleted, sfuChatUserDisconnected, sfuChatUserBanned, sfuChatUserUnbanned, } from './sfu/chat-bus';
/** Every event the SFU emits: 12 durable webhook, 7 control-plane, 5 compose-job, 5 chat-bus. */
export declare const sfuDeclarations: EventDeclaration[];
//# sourceMappingURL=sfu.d.ts.map