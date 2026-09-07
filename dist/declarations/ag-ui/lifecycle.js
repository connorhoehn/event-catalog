"use strict";
// src/declarations/ag-ui/lifecycle.ts
//
// AG-UI run and step lifecycle events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiStepFinished = exports.agUiStepStarted = exports.agUiRunError = exports.agUiRunFinished = exports.agUiRunStarted = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------
exports.agUiRunStarted = {
    name: 'ag-ui.RUN_STARTED',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Emitted when an agent run begins. Carries the thread and run IDs.',
    schema: {
        type: 'object',
        required: ['type', 'threadId', 'runId'],
        properties: {
            type: { type: 'string', const: 'RUN_STARTED' },
            threadId: { type: 'string' },
            runId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiRunFinished = {
    name: 'ag-ui.RUN_FINISHED',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Emitted when an agent run completes successfully. GROUND TRUTH: neither producer repeats the '
        + 'run identity that RUN_STARTED already established. realtime-modules:src/agent-streaming/'
        + 'AgentStream.ts:117 `runFinished` sends { type, outcome?, result?, timestamp } — and its only '
        + 'in-repo caller (agentStreamMiddleware.ts:210) passes no args at all, so a bare '
        + '{ type, timestamp } is the common frame. platform-api:src/routes/pipelineLLMStream.ts:169 '
        + 'sends { type, runId }. Nothing sends `threadId`.',
    schema: {
        type: 'object',
        required: ['type'],
        properties: {
            type: { type: 'string', const: 'RUN_FINISHED' },
            threadId: {
                type: 'string',
                description: 'NEVER EMITTED — RUN_STARTED carries the thread identity and neither RUN_FINISHED producer '
                    + 'repeats it: AgentStream omits it and platform-api\'s pipelineLLMStream sends runId only. '
                    + 'Correlate on the runId from RUN_STARTED instead. Declared-but-optional only because '
                    + 'removing a property is breaking; do not re-add it to `required`.',
            },
            runId: {
                type: 'string',
                description: 'Identifier of the agent run that finished. Sent by platform-api\'s pipelineLLMStream; omitted by AgentStream, which relies on the RUN_STARTED correlation.',
            },
            outcome: {
                type: 'string',
                description: 'Caller-supplied summary of how the run ended, when the caller chose to label it. Free-form; AgentStream does not constrain the value.',
            },
            result: {
                description: 'Caller-supplied final result of the run. Shape is defined by the agent and deliberately unconstrained.',
            },
            timestamp: {
                type: 'number',
                description: 'Epoch milliseconds at which AgentStream emitted the frame (its injectable `now()`, defaulting to Date.now()). Not an ISO string.',
            },
        },
        additionalProperties: true,
    },
};
exports.agUiRunError = {
    name: 'ag-ui.RUN_ERROR',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Emitted when an agent run terminates due to an error.',
    schema: {
        type: 'object',
        required: ['type', 'message'],
        properties: {
            type: { type: 'string', const: 'RUN_ERROR' },
            message: { type: 'string' },
            code: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiStepStarted = {
    name: 'ag-ui.STEP_STARTED',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Emitted when a named step begins within a run.',
    schema: {
        type: 'object',
        required: ['type', 'stepName'],
        properties: {
            type: { type: 'string', const: 'STEP_STARTED' },
            stepName: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiStepFinished = {
    name: 'ag-ui.STEP_FINISHED',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Emitted when a named step completes.',
    schema: {
        type: 'object',
        required: ['type', 'stepName'],
        properties: {
            type: { type: 'string', const: 'STEP_FINISHED' },
            stepName: { type: 'string' },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=lifecycle.js.map