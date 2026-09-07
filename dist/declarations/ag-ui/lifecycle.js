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
    description: 'Emitted when an agent run completes successfully.',
    schema: {
        type: 'object',
        required: ['type', 'threadId', 'runId'],
        properties: {
            type: { type: 'string', const: 'RUN_FINISHED' },
            threadId: { type: 'string' },
            runId: { type: 'string' },
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