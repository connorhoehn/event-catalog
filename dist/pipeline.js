"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineJudgeDeclarations = exports.pipelineJudgeBudgetExceeded = exports.pipelineJudgeFailed = exports.pipelineJudgeScored = exports.pipelineJudgeStarted = exports.DEPRECATED_DUAL_EMIT_ALIASES = exports.pipelineEventDeclarations = exports.pipelineRaftStateMachineDeclarations = exports.pipelineRaftDeclarations = exports.pipelineRaftRunTerminated = exports.pipelineRaftRunCheckpointed = exports.pipelineRaftRunSynthesized = exports.pipelineRaftRunUpdated = exports.pipelineRaftRunStarted = exports.pipelineP2Declarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineStepBreakpoint = exports.pipelineRunStuck = exports.pipelineRunRetry = exports.pipelineRunResumeFromStep = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = exports.pipelineP1Declarations = exports.pipelineContextPatchReverted = exports.pipelineContextPatchedUnvalidated = exports.pipelineContextPatched = exports.pipelineLlmStreamOpened = exports.pipelineLlmResponse = exports.pipelineLlmToken = exports.pipelineLlmPrompt = exports.pipelineStepAttemptFailed = exports.pipelineStepAttemptStarted = exports.pipelineStepHeartbeat = exports.pipelineStepCancelled = exports.pipelineStepSkipped = exports.pipelineStepFailed = exports.pipelineStepCompleted = exports.pipelineStepStarted = exports.pipelineRunResumed = exports.pipelineRunPaused = exports.pipelineRunCancelled = exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = void 0;
exports.pipelineImageVisionDeclarations = exports.pipelineImageVisionFailed = exports.pipelineImageVisionAnalyzed = exports.pipelineImageVisionStarted = void 0;
// ---------------------------------------------------------------------------
// EC-1: P0 approval + checkpoint (dot-form, dual-transport)
// ---------------------------------------------------------------------------
var pipeline_1 = require("./declarations/pipeline");
Object.defineProperty(exports, "pipelineApprovalRequested", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRequested; } });
Object.defineProperty(exports, "pipelineApprovalRecorded", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRecorded; } });
Object.defineProperty(exports, "pipelineRunCheckpoint", { enumerable: true, get: function () { return pipeline_1.pipelineRunCheckpoint; } });
Object.defineProperty(exports, "pipelineDeclarations", { enumerable: true, get: function () { return pipeline_1.pipelineDeclarations; } });
// ---------------------------------------------------------------------------
// EC-2: P1 bulk signal declarations
// ---------------------------------------------------------------------------
var pipeline_p1_1 = require("./declarations/pipeline-p1");
Object.defineProperty(exports, "pipelineRunCancelled", { enumerable: true, get: function () { return pipeline_p1_1.pipelineRunCancelled; } });
Object.defineProperty(exports, "pipelineRunPaused", { enumerable: true, get: function () { return pipeline_p1_1.pipelineRunPaused; } });
Object.defineProperty(exports, "pipelineRunResumed", { enumerable: true, get: function () { return pipeline_p1_1.pipelineRunResumed; } });
Object.defineProperty(exports, "pipelineStepStarted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepStarted; } });
Object.defineProperty(exports, "pipelineStepCompleted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepCompleted; } });
Object.defineProperty(exports, "pipelineStepFailed", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepFailed; } });
Object.defineProperty(exports, "pipelineStepSkipped", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepSkipped; } });
Object.defineProperty(exports, "pipelineStepCancelled", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepCancelled; } });
Object.defineProperty(exports, "pipelineStepHeartbeat", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepHeartbeat; } });
Object.defineProperty(exports, "pipelineStepAttemptStarted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepAttemptStarted; } });
Object.defineProperty(exports, "pipelineStepAttemptFailed", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepAttemptFailed; } });
Object.defineProperty(exports, "pipelineLlmPrompt", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmPrompt; } });
Object.defineProperty(exports, "pipelineLlmToken", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmToken; } });
Object.defineProperty(exports, "pipelineLlmResponse", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmResponse; } });
Object.defineProperty(exports, "pipelineLlmStreamOpened", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmStreamOpened; } });
Object.defineProperty(exports, "pipelineContextPatched", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatched; } });
Object.defineProperty(exports, "pipelineContextPatchedUnvalidated", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatchedUnvalidated; } });
Object.defineProperty(exports, "pipelineContextPatchReverted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatchReverted; } });
Object.defineProperty(exports, "pipelineP1Declarations", { enumerable: true, get: function () { return pipeline_p1_1.pipelineP1Declarations; } });
// ---------------------------------------------------------------------------
// EC-10: P1/P2 remaining colon-form declarations
// ---------------------------------------------------------------------------
var pipeline_p2_1 = require("./declarations/pipeline-p2");
Object.defineProperty(exports, "pipelineRunStarted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStarted; } });
Object.defineProperty(exports, "pipelineRunCompleted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunCompleted; } });
Object.defineProperty(exports, "pipelineRunFailed", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunFailed; } });
Object.defineProperty(exports, "pipelineRunOrphaned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunOrphaned; } });
Object.defineProperty(exports, "pipelineRunReassigned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunReassigned; } });
Object.defineProperty(exports, "pipelineRunResumedFromStep", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunResumedFromStep; } });
Object.defineProperty(exports, "pipelineRunResumeFromStep", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunResumeFromStep; } });
Object.defineProperty(exports, "pipelineRunRetry", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunRetry; } });
Object.defineProperty(exports, "pipelineRunStuck", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStuck; } });
Object.defineProperty(exports, "pipelineStepBreakpoint", { enumerable: true, get: function () { return pipeline_p2_1.pipelineStepBreakpoint; } });
Object.defineProperty(exports, "pipelineJoinWaiting", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinWaiting; } });
Object.defineProperty(exports, "pipelineJoinFired", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinFired; } });
Object.defineProperty(exports, "pipelineP2Declarations", { enumerable: true, get: function () { return pipeline_p2_1.pipelineP2Declarations; } });
// ---------------------------------------------------------------------------
// Wave 9d: pipeline:raft:run:* declarations (produced by platform-api)
// ---------------------------------------------------------------------------
var pipeline_raft_1 = require("./declarations/pipeline-raft");
Object.defineProperty(exports, "pipelineRaftRunStarted", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunStarted; } });
Object.defineProperty(exports, "pipelineRaftRunUpdated", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunUpdated; } });
Object.defineProperty(exports, "pipelineRaftRunSynthesized", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunSynthesized; } });
Object.defineProperty(exports, "pipelineRaftRunCheckpointed", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunCheckpointed; } });
Object.defineProperty(exports, "pipelineRaftRunTerminated", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunTerminated; } });
Object.defineProperty(exports, "pipelineRaftDeclarations", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftDeclarations; } });
Object.defineProperty(exports, "pipelineRaftStateMachineDeclarations", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftStateMachineDeclarations; } });
// ---------------------------------------------------------------------------
// Wave 19: consolidated P0+P1+P2 aggregate + deprecated alias set
// ---------------------------------------------------------------------------
var pipeline_events_1 = require("./declarations/pipeline-events");
Object.defineProperty(exports, "pipelineEventDeclarations", { enumerable: true, get: function () { return pipeline_events_1.pipelineEventDeclarations; } });
var deprecated_pipeline_aliases_1 = require("./declarations/deprecated-pipeline-aliases");
Object.defineProperty(exports, "DEPRECATED_DUAL_EMIT_ALIASES", { enumerable: true, get: function () { return deprecated_pipeline_aliases_1.DEPRECATED_DUAL_EMIT_ALIASES; } });
// ---------------------------------------------------------------------------
// Wave 3 / JUDGE-EC: pipeline:judge:* declarations (producer: platform-api)
// ---------------------------------------------------------------------------
var pipeline_judge_1 = require("./declarations/pipeline-judge");
Object.defineProperty(exports, "pipelineJudgeStarted", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeStarted; } });
Object.defineProperty(exports, "pipelineJudgeScored", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeScored; } });
Object.defineProperty(exports, "pipelineJudgeFailed", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeFailed; } });
Object.defineProperty(exports, "pipelineJudgeBudgetExceeded", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeBudgetExceeded; } });
Object.defineProperty(exports, "pipelineJudgeDeclarations", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeDeclarations; } });
// ---------------------------------------------------------------------------
// Wave 4 / VISION-EC: pipeline:image:vision:* declarations (producer: platform-api)
// ---------------------------------------------------------------------------
var pipeline_image_vision_1 = require("./declarations/pipeline-image-vision");
Object.defineProperty(exports, "pipelineImageVisionStarted", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionStarted; } });
Object.defineProperty(exports, "pipelineImageVisionAnalyzed", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionAnalyzed; } });
Object.defineProperty(exports, "pipelineImageVisionFailed", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionFailed; } });
Object.defineProperty(exports, "pipelineImageVisionDeclarations", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionDeclarations; } });
//# sourceMappingURL=pipeline.js.map