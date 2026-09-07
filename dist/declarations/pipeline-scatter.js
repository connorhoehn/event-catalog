"use strict";
// src/declarations/pipeline-scatter.ts
//
// `pipeline:step:fanout` — the scatter dispatch signal.
//
// DECLARED 2026-09-07 by the declared-vs-emitted-vs-read audit. This event
// has been emitted and branched on for as long as scatter has existed and was
// never declared: it survived only because nothing on its path validates an
// undeclared name. That is exactly the shape the catalog is supposed to make
// impossible, so it is backfilled here rather than left to the next person to
// rediscover.
//
// PRODUCER — distributed-core:src/applications/pipeline/PipelineExecutor.ts:1809.
// A step handler returns `{ status:'completed', fanOut:{ items, maxConcurrency,
// itemAlias } }`; the executor fires this ONCE on the scatter source node with
// the arm count, then dispatches the downstream subgraph per item under
// synthesized stepIds of the form `${nodeId}:${armIndex}` (1-based). The
// per-arm work surfaces through the ordinary `pipeline:step:started` /
// `:completed` events, so this event is the only place the FAN-OUT WIDTH is
// stated. Nothing is emitted when the scatter source has no outgoing edges on
// its handle (PipelineExecutor.ts:1803 returns first), which is why an arm
// count of 0 is possible but a missing event is not a failure signal.
//
// CONSUMER — realtime-examples:frontend/src/components/pipelines/context/
// PipelineRunsContext.tsx:728 folds `count` onto the scatter source's step
// record as `output.fanoutCount`, so the run timeline can render "dispatched N
// arms" without scanning the wire log. It reads `runId`, `stepId` and `count`
// and nothing else.
//
// TRANSPORT — `signal`. It is emitted on the executor's in-process EventBus
// and bridged to the gateway for the live run view; the durable record of a
// scatter is the arm steps themselves in `pipelineRun.steps`, which are
// reconstructible without this event. Nothing retries on it and no worker
// consumes it, so there is nothing for the durable path to guarantee.
//
// The sibling `pipeline:scatter:arm:checkpoint` (PipelineExecutor.ts:1831) is
// deliberately NOT declared here: it is also undeclared, but it has no
// consumer in any repo, so declaring it would assert a contract nobody has
// agreed to. It is recorded in tests/consumer-contract-drift.test.ts instead.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineScatterDeclarations = exports.pipelineStepFanout = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'distributed-core';
const TAGS_BASE = ['pipeline', 'scatter', 'producer:distributed-core'];
exports.pipelineStepFanout = {
    namespace: 'pipeline',
    name: 'pipeline:step:fanout',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A scatter source node dispatched its arms. Fires exactly once per fan-out, on the source '
        + 'step, carrying the number of arms; the arms themselves report through the ordinary '
        + 'pipeline:step:* events under synthesized stepIds of the form `<nodeId>:<armIndex>`. '
        + 'This is the only event that states the fan-out width.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'observability'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: {
                type: 'string',
                description: 'Identifier of the scatter SOURCE node — the step whose handler returned `fanOut`. Arm steps carry `<stepId>:<armIndex>` instead.',
            },
            count: {
                type: 'integer',
                minimum: 0,
                description: 'Number of arms dispatched (`fanOut.items.length`). Folded onto the source step as `fanoutCount` by the run-detail reducer.',
            },
            at: { type: 'string', description: 'ISO-8601 timestamp at which the executor dispatched the arms.' },
        },
        required: ['runId', 'stepId', 'count', 'at'],
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/** Scatter / fan-out pipeline declarations for bulk-registration by consumers. */
exports.pipelineScatterDeclarations = [
    exports.pipelineStepFanout,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.pipelineScatterDeclarations);
//# sourceMappingURL=pipeline-scatter.js.map