"use strict";
// src/declarations/pipeline-raft.ts
//
// Wave 9 / track 9d — pipeline:raft:run:* signal declarations.
//
// These events are emitted by PipelineRaftStateMachine (inside platform-api)
// on its per-replica Node EventEmitter. They are DISTINCT from DC's
// PipelineExecutor events (`pipeline:run:*`) which carry different payloads
// and are produced by `distributed-core`:
//
//   - DC executor:        pipeline:run:started  (producer: distributed-core)
//   - Raft SM:            pipeline:raft:run:started (producer: platform-api)
//
// Transport is `signal` (in-process). These events never cross the gateway
// bridge — they exist for in-process consumers (MultiRaft coordinator,
// postmortem aggregators, SM unit test suite).
//
// Payload shape: every event carries `{ runId: string, slot: RaftSlot }`.
// `slot` is the full or partial Raft slot record as it exists after the
// command is applied. `terminated` additionally restricts `status` to the
// three terminal values.
//
// Previously declared inline via `catalog.declare()` in
// `platform-api/src/lib/event-catalog.ts`. Moved here in wave9-d so they
// ship to all consumers automatically without local re-declaration.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineRaftStateMachineDeclarations = exports.pipelineRaftDeclarations = exports.pipelineRaftRunTerminated = exports.pipelineRaftRunCheckpointed = exports.pipelineRaftRunSynthesized = exports.pipelineRaftRunUpdated = exports.pipelineRaftRunStarted = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'platform-api';
const TAGS_BASE = ['producer:platform-api', 'pipeline', 'raft'];
/**
 * Raft-slot field meanings. Keys are dotted paths where the name only makes
 * sense inside the slot record; bare names (runId, status …) fall through to
 * the common glossary.
 */
const FIELDS = {
    slot: 'The Raft slot record for this run as it exists after the command was applied.',
    'slot.status': 'Run status recorded in the slot after the command applied.',
    'slot.lastEvent': 'Name of the most recent state-machine command applied to this slot.',
    'slot.lastAppliedIndex': 'Raft log index of the most recent command applied to this slot.',
    'slot.ownerNodeId': 'Cluster node id that owns execution of this run.',
    'slot.checkpoint': 'Opaque checkpoint blob written by the last run-checkpointed command.',
};
// Common slot sub-schema (base fields present on every Raft slot record).
const slotBase = {
    type: 'object',
    properties: {
        runId: { type: 'string' },
        status: { type: 'string' },
        lastEvent: { type: 'string' },
        lastEventAt: { type: 'string' },
        lastAppliedIndex: { type: 'number' },
    },
    required: ['runId', 'status', 'lastAppliedIndex'],
    additionalProperties: true,
};
// ---------------------------------------------------------------------------
// pipeline:raft:run:started
// ---------------------------------------------------------------------------
exports.pipelineRaftRunStarted = {
    namespace: 'pipeline',
    name: 'pipeline:raft:run:started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by PipelineRaftStateMachine when a run-started command applies. '
        + 'Distinct from DC executor\'s `pipeline:run:started` (which has a different '
        + 'payload + producer). Payload is the full Raft slot record.',
    tags: TAGS_BASE,
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            slot: {
                ...slotBase,
                properties: {
                    ...slotBase.properties,
                    pipelineId: { type: 'string' },
                    pipelineVersion: { type: 'number' },
                    ownerNodeId: { type: 'string' },
                    checkpoint: { type: 'object', additionalProperties: true },
                },
            },
        },
        required: ['runId', 'slot'],
        // Explicit — mirrors the implicit JSON Schema default. DC adds slot
        // fields ahead of this declaration, so the envelope stays open.
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// pipeline:raft:run:updated
// ---------------------------------------------------------------------------
exports.pipelineRaftRunUpdated = {
    namespace: 'pipeline',
    name: 'pipeline:raft:run:updated',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by PipelineRaftStateMachine when a run-updated command transitions '
        + 'an existing run\'s status. Payload is the full Raft slot record after '
        + 'mutation.',
    tags: TAGS_BASE,
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            slot: slotBase,
        },
        required: ['runId', 'slot'],
        // Explicit — mirrors the implicit JSON Schema default. DC adds slot
        // fields ahead of this declaration, so the envelope stays open.
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// pipeline:raft:run:synthesized
// ---------------------------------------------------------------------------
exports.pipelineRaftRunSynthesized = {
    namespace: 'pipeline',
    name: 'pipeline:raft:run:synthesized',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by PipelineRaftStateMachine when a run-updated command arrives for '
        + 'a runId with no existing slot (proposer\'s view of its own run-started '
        + 'commit lagged). A placeholder slot is synthesized rather than dropping '
        + 'the command. Operators should surface this as a warning.',
    tags: TAGS_BASE,
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            slot: slotBase,
        },
        required: ['runId', 'slot'],
        // Explicit — mirrors the implicit JSON Schema default. DC adds slot
        // fields ahead of this declaration, so the envelope stays open.
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// pipeline:raft:run:checkpointed
// ---------------------------------------------------------------------------
exports.pipelineRaftRunCheckpointed = {
    namespace: 'pipeline',
    name: 'pipeline:raft:run:checkpointed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by PipelineRaftStateMachine when a run-checkpointed command lands. '
        + 'Payload is the full Raft slot record with the new checkpoint blob.',
    tags: TAGS_BASE,
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            slot: {
                ...slotBase,
                properties: {
                    ...slotBase.properties,
                    checkpoint: { type: 'object', additionalProperties: true },
                },
                required: [...slotBase.required, 'checkpoint'],
            },
        },
        required: ['runId', 'slot'],
        // Explicit — mirrors the implicit JSON Schema default. DC adds slot
        // fields ahead of this declaration, so the envelope stays open.
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// pipeline:raft:run:terminated
// ---------------------------------------------------------------------------
exports.pipelineRaftRunTerminated = {
    namespace: 'pipeline',
    name: 'pipeline:raft:run:terminated',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Emitted by PipelineRaftStateMachine when a run-terminated command lands '
        + '(completed | failed | cancelled). Terminal status is sticky — subsequent '
        + 'terminations on the same runId are no-ops and DO NOT re-emit.',
    tags: TAGS_BASE,
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            slot: {
                ...slotBase,
                properties: {
                    ...slotBase.properties,
                    status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
                    checkpoint: { type: 'object', additionalProperties: true },
                },
            },
        },
        required: ['runId', 'slot'],
        // Explicit — mirrors the implicit JSON Schema default. DC adds slot
        // fields ahead of this declaration, so the envelope stays open.
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/**
 * All pipeline:raft:run:* signal declarations (wave9-d).
 *
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use. These events are produced by platform-api's
 * PipelineRaftStateMachine — not by distributed-core's PipelineExecutor.
 */
exports.pipelineRaftDeclarations = [
    exports.pipelineRaftRunStarted,
    exports.pipelineRaftRunUpdated,
    exports.pipelineRaftRunSynthesized,
    exports.pipelineRaftRunCheckpointed,
    exports.pipelineRaftRunTerminated,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
// `slotBase`'s property objects are shared by reference across all five
// declarations, so a single pass annotates every view of them.
(0, field_glossary_1.annotateDeclarations)(exports.pipelineRaftDeclarations, FIELDS);
/**
 * The four state-machine transition events emitted by PipelineRaftStateMachine
 * (wave20-a). Excludes `pipeline:raft:run:started` which is a slot-creation
 * event. Consumers that only care about post-create state transitions should
 * register from this list.
 *
 * Corresponds to the 4 Raft SM events listed in the wave20 task spec:
 *   - pipeline:raft:run:synthesized
 *   - pipeline:raft:run:updated
 *   - pipeline:raft:run:checkpointed
 *   - pipeline:raft:run:terminated
 */
exports.pipelineRaftStateMachineDeclarations = [
    exports.pipelineRaftRunSynthesized,
    exports.pipelineRaftRunUpdated,
    exports.pipelineRaftRunCheckpointed,
    exports.pipelineRaftRunTerminated,
];
//# sourceMappingURL=pipeline-raft.js.map