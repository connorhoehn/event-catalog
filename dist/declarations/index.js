"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptionSummaryReady = exports.transcriptionTranscriptReady = exports.transcriptionJobQueued = exports.callCaptionLine = exports.pipelineImageVisionDeclarations = exports.pipelineImageVisionFailed = exports.pipelineImageVisionAnalyzed = exports.pipelineImageVisionToken = exports.pipelineImageVisionStarted = exports.pipelineJudgeDeclarations = exports.pipelineJudgeBudgetExceeded = exports.pipelineJudgeFailed = exports.pipelineJudgeScored = exports.pipelineJudgeStarted = exports.pipelineEventDeclarations = exports.orgiqSignalDeclarations = exports.orgiqArticlesReactions = exports.orgiqInvokePresence = exports.orgiqSearchPresence = exports.orgiqBriefsPresence = exports.orgiqResearcherActivity = exports.orgiqResearcherPresence = exports.clientFrameDeclarations = exports.clientContractInboundDeclarations = exports.clientFrameOutboundDeclarations = exports.gatewaySignalDeclarations = exports.pipelineRaftStateMachineDeclarations = exports.pipelineRaftDeclarations = exports.pipelineRaftRunTerminated = exports.pipelineRaftRunCheckpointed = exports.pipelineRaftRunSynthesized = exports.pipelineRaftRunUpdated = exports.pipelineRaftRunStarted = exports.pipelineP2Declarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineStepBreakpoint = exports.pipelineRunStuck = exports.pipelineRunRetry = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = exports.pipelineP1Declarations = exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = void 0;
exports.allDeclarations = exports.agUiDeclarations = exports.pipelineAgentDeclarations = exports.pipelineStepAgentTool = exports.callCaptionDeclarations = void 0;
var pipeline_1 = require("./pipeline");
Object.defineProperty(exports, "pipelineApprovalRequested", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRequested; } });
Object.defineProperty(exports, "pipelineApprovalRecorded", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRecorded; } });
Object.defineProperty(exports, "pipelineRunCheckpoint", { enumerable: true, get: function () { return pipeline_1.pipelineRunCheckpoint; } });
Object.defineProperty(exports, "pipelineDeclarations", { enumerable: true, get: function () { return pipeline_1.pipelineDeclarations; } });
var pipeline_p1_1 = require("./pipeline-p1");
Object.defineProperty(exports, "pipelineP1Declarations", { enumerable: true, get: function () { return pipeline_p1_1.pipelineP1Declarations; } });
var pipeline_p2_1 = require("./pipeline-p2");
Object.defineProperty(exports, "pipelineRunStarted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStarted; } });
Object.defineProperty(exports, "pipelineRunCompleted", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunCompleted; } });
Object.defineProperty(exports, "pipelineRunFailed", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunFailed; } });
Object.defineProperty(exports, "pipelineRunOrphaned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunOrphaned; } });
Object.defineProperty(exports, "pipelineRunReassigned", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunReassigned; } });
Object.defineProperty(exports, "pipelineRunResumedFromStep", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunResumedFromStep; } });
Object.defineProperty(exports, "pipelineRunRetry", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunRetry; } });
Object.defineProperty(exports, "pipelineRunStuck", { enumerable: true, get: function () { return pipeline_p2_1.pipelineRunStuck; } });
Object.defineProperty(exports, "pipelineStepBreakpoint", { enumerable: true, get: function () { return pipeline_p2_1.pipelineStepBreakpoint; } });
Object.defineProperty(exports, "pipelineJoinWaiting", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinWaiting; } });
Object.defineProperty(exports, "pipelineJoinFired", { enumerable: true, get: function () { return pipeline_p2_1.pipelineJoinFired; } });
Object.defineProperty(exports, "pipelineP2Declarations", { enumerable: true, get: function () { return pipeline_p2_1.pipelineP2Declarations; } });
var pipeline_raft_1 = require("./pipeline-raft");
Object.defineProperty(exports, "pipelineRaftRunStarted", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunStarted; } });
Object.defineProperty(exports, "pipelineRaftRunUpdated", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunUpdated; } });
Object.defineProperty(exports, "pipelineRaftRunSynthesized", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunSynthesized; } });
Object.defineProperty(exports, "pipelineRaftRunCheckpointed", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunCheckpointed; } });
Object.defineProperty(exports, "pipelineRaftRunTerminated", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftRunTerminated; } });
Object.defineProperty(exports, "pipelineRaftDeclarations", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftDeclarations; } });
Object.defineProperty(exports, "pipelineRaftStateMachineDeclarations", { enumerable: true, get: function () { return pipeline_raft_1.pipelineRaftStateMachineDeclarations; } });
var gateway_signal_1 = require("./gateway-signal");
Object.defineProperty(exports, "gatewaySignalDeclarations", { enumerable: true, get: function () { return gateway_signal_1.gatewaySignalDeclarations; } });
var client_frames_1 = require("./client-frames");
Object.defineProperty(exports, "clientFrameOutboundDeclarations", { enumerable: true, get: function () { return client_frames_1.clientFrameOutboundDeclarations; } });
Object.defineProperty(exports, "clientContractInboundDeclarations", { enumerable: true, get: function () { return client_frames_1.clientContractInboundDeclarations; } });
Object.defineProperty(exports, "clientFrameDeclarations", { enumerable: true, get: function () { return client_frames_1.clientFrameDeclarations; } });
var orgiq_signal_1 = require("./orgiq-signal");
Object.defineProperty(exports, "orgiqResearcherPresence", { enumerable: true, get: function () { return orgiq_signal_1.orgiqResearcherPresence; } });
Object.defineProperty(exports, "orgiqResearcherActivity", { enumerable: true, get: function () { return orgiq_signal_1.orgiqResearcherActivity; } });
Object.defineProperty(exports, "orgiqBriefsPresence", { enumerable: true, get: function () { return orgiq_signal_1.orgiqBriefsPresence; } });
Object.defineProperty(exports, "orgiqSearchPresence", { enumerable: true, get: function () { return orgiq_signal_1.orgiqSearchPresence; } });
Object.defineProperty(exports, "orgiqInvokePresence", { enumerable: true, get: function () { return orgiq_signal_1.orgiqInvokePresence; } });
Object.defineProperty(exports, "orgiqArticlesReactions", { enumerable: true, get: function () { return orgiq_signal_1.orgiqArticlesReactions; } });
Object.defineProperty(exports, "orgiqSignalDeclarations", { enumerable: true, get: function () { return orgiq_signal_1.orgiqSignalDeclarations; } });
var pipeline_events_1 = require("./pipeline-events");
Object.defineProperty(exports, "pipelineEventDeclarations", { enumerable: true, get: function () { return pipeline_events_1.pipelineEventDeclarations; } });
var pipeline_judge_1 = require("./pipeline-judge");
Object.defineProperty(exports, "pipelineJudgeStarted", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeStarted; } });
Object.defineProperty(exports, "pipelineJudgeScored", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeScored; } });
Object.defineProperty(exports, "pipelineJudgeFailed", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeFailed; } });
Object.defineProperty(exports, "pipelineJudgeBudgetExceeded", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeBudgetExceeded; } });
Object.defineProperty(exports, "pipelineJudgeDeclarations", { enumerable: true, get: function () { return pipeline_judge_1.pipelineJudgeDeclarations; } });
var pipeline_image_vision_1 = require("./pipeline-image-vision");
Object.defineProperty(exports, "pipelineImageVisionStarted", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionStarted; } });
Object.defineProperty(exports, "pipelineImageVisionToken", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionToken; } });
Object.defineProperty(exports, "pipelineImageVisionAnalyzed", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionAnalyzed; } });
Object.defineProperty(exports, "pipelineImageVisionFailed", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionFailed; } });
Object.defineProperty(exports, "pipelineImageVisionDeclarations", { enumerable: true, get: function () { return pipeline_image_vision_1.pipelineImageVisionDeclarations; } });
// v0.4.1 re-exported callCaptionDeclarations from the WRONG module
// (pipeline-image-vision) — a compile error for every consumer of the
// declarations barrel. Corrected in v0.4.2, with the individual
// declarations exported alongside the array.
var call_captions_1 = require("./call-captions");
Object.defineProperty(exports, "callCaptionLine", { enumerable: true, get: function () { return call_captions_1.callCaptionLine; } });
Object.defineProperty(exports, "transcriptionJobQueued", { enumerable: true, get: function () { return call_captions_1.transcriptionJobQueued; } });
Object.defineProperty(exports, "transcriptionTranscriptReady", { enumerable: true, get: function () { return call_captions_1.transcriptionTranscriptReady; } });
Object.defineProperty(exports, "transcriptionSummaryReady", { enumerable: true, get: function () { return call_captions_1.transcriptionSummaryReady; } });
Object.defineProperty(exports, "callCaptionDeclarations", { enumerable: true, get: function () { return call_captions_1.callCaptionDeclarations; } });
var pipeline_agent_1 = require("./pipeline-agent");
Object.defineProperty(exports, "pipelineStepAgentTool", { enumerable: true, get: function () { return pipeline_agent_1.pipelineStepAgentTool; } });
Object.defineProperty(exports, "pipelineAgentDeclarations", { enumerable: true, get: function () { return pipeline_agent_1.pipelineAgentDeclarations; } });
var ag_ui_1 = require("./ag-ui");
Object.defineProperty(exports, "agUiDeclarations", { enumerable: true, get: function () { return ag_ui_1.agUiDeclarations; } });
const pipeline_2 = require("./pipeline");
const pipeline_p1_2 = require("./pipeline-p1");
const pipeline_p2_2 = require("./pipeline-p2");
const pipeline_raft_2 = require("./pipeline-raft");
const gateway_signal_2 = require("./gateway-signal");
const client_frames_2 = require("./client-frames");
const ag_ui_2 = require("./ag-ui");
const orgiq_signal_2 = require("./orgiq-signal");
const pipeline_judge_2 = require("./pipeline-judge");
const pipeline_image_vision_2 = require("./pipeline-image-vision");
const call_captions_2 = require("./call-captions");
const pipeline_agent_2 = require("./pipeline-agent");
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
exports.allDeclarations = [
    ...pipeline_2.pipelineDeclarations,
    ...pipeline_p1_2.pipelineP1Declarations,
    ...pipeline_p2_2.pipelineP2Declarations,
    ...pipeline_raft_2.pipelineRaftDeclarations,
    ...pipeline_judge_2.pipelineJudgeDeclarations,
    ...pipeline_image_vision_2.pipelineImageVisionDeclarations,
    ...call_captions_2.callCaptionDeclarations,
    ...pipeline_agent_2.pipelineAgentDeclarations,
    ...gateway_signal_2.gatewaySignalDeclarations,
    ...client_frames_2.clientFrameDeclarations,
    ...ag_ui_2.agUiDeclarations,
    ...orgiq_signal_2.orgiqSignalDeclarations,
];
//# sourceMappingURL=index.js.map