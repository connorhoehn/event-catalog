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

import {
    pipelineApprovalRequested,
    pipelineApprovalRecorded,
    pipelineRunCheckpoint,
} from './pipeline';

import {
    pipelineRunCancelled,
    pipelineStepStarted,
    pipelineStepCompleted,
    pipelineStepFailed,
    pipelineLlmPrompt,
    pipelineLlmResponse,
    pipelineContextPatched,
    pipelineContextPatchedUnvalidated,
    pipelineContextPatchReverted,
} from './pipeline-p1';

import {
    pipelineRunStuck,
    pipelineStepBreakpoint,
} from './pipeline-p2';

// Re-export individual constants for selective use.
export {
    // P0 approval (both transports)
    pipelineApprovalRequested,
    pipelineApprovalRecorded,
    // P0 checkpoint (signal)
    pipelineRunCheckpoint,
    // P1 run lifecycle
    pipelineRunCancelled,
    pipelineRunStuck,
    // P1 step lifecycle
    pipelineStepStarted,
    pipelineStepCompleted,
    pipelineStepFailed,
    pipelineStepBreakpoint,
    // P1 context mutations
    pipelineContextPatched,
    pipelineContextPatchedUnvalidated,
    pipelineContextPatchReverted,
    // P1 LLM observability
    pipelineLlmPrompt,
    pipelineLlmResponse,
};

/**
 * Consolidated list of 14 P0+P1 pipeline event declarations for
 * bulk-registration by consumers.
 *
 * Includes:
 *   - 2 approval events (transport: 'both' — signal + durable)
 *   - 12 P1 lifecycle/observability signal events
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
export const pipelineEventDeclarations = [
    // P0 — approval + checkpoint
    pipelineApprovalRequested,
    pipelineApprovalRecorded,
    pipelineRunCheckpoint,
    // P1 — run lifecycle
    pipelineRunCancelled,
    pipelineRunStuck,
    // P1 — step lifecycle
    pipelineStepStarted,
    pipelineStepCompleted,
    pipelineStepFailed,
    pipelineStepBreakpoint,
    // P1 — context mutations
    pipelineContextPatched,
    pipelineContextPatchedUnvalidated,
    pipelineContextPatchReverted,
    // P1 — LLM observability
    pipelineLlmPrompt,
    pipelineLlmResponse,
];
