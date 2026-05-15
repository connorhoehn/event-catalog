import { pipelineApprovalRequested, pipelineApprovalRecorded, pipelineRunCheckpoint } from './pipeline';
import { pipelineRunCancelled, pipelineStepStarted, pipelineStepCompleted, pipelineStepFailed, pipelineLlmPrompt, pipelineLlmResponse, pipelineContextPatched, pipelineContextPatchedUnvalidated, pipelineContextPatchReverted } from './pipeline-p1';
import { pipelineRunStuck, pipelineStepBreakpoint } from './pipeline-p2';
export { pipelineApprovalRequested, pipelineApprovalRecorded, pipelineRunCheckpoint, pipelineRunCancelled, pipelineRunStuck, pipelineStepStarted, pipelineStepCompleted, pipelineStepFailed, pipelineStepBreakpoint, pipelineContextPatched, pipelineContextPatchedUnvalidated, pipelineContextPatchReverted, pipelineLlmPrompt, pipelineLlmResponse, };
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
export declare const pipelineEventDeclarations: import("..").EventDeclaration[];
//# sourceMappingURL=pipeline-events.d.ts.map