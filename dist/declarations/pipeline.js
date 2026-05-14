"use strict";
// src/declarations/pipeline.ts
//
// Wave 1 / track EC-1 — canonical pipeline event declarations.
//
// Cross-service pipeline events that flow off `distributed-core`'s
// `PipelineExecutor` (a library, not a runtime service) and need a
// declaration somewhere so that consumers (gateway, platform-api,
// pipeline-worker) get a single source of truth for the wire shape.
//
// Producer is recorded as `distributed-core` for the colon-form signal
// emissions; durable counterparts (forwarded by platform-api in M4.4 v2)
// list `platform-api` as the durable producer.
//
// These three are the P0 set unblocking M4.4 v2 approval forwarding via
// the durable bus, identified in
// `websocket-gateway/.agent/EVENT_CATALOG_GAPS.md`. Subsequent EC tracks
// will declare the remaining ~27 colon-form pipeline events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineDeclarations = exports.pipelineRunCheckpoint = exports.pipelineApprovalRecorded = exports.pipelineApprovalRequested = void 0;
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
exports.pipelineApprovalRequested = {
    name: 'pipeline.approval.requested',
    description: 'A pipeline approval node has been entered and is awaiting one or more '
        + 'approvers. Emitted on the in-process bus by distributed-core; forwarded '
        + 'onto the durable bus by platform-api (M4.4 v2) so workers and audit '
        + 'consumers receive it across restarts.',
    transport: 'both',
    producer: ['distributed-core', 'platform-api'],
    tags: ['pipeline', 'approval', 'p0'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            approverIds: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
            },
            requestedAt: { type: 'number' },
        },
        required: ['runId', 'stepId', 'approverIds', 'requestedAt'],
        additionalProperties: true,
    },
    aliases: [
        { name: 'pipeline:approval:requested', deprecated: true },
    ],
};
/**
 * `pipeline.approval.recorded` — emitted when an approver records a
 * decision (approve / reject) against a pending approval. Dual-transport
 * for the same reason as `pipeline.approval.requested`.
 *
 * Signal-side emission uses colon-form `pipeline:approval:recorded`
 * (PipelineExecutor.ts:521/544/1979) with payload
 * `{ runId, stepId, userId, decision, comment?, reason?, at }`.
 */
exports.pipelineApprovalRecorded = {
    name: 'pipeline.approval.recorded',
    description: 'An approver has recorded a decision against a pending pipeline '
        + 'approval. `decision` is the recorded outcome; `comment` carries an '
        + 'optional reviewer note. Dual-emitted on signal + durable so audit '
        + 'and worker consumers both see the decision.',
    transport: 'both',
    producer: ['distributed-core', 'platform-api'],
    tags: ['pipeline', 'approval', 'p0'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            approver: { type: 'string' },
            decision: { type: 'string', enum: ['approve', 'reject'] },
            comment: { type: 'string' },
            decidedAt: { type: 'number' },
        },
        required: ['runId', 'stepId', 'approver', 'decision', 'decidedAt'],
        additionalProperties: true,
    },
    aliases: [
        { name: 'pipeline:approval:recorded', deprecated: true },
    ],
};
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
exports.pipelineRunCheckpoint = {
    name: 'pipeline.run.checkpoint',
    description: 'A periodic snapshot of a running pipeline\'s execution context + '
        + 'frontier, emitted on the signal bus by distributed-core for audit '
        + 'and replay. Signal-only — durable replay relies on step-completion '
        + 'events, not the checkpoint stream.',
    transport: 'signal',
    producer: 'distributed-core',
    tags: ['pipeline', 'checkpoint', 'p0', 'audit'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            context: { type: 'object', additionalProperties: true },
            currentStepIds: {
                type: 'array',
                items: { type: 'string' },
            },
            sequenceNumber: { type: 'number' },
            at: { type: 'string' },
        },
        required: ['runId', 'context', 'currentStepIds', 'sequenceNumber', 'at'],
        additionalProperties: true,
    },
    aliases: [
        { name: 'pipeline:run:checkpoint', deprecated: true },
    ],
};
/**
 * All pipeline declarations exported by this module. Consumers can
 * iterate this list to bulk-register, or import the individual constants
 * for selective use.
 */
exports.pipelineDeclarations = [
    exports.pipelineApprovalRequested,
    exports.pipelineApprovalRecorded,
    exports.pipelineRunCheckpoint,
];
//# sourceMappingURL=pipeline.js.map