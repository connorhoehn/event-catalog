import type { EventDeclaration } from '../types';
import { pipelineApprovalRequested, pipelineApprovalRecorded, pipelineRunCheckpoint } from './pipeline';
import { pipelineRunCancelled, pipelineStepStarted, pipelineStepCompleted, pipelineStepFailed, pipelineLlmPrompt, pipelineLlmResponse, pipelineContextPatched, pipelineContextPatchedUnvalidated, pipelineContextPatchReverted } from './pipeline-p1';
import { pipelineRunStarted, pipelineRunCompleted, pipelineRunFailed, pipelineRunOrphaned, pipelineRunReassigned, pipelineRunResumedFromStep, pipelineRunRetry, pipelineRunStuck, pipelineStepBreakpoint, pipelineJoinWaiting, pipelineJoinFired } from './pipeline-p2';
import { pipelineJudgeStarted, pipelineJudgeScored, pipelineJudgeFailed, pipelineJudgeBudgetExceeded } from './pipeline-judge';
import { pipelineImageVisionStarted, pipelineImageVisionToken, pipelineImageVisionAnalyzed, pipelineImageVisionFailed } from './pipeline-image-vision';
export { pipelineApprovalRequested, pipelineApprovalRecorded, pipelineRunCheckpoint, pipelineRunCancelled, pipelineRunStuck, pipelineStepStarted, pipelineStepCompleted, pipelineStepFailed, pipelineStepBreakpoint, pipelineContextPatched, pipelineContextPatchedUnvalidated, pipelineContextPatchReverted, pipelineLlmPrompt, pipelineLlmResponse, pipelineRunStarted, pipelineRunCompleted, pipelineRunFailed, pipelineRunOrphaned, pipelineRunReassigned, pipelineRunResumedFromStep, pipelineRunRetry, pipelineJoinWaiting, pipelineJoinFired, pipelineJudgeStarted, pipelineJudgeScored, pipelineJudgeFailed, pipelineJudgeBudgetExceeded, pipelineImageVisionStarted, pipelineImageVisionToken, pipelineImageVisionAnalyzed, pipelineImageVisionFailed, };
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
export declare const pipelineEventDeclarations: EventDeclaration[];
//# sourceMappingURL=pipeline-events.d.ts.map