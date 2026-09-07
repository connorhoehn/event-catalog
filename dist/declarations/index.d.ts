export { pipelineApprovalRequested, pipelineApprovalRecorded, pipelineRunCheckpoint, pipelineDeclarations, } from './pipeline';
export { pipelineP1Declarations, } from './pipeline-p1';
export { pipelineRunStarted, pipelineRunCompleted, pipelineRunFailed, pipelineRunOrphaned, pipelineRunReassigned, pipelineRunResumedFromStep, pipelineRunRetry, pipelineRunStuck, pipelineStepBreakpoint, pipelineJoinWaiting, pipelineJoinFired, pipelineP2Declarations, } from './pipeline-p2';
export { pipelineRaftRunStarted, pipelineRaftRunUpdated, pipelineRaftRunSynthesized, pipelineRaftRunCheckpointed, pipelineRaftRunTerminated, pipelineRaftDeclarations, pipelineRaftStateMachineDeclarations, } from './pipeline-raft';
export { gatewaySignalDeclarations } from './gateway-signal';
export { activityRecorded, callReactionRecorded, gatewayDurableDeclarations, } from './gateway-durable';
export { sfuSessionCreated, sfuSessionEnded, sfuStreamStarted, sfuStreamEnded, sfuStreamHealthDegraded, sfuStreamHealthRecovered, sfuStreamThumbnailUpdated, sfuRecordingStarted, sfuRecordingCompleted, sfuChannelCreated, sfuChannelUpdated, sfuChannelDeleted, sfuProducerAdded, sfuProducerRemoved, sfuRecordingStateChanged, sfuProducerStateChanged, sfuParticipantDisconnected, sfuMemberOwnerChanged, sfuChatEvent, sfuRecordingComposeQueued, sfuRecordingComposeStarted, sfuRecordingComposeProgress, sfuRecordingComposeFailed, sfuRecordingComposeCompleted, sfuChatMessage, sfuChatMessageDeleted, sfuChatUserDisconnected, sfuChatUserBanned, sfuChatUserUnbanned, sfuDeclarations, } from './sfu';
export { clientFrameOutboundDeclarations, clientContractInboundDeclarations, clientFrameDeclarations, } from './client-frames';
export { orgiqResearcherPresence, orgiqResearcherActivity, orgiqBriefsPresence, orgiqSearchPresence, orgiqInvokePresence, orgiqArticlesReactions, orgiqSignalDeclarations, } from './orgiq-signal';
export { pipelineEventDeclarations, } from './pipeline-events';
export { pipelineJudgeStarted, pipelineJudgeScored, pipelineJudgeFailed, pipelineJudgeBudgetExceeded, pipelineJudgeDeclarations, } from './pipeline-judge';
export { pipelineImageVisionStarted, pipelineImageVisionToken, pipelineImageVisionAnalyzed, pipelineImageVisionFailed, pipelineImageVisionDeclarations, } from './pipeline-image-vision';
export { callCaptionLine, transcriptionJobQueued, transcriptionTranscriptReady, transcriptionSummaryReady, callCaptionDeclarations, } from './call-captions';
export { pipelineStepAgentTool, pipelineAgentDeclarations, } from './pipeline-agent';
export { agUiDeclarations } from './ag-ui';
import type { EventDeclaration } from '../types/index';
/**
 * The flat set of every event this repo declares on behalf of producers
 * that don't import event-catalog directly (distributed-core et al).
 * Used by `scripts/regen-registry-snapshot.ts` to build the shipped
 * `contracts/registry.snapshot.json` that producer CI compares against.
 *
 * Each event name appears exactly once. Convenience re-exports
 * (pipelineEventDeclarations, pipelineRaftStateMachineDeclarations) are
 * excluded here because their events are already covered by the canonical
 * per-phase arrays above — including them would produce silent duplicates.
 */
export declare const allDeclarations: readonly EventDeclaration[];
//# sourceMappingURL=index.d.ts.map