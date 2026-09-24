"use strict";
// src/declarations/pipeline-p2.ts
//
// Wave 4 / track EC-10 — remaining P1/P2 colon-form pipeline event
// declarations.
//
// Wraps up M5 by declaring every event in DC's `PipelineEventMap` that
// wave1-ec-1 (`./pipeline.ts`) and wave1-ec-2 (`./pipeline-p1.ts`) left
// uncovered. Cross-checked against
// `distributed-core/src/applications/pipeline/types.ts` at DC v0.18.2.
//
// Coverage map (full PipelineEventMap as of DC v0.18.2):
//   EC-1 (dot-form, colon alias):
//     pipeline.approval.requested      (alias: pipeline:approval:requested)
//     pipeline.approval.recorded       (alias: pipeline:approval:recorded)
//     pipeline.run.checkpoint          (alias: pipeline:run:checkpoint)
//   EC-2:
//     pipeline:run:cancelled, pipeline:run:paused*, pipeline:run:resumed*,
//     pipeline:step:started, :completed, :failed, :skipped, :cancelled,
//     pipeline:step:heartbeat, :attempt:started, :attempt:failed,
//     pipeline:llm:prompt, :token, :response, :stream:opened,
//     pipeline:step:context.patched, .patched-unvalidated, .patch-reverted
//   EC-10 (this file):
//     pipeline:run:started, :completed, :failed,
//     pipeline:run:orphaned, :reassigned, :stuck,
//     pipeline:run:resumed-from-step,
//     pipeline:step:breakpoint,
//     pipeline:join:waiting, :fired
//
// * `pipeline:run:paused` / `:resumed` are flagged `reserved` in EC-2 —
//   their producers were removed from DC in v0.16.0. Not redeclared here.
//
// Producer is `distributed-core` for every event in this file (in-process
// EventBus emissions). Transport is `signal` — none are durable today.
// Payload shapes mirror `PipelineEventMap`. Schemas use
// `additionalProperties: true` per the additive-first convention.
//
// Notes on field shapes:
//   - `pipeline:run:failed` carries `error: PipelineRunError`, a structured
//     object (not a string). Schema declares it as a loose object.
//   - `pipeline:run:stuck` carries `lastHeartbeatAt: string | null` —
//     schema uses `type: ['string', 'null']` accordingly.
//   - `pipeline:run:resumed-from-step` carries an optional
//     `originalFailedStepId` — declared as a non-required property.
//   - `pipeline:run:orphaned` and `:reassigned` are emitted by the
//     ResourceRouter (still part of DC), not the PipelineExecutor itself.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineP2Declarations = exports.pipelineJoinFired = exports.pipelineJoinWaiting = exports.pipelineStepBreakpoint = exports.pipelineRunStuck = exports.pipelineRunRetry = exports.pipelineRunResumeFromStep = exports.pipelineRunResumedFromStep = exports.pipelineRunReassigned = exports.pipelineRunOrphaned = exports.pipelineRunFailed = exports.pipelineRunCompleted = exports.pipelineRunStarted = void 0;
const field_glossary_1 = require("./field-glossary");
const pipeline_p1_1 = require("./pipeline-p1");
const PRODUCER = 'distributed-core';
const TAGS_BASE = ['pipeline', 'producer:distributed-core'];
/**
 * P2-specific field meanings. Shared names (runId, stepId, at, error,
 * durationMs, attempt …) resolve from the common glossary.
 */
const FIELDS = {
    triggeredBy: 'What caused the run to start (manual, schedule, webhook, …) plus the trigger\'s own metadata.',
    from: 'Cluster node id the run was reassigned away from.',
    to: 'Cluster node id the run was reassigned to.',
    previousOwner: 'Cluster node id that owned the run before it was orphaned.',
    fromNodeId: 'Pipeline node id the run is being restarted from.',
    originalFailedStepId: 'Step id that failed on the original run, when the resume was triggered by a failure.',
    received: 'Number of join inputs received so far.',
    required: 'Number of join inputs required before the join fires.',
    inputs: 'Ordered step ids that contributed the inputs this join fired on.',
};
/** Common envelope-shape builder for events whose payload follows the
 *  `{ runId, ...fields, at }` pattern emitted by PipelineExecutor. */
function pipelineSchema(extra, required) {
    return {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            at: { type: 'string', description: 'ISO-8601 timestamp' },
            ...extra,
        },
        required: ['runId', ...required, 'at'],
        additionalProperties: true,
    };
}
// ---------------------------------------------------------------------------
// Run lifecycle (started, completed, failed)
// ---------------------------------------------------------------------------
exports.pipelineRunStarted = {
    namespace: 'pipeline',
    name: 'pipeline:run:started',
    aliases: [{ name: 'pipeline.run.started', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'PipelineExecutor started a new run. `triggeredBy` describes the trigger (manual, schedule, webhook, etc.).',
    tags: [...TAGS_BASE, 'run-lifecycle'],
    schema: pipelineSchema({
        pipelineId: { type: 'string' },
        triggeredBy: { type: 'object', additionalProperties: true },
    }, ['pipelineId', 'triggeredBy']),
};
exports.pipelineRunCompleted = {
    namespace: 'pipeline',
    name: 'pipeline:run:completed',
    aliases: [{ name: 'pipeline.run.completed', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'PipelineExecutor completed a run successfully.',
    tags: [...TAGS_BASE, 'run-lifecycle'],
    schema: pipelineSchema({ durationMs: { type: 'number' }, artifactIds: pipeline_p1_1.ARTIFACT_IDS }, ['durationMs']),
};
exports.pipelineRunFailed = {
    namespace: 'pipeline',
    name: 'pipeline:run:failed',
    aliases: [{ name: 'pipeline.run.failed', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'PipelineExecutor terminated a run with an error. `error` is a structured `PipelineRunError` object (not a plain string).',
    tags: [...TAGS_BASE, 'run-lifecycle'],
    schema: pipelineSchema({ error: { type: 'object', additionalProperties: true } }, ['error']),
};
// ---------------------------------------------------------------------------
// Distribution events (emitted by ResourceRouter inside distributed-core)
// ---------------------------------------------------------------------------
exports.pipelineRunOrphaned = {
    namespace: 'pipeline',
    name: 'pipeline:run:orphaned',
    aliases: [{ name: 'pipeline.run.orphaned', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'A run lost its previous owner (node left the cluster, lease expired, etc.). Emitted by ResourceRouter before reassignment.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'distribution'],
    schema: pipelineSchema({ previousOwner: { type: 'string' } }, ['previousOwner']),
};
exports.pipelineRunReassigned = {
    namespace: 'pipeline',
    name: 'pipeline:run:reassigned',
    aliases: [{ name: 'pipeline.run.reassigned', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'A run was reassigned from one cluster node to another. Pair with `pipeline:run:orphaned` for the full handoff trail.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'distribution'],
    schema: pipelineSchema({
        from: { type: 'string' },
        to: { type: 'string' },
    }, ['from', 'to']),
};
// ---------------------------------------------------------------------------
// Resume-from-step (hub#2222)
// ---------------------------------------------------------------------------
exports.pipelineRunResumedFromStep = {
    namespace: 'pipeline',
    name: 'pipeline:run:resumed-from-step',
    aliases: [{ name: 'pipeline.run.resumed-from-step', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'A previously-failed (or completed, if explicitly opted in) run was restarted from `fromNodeId`. Fires before the dispatch loop re-enters at `fromNodeId`.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'resume'],
    schema: pipelineSchema({
        fromNodeId: { type: 'string' },
        originalFailedStepId: { type: 'string' },
    }, ['fromNodeId']),
};
// ---------------------------------------------------------------------------
// Resume-from-step request stub (wave10-e / gateway-local path)
// ---------------------------------------------------------------------------
//
// Emitted by the websocket-gateway's `handleResumeFromStep` fallback when no
// PipelineModule is wired in. This is a gateway-synthesised stub event — it
// carries the same intent (resume from a specific node) but is NOT the DC
// PipelineExecutor's past-tense completion event (`pipeline:run:resumed-from-step`).
//
// Future: once the gateway is always wired to a real PipelineModule this event
// will only appear in dev/test environments.
//
// Producer: websocket-gateway (local EventEmitter fallback, not DC).
exports.pipelineRunResumeFromStep = {
    namespace: 'pipeline',
    name: 'pipeline:run:resumeFromStep',
    transport: 'signal',
    producer: 'websocket-gateway',
    description: 'Gateway-local stub event emitted when handleResumeFromStep is invoked without a PipelineModule. Signals intent to resume a run from `fromNodeId`. For the DC-sourced completion event see `pipeline:run:resumed-from-step`.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'resume', 'gateway-stub'],
    schema: pipelineSchema({
        fromNodeId: { type: 'string' },
    }, ['fromNodeId']),
};
// ---------------------------------------------------------------------------
// Run retry (emitted by PipelineExecutor when a run-level retry is scheduled)
// ---------------------------------------------------------------------------
exports.pipelineRunRetry = {
    namespace: 'pipeline',
    name: 'pipeline:run:retry',
    aliases: [{ name: 'pipeline.run.retry', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'PipelineExecutor is about to retry a run. `attempt` is the 1-based retry counter. Emitted before the run re-enters execution.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'retry'],
    schema: pipelineSchema({ attempt: { type: 'number' } }, ['attempt']),
};
// ---------------------------------------------------------------------------
// Stuck-run detection
// ---------------------------------------------------------------------------
exports.pipelineRunStuck = {
    namespace: 'pipeline',
    name: 'pipeline:run:stuck',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by StuckRunDetector when a `running` / `awaiting_approval` run has not received a heartbeat (step heartbeat or LLM token) for `stuckThresholdMs`. `lastHeartbeatAt` is null when no heartbeat was ever observed.',
    tags: [...TAGS_BASE, 'run-lifecycle', 'stuck', 'observability'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            lastHeartbeatAt: {
                type: ['string', 'null'],
                description: 'ISO-8601 timestamp of last observed heartbeat, or null if never seen',
            },
            at: { type: 'string', description: 'ISO-8601 timestamp' },
        },
        required: ['runId', 'lastHeartbeatAt', 'at'],
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// Debug breakpoint
// ---------------------------------------------------------------------------
exports.pipelineStepBreakpoint = {
    namespace: 'pipeline',
    name: 'pipeline:step:breakpoint',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A step in a debug run has paused at its breakpoint. Pairs with hub#2226 context-patch events for edit-and-continue flows.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'debug', 'breakpoint'],
    schema: pipelineSchema({ stepId: { type: 'string' } }, ['stepId']),
};
// ---------------------------------------------------------------------------
// Join bookkeeping (observability / debugging)
// ---------------------------------------------------------------------------
exports.pipelineJoinWaiting = {
    namespace: 'pipeline',
    name: 'pipeline:join:waiting',
    aliases: [{ name: 'pipeline.join.waiting', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'A join node has received some but not all required inputs. `received` / `required` expose the per-join progress for dashboards.',
    tags: [...TAGS_BASE, 'join', 'observability'],
    schema: pipelineSchema({
        stepId: { type: 'string' },
        received: { type: 'number' },
        required: { type: 'number' },
    }, ['stepId', 'received', 'required']),
};
exports.pipelineJoinFired = {
    namespace: 'pipeline',
    name: 'pipeline:join:fired',
    aliases: [{ name: 'pipeline.join.fired', deprecated: true }],
    transport: 'signal',
    producer: PRODUCER,
    description: 'A join node has received all required inputs and dispatched downstream. `inputs` is the ordered list of contributing step IDs.',
    tags: [...TAGS_BASE, 'join', 'observability'],
    schema: pipelineSchema({
        stepId: { type: 'string' },
        inputs: { type: 'array', items: { type: 'string' } },
    }, ['stepId', 'inputs']),
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/**
 * All P1/P2 colon-form pipeline signal declarations introduced by EC-10.
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use. Pair with `pipelineP1Declarations` from
 * EC-2 to register the full DC `PipelineEventMap` minus EC-1's approval
 * + checkpoint trio.
 */
exports.pipelineP2Declarations = [
    // run lifecycle
    exports.pipelineRunStarted,
    exports.pipelineRunCompleted,
    exports.pipelineRunFailed,
    // distribution
    exports.pipelineRunOrphaned,
    exports.pipelineRunReassigned,
    // resume
    exports.pipelineRunResumedFromStep,
    exports.pipelineRunResumeFromStep,
    // retry
    exports.pipelineRunRetry,
    // stuck-run
    exports.pipelineRunStuck,
    // debug
    exports.pipelineStepBreakpoint,
    // join
    exports.pipelineJoinWaiting,
    exports.pipelineJoinFired,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.pipelineP2Declarations, FIELDS);
//# sourceMappingURL=pipeline-p2.js.map