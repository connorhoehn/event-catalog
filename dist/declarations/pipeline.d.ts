import type { EventDeclaration } from '../types/index';
/**
 * `pipeline.approval.requested` — emitted by `PipelineExecutor` when an
 * approval node is entered. Dual-transport: signal (in-process bus →
 * gateway WS frame) AND durable (M4.4 v2 forwards via SQS so workers
 * can pick up the request after a restart).
 *
 * The signal-side emission today uses the colon-form name
 * `pipeline:approval:requested` (PipelineExecutor.ts:1933) with payload
 * `{ runId, stepId, approvers, at }`. The durable wire-shape is the
 * canonical contract declared here.
 */
export declare const pipelineApprovalRequested: EventDeclaration;
/**
 * `pipeline.approval.recorded` — emitted when an approver records a
 * decision (approve / reject) against a pending approval. Dual-transport
 * for the same reason as `pipeline.approval.requested`.
 *
 * Signal-side emission uses colon-form `pipeline:approval:recorded`
 * (PipelineExecutor.ts:521/544/1979) with payload
 * `{ runId, stepId, userId, decision, comment?, reason?, at }`.
 */
export declare const pipelineApprovalRecorded: EventDeclaration;
/**
 * `pipeline.run.checkpoint` — signal-only. Emitted by `PipelineExecutor`
 * after every N successful steps (cadence configured per-executor) as a
 * WAL-replayable snapshot of the in-flight run. Consumed by audit
 * subscribers; not currently a candidate for the durable bus (snapshots
 * are large and recoverable from step-completion events).
 *
 * Emission site: PipelineExecutor.ts:2316 — payload
 * `{ runId, context, currentStepIds, sequenceNumber, at }`. `at` is an
 * ISO-8601 timestamp string (not a number) on the colon-form side.
 */
export declare const pipelineRunCheckpoint: EventDeclaration;
/**
 * All pipeline declarations exported by this module. Consumers can
 * iterate this list to bulk-register, or import the individual constants
 * for selective use.
 */
export declare const pipelineDeclarations: EventDeclaration[];
//# sourceMappingURL=pipeline.d.ts.map