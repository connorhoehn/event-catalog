// src/pipeline.ts
//
// Pipeline event declarations subpath barrel.
//
// Subpath import: `import { ... } from '@connorhoehn/event-catalog/pipeline'`
//
// Consumers that only need pipeline event declarations (e.g. platform-api,
// pipeline-worker) can use this subpath to avoid pulling in the full
// event-catalog index (which includes gateway-signal, ag-ui, registry, and
// transport classes).
//
// All canonical declaration objects live in their originating modules under
// src/declarations/. This file re-exports them without modification.

// ---------------------------------------------------------------------------
// EC-1: P0 approval + checkpoint (dot-form, dual-transport)
// ---------------------------------------------------------------------------
export {
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineRunCheckpoint,
  pipelineDeclarations,
} from './declarations/pipeline';

// ---------------------------------------------------------------------------
// EC-2: P1 bulk signal declarations
// ---------------------------------------------------------------------------
export {
  pipelineRunCancelled,
  pipelineRunPaused,
  pipelineRunResumed,
  pipelineStepStarted,
  pipelineStepCompleted,
  pipelineStepFailed,
  pipelineStepSkipped,
  pipelineStepCancelled,
  pipelineStepHeartbeat,
  pipelineStepAttemptStarted,
  pipelineStepAttemptFailed,
  pipelineLlmPrompt,
  pipelineLlmToken,
  pipelineLlmResponse,
  pipelineLlmStreamOpened,
  pipelineContextPatched,
  pipelineContextPatchedUnvalidated,
  pipelineContextPatchReverted,
  pipelineP1Declarations,
} from './declarations/pipeline-p1';

// ---------------------------------------------------------------------------
// EC-10: P1/P2 remaining colon-form declarations
// ---------------------------------------------------------------------------
export {
  pipelineRunStarted,
  pipelineRunCompleted,
  pipelineRunFailed,
  pipelineRunOrphaned,
  pipelineRunReassigned,
  pipelineRunResumedFromStep,
  pipelineRunResumeFromStep,
  pipelineRunRetry,
  pipelineRunStuck,
  pipelineStepBreakpoint,
  pipelineJoinWaiting,
  pipelineJoinFired,
  pipelineP2Declarations,
} from './declarations/pipeline-p2';

// ---------------------------------------------------------------------------
// Wave 9d: pipeline:raft:run:* declarations (produced by platform-api)
// ---------------------------------------------------------------------------
export {
  pipelineRaftRunStarted,
  pipelineRaftRunUpdated,
  pipelineRaftRunSynthesized,
  pipelineRaftRunCheckpointed,
  pipelineRaftRunTerminated,
  pipelineRaftDeclarations,
  pipelineRaftStateMachineDeclarations,
} from './declarations/pipeline-raft';

// ---------------------------------------------------------------------------
// Wave 19: consolidated P0+P1+P2 aggregate + deprecated alias set
// ---------------------------------------------------------------------------
export {
  pipelineEventDeclarations,
} from './declarations/pipeline-events';

export {
  DEPRECATED_DUAL_EMIT_ALIASES,
} from './declarations/deprecated-pipeline-aliases';

// ---------------------------------------------------------------------------
// Wave 3 / JUDGE-EC: pipeline:judge:* declarations (producer: platform-api)
// ---------------------------------------------------------------------------
export {
  pipelineJudgeStarted,
  pipelineJudgeScored,
  pipelineJudgeFailed,
  pipelineJudgeBudgetExceeded,
  pipelineJudgeDeclarations,
} from './declarations/pipeline-judge';

// ---------------------------------------------------------------------------
// Wave 4 / VISION-EC: pipeline:image:vision:* declarations (producer: platform-api)
// ---------------------------------------------------------------------------
export {
  pipelineImageVisionStarted,
  pipelineImageVisionAnalyzed,
  pipelineImageVisionFailed,
  pipelineImageVisionDeclarations,
} from './declarations/pipeline-image-vision';
