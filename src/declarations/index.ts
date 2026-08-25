// src/declarations/index.ts
//
// Aggregated declarations exported by `@connorhoehn/event-catalog` for
// platform-wide cross-service events. Consumers `import { pipelineDeclarations }`
// (or individual constants) and feed them into `catalog.declare()` at boot.
//
// This module is the canonical home for events whose producer is a library
// (e.g. `distributed-core`) and therefore has no single service that can
// own its declaration. Service-owned events still live in the producing
// service's own source tree per the charter.

export {
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineRunCheckpoint,
  pipelineDeclarations,
} from './pipeline';

export {
  pipelineP1Declarations,
} from './pipeline-p1';

export {
  pipelineRunStarted,
  pipelineRunCompleted,
  pipelineRunFailed,
  pipelineRunOrphaned,
  pipelineRunReassigned,
  pipelineRunResumedFromStep,
  pipelineRunRetry,
  pipelineRunStuck,
  pipelineStepBreakpoint,
  pipelineJoinWaiting,
  pipelineJoinFired,
  pipelineP2Declarations,
} from './pipeline-p2';

export {
  pipelineRaftRunStarted,
  pipelineRaftRunUpdated,
  pipelineRaftRunSynthesized,
  pipelineRaftRunCheckpointed,
  pipelineRaftRunTerminated,
  pipelineRaftDeclarations,
  pipelineRaftStateMachineDeclarations,
} from './pipeline-raft';

export { gatewaySignalDeclarations } from './gateway-signal';

export {
  clientFrameOutboundDeclarations,
  clientContractInboundDeclarations,
  clientFrameDeclarations,
} from './client-frames';

export {
  orgiqResearcherPresence,
  orgiqResearcherActivity,
  orgiqBriefsPresence,
  orgiqSearchPresence,
  orgiqInvokePresence,
  orgiqArticlesReactions,
  orgiqSignalDeclarations,
} from './orgiq-signal';

export {
  pipelineEventDeclarations,
} from './pipeline-events';

export {
  pipelineJudgeStarted,
  pipelineJudgeScored,
  pipelineJudgeFailed,
  pipelineJudgeBudgetExceeded,
  pipelineJudgeDeclarations,
} from './pipeline-judge';

export {
  pipelineImageVisionStarted,
  pipelineImageVisionToken,
  pipelineImageVisionAnalyzed,
  pipelineImageVisionFailed,
  pipelineImageVisionDeclarations,
} from './pipeline-image-vision';

// v0.4.1 re-exported callCaptionDeclarations from the WRONG module
// (pipeline-image-vision) — a compile error for every consumer of the
// declarations barrel. Corrected in v0.4.2, with the individual
// declarations exported alongside the array.
export {
  callCaptionLine,
  transcriptionJobQueued,
  transcriptionTranscriptReady,
  transcriptionSummaryReady,
  callCaptionDeclarations,
} from './call-captions';

export {
  pipelineStepAgentTool,
  pipelineAgentDeclarations,
} from './pipeline-agent';

export { agUiDeclarations } from './ag-ui';

import type { EventDeclaration } from '../types/index';
import { pipelineDeclarations } from './pipeline';
import { pipelineP1Declarations } from './pipeline-p1';
import { pipelineP2Declarations } from './pipeline-p2';
import { pipelineRaftDeclarations } from './pipeline-raft';
import { gatewaySignalDeclarations } from './gateway-signal';
import { clientFrameDeclarations } from './client-frames';
import { agUiDeclarations } from './ag-ui';
import { orgiqSignalDeclarations } from './orgiq-signal';
import { pipelineJudgeDeclarations } from './pipeline-judge';
import { pipelineImageVisionDeclarations } from './pipeline-image-vision';
import { callCaptionDeclarations } from './call-captions';
import { pipelineAgentDeclarations } from './pipeline-agent';

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
export const allDeclarations: readonly EventDeclaration[] = [
  ...pipelineDeclarations,
  ...pipelineP1Declarations,
  ...pipelineP2Declarations,
  ...pipelineRaftDeclarations,
  ...pipelineJudgeDeclarations,
  ...pipelineImageVisionDeclarations,
  ...callCaptionDeclarations,
  ...pipelineAgentDeclarations,
  ...gatewaySignalDeclarations,
  ...clientFrameDeclarations,
  ...agUiDeclarations,
  ...orgiqSignalDeclarations,
];
