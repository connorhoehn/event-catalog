"use strict";
// src/declarations/pipeline-events.ts
//
// Wave 19 / Part A — consolidated pipelineEventDeclarations aggregate.
//
// Groups the 16 P0+P1 pipeline event declarations from existing EC modules
// into a single named export so consumers (platform-api, pipeline-worker)
// can bulk-register them with a single import rather than pulling from
// multiple modules.
//
// P0 — approval (2 signal + 2 durable):
//   `pipeline:approval:requested`   (signal, alias via pipeline.approval.requested)
//   `pipeline:approval:recorded`    (signal, alias via pipeline.approval.recorded)
//   `pipeline.approval.requested`   (durable, transport: 'both', producer: distributed-core + platform-api)
//   `pipeline.approval.recorded`    (durable, transport: 'both', producer: distributed-core + platform-api)
//
// P1 — pipeline lifecycle (12 signal, producer: distributed-core):
//   pipeline:run:cancelled
//   pipeline:run:checkpoint         (signal alias via pipeline.run.checkpoint)
//   pipeline:run:stuck
//   pipeline:step:started
//   pipeline:step:completed
//   pipeline:step:failed
//   pipeline:step:breakpoint
//   pipeline:step:context.patched
//   pipeline:step:context.patched-unvalidated
//   pipeline:step:context.patch-reverted
//   pipeline:llm:prompt
//   pipeline:llm:response
//
// The canonical declaration objects live in their originating modules
// (pipeline.ts, pipeline-p1.ts, pipeline-p2.ts). This file re-exports
// them and assembles the aggregate list. Do not add new declaration
// constants here — add them to the appropriate module and then include
// them in the list below.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineEventDeclarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineRunRetry = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = exports.pipelineLlmResponse = exports.pipelineLlmPrompt = exports.pipelineContextPatchReverted = exports.pipelineContextPatchedUnvalidated = exports.pipelineContextPatched = exports.pipelineStepBreakpoint = exports.pipelineStepFailed = exports.pipelineStepCompleted = exports.pipelineStepStarted = exports.pipelineRunStuck = exports.pipelineRunCancelled = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = void 0;
const pipeline_1 = require("./pipeline");
Object.defineProperty(exports, "pipelineApprovalRequested", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRequested; } });
Object.defineProperty(exports, "pipelineApprovalRecorded", { enumerable: true, get: function () { return pipeline_1.pipelineApprovalRecorded; } });
Object.defineProperty(exports, "pipelineRunCheckpoint", { enumerable: true, get: function () { return pipeline_1.pipelineRunCheckpoint; } });
const pipeline_p1_1 = require("./pipeline-p1");
Object.defineProperty(exports, "pipelineRunCancelled", { enumerable: true, get: function () { return pipeline_p1_1.pipelineRunCancelled; } });
Object.defineProperty(exports, "pipelineStepStarted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepStarted; } });
Object.defineProperty(exports, "pipelineStepCompleted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepCompleted; } });
Object.defineProperty(exports, "pipelineStepFailed", { enumerable: true, get: function () { return pipeline_p1_1.pipelineStepFailed; } });
Object.defineProperty(exports, "pipelineLlmPrompt", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmPrompt; } });
Object.defineProperty(exports, "pipelineLlmResponse", { enumerable: true, get: function () { return pipeline_p1_1.pipelineLlmResponse; } });
Object.defineProperty(exports, "pipelineContextPatched", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatched; } });
Object.defineProperty(exports, "pipelineContextPatchedUnvalidated", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatchedUnvalidated; } });
Object.defineProperty(exports, "pipelineContextPatchReverted", { enumerable: true, get: function () { return pipeline_p1_1.pipelineContextPatchReverted; } });
const pipeline_p2_1 = require("./pipeline-p2");
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
/**
 * Consolidated list of P0+P1+P2 pipeline event declarations for
 * bulk-registration by consumers.
 *
 * Includes:
 *   - 3 P0 events: 2 approval events (transport: 'both') + 1 checkpoint
 *   - 12 P1 lifecycle/observability signal events
 *   - 9 P2 run lifecycle + join signal events (wave20-a)
 *
 * Note: `pipeline:approval:requested` and `pipeline:approval:recorded`
 * are exposed via aliases on the canonical dot-form declarations. The
 * Registry will resolve colon-form lookups to the canonical entry.
 *
 * Usage:
 * ```ts
 * import { pipelineEventDeclarations } from '@connorhoehn/event-catalog';
 * for (const decl of pipelineEventDeclarations) {
 *   catalog.declare(decl);
 * }
 * ```
 */
exports.pipelineEventDeclarations = [
    // P0 — approval + checkpoint
    pipeline_1.pipelineApprovalRequested,
    pipeline_1.pipelineApprovalRecorded,
    pipeline_1.pipelineRunCheckpoint,
    // P1 — run lifecycle
    pipeline_p1_1.pipelineRunCancelled,
    pipeline_p2_1.pipelineRunStuck,
    // P1 — step lifecycle
    pipeline_p1_1.pipelineStepStarted,
    pipeline_p1_1.pipelineStepCompleted,
    pipeline_p1_1.pipelineStepFailed,
    pipeline_p2_1.pipelineStepBreakpoint,
    // P1 — context mutations
    pipeline_p1_1.pipelineContextPatched,
    pipeline_p1_1.pipelineContextPatchedUnvalidated,
    pipeline_p1_1.pipelineContextPatchReverted,
    // P1 — LLM observability
    pipeline_p1_1.pipelineLlmPrompt,
    pipeline_p1_1.pipelineLlmResponse,
    // P2 — run lifecycle (wave20-a)
    pipeline_p2_1.pipelineRunStarted,
    pipeline_p2_1.pipelineRunCompleted,
    pipeline_p2_1.pipelineRunFailed,
    pipeline_p2_1.pipelineRunOrphaned,
    pipeline_p2_1.pipelineRunReassigned,
    pipeline_p2_1.pipelineRunResumedFromStep,
    pipeline_p2_1.pipelineRunRetry,
    // P2 — join bookkeeping (wave20-a)
    pipeline_p2_1.pipelineJoinWaiting,
    pipeline_p2_1.pipelineJoinFired,
];
//# sourceMappingURL=pipeline-events.js.map