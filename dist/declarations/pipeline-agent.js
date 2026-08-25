"use strict";
// src/declarations/pipeline-agent.ts
//
// `pipeline:step:agent:tool` — the live signal event emitted by the
// platform-api AgentStepHandler (DC-21 customStepHandler for `agent`
// nodes; DC's built-in execAgent emits the same event when no custom
// handler is registered).
//
// One event fires per tool-call phase transition inside the agent loop:
//   phase 'start' — the tool began executing (in-flight);
//   phase 'end'   — it finished, with `ok`.
//
// Tool INPUT and OUTPUT are deliberately NOT on this event: they can be
// arbitrarily large (a Read of a big file) and belong exclusively in the
// persisted `AgentStepOutput.toolCalls[]` on the step output. `callIndex`
// is the correlation key between the streamed events and the persisted
// trace — the frontend renders the live waterfall from these events and
// swaps to the persisted output on completion.
//
// Transport is `signal`: UI/observability only, never durable. Wire shape
// mirrors `pipeline-image-vision.ts`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineAgentDeclarations = exports.pipelineStepAgentTool = void 0;
const PRODUCER = 'platform-api';
const TAGS_BASE = ['pipeline', 'agent', 'producer:platform-api'];
exports.pipelineStepAgentTool = {
    namespace: 'pipeline',
    name: 'pipeline:step:agent:tool',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A tool call inside an agent step started or ended. Streamed live to the run view; '
        + 'payloads stay off the event and live in the persisted AgentStepOutput.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            callIndex: {
                type: 'number',
                description: 'Zero-based index of this tool call within the agent loop; correlation key '
                    + 'against the persisted AgentStepOutput.toolCalls[].',
            },
            name: { type: 'string', description: 'Tool name (e.g. Read, Grep).' },
            phase: {
                type: 'string',
                enum: ['start', 'end'],
                description: "Lifecycle phase: 'start' opens the call, 'end' closes it.",
            },
            ok: {
                type: 'boolean',
                description: "Present on phase 'end' only — whether the tool call succeeded.",
            },
            at: { type: 'string', description: 'ISO-8601 timestamp.' },
        },
        required: ['runId', 'stepId', 'callIndex', 'name', 'phase', 'at'],
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/** All `pipeline:step:agent:*` declarations for bulk-registration by consumers. */
exports.pipelineAgentDeclarations = [
    exports.pipelineStepAgentTool,
];
//# sourceMappingURL=pipeline-agent.js.map