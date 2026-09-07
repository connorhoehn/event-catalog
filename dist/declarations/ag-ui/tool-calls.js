"use strict";
// src/declarations/ag-ui/tool-calls.ts
//
// AG-UI tool-call events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiToolCallChunk = exports.agUiToolCallResult = exports.agUiToolCallEnd = exports.agUiToolCallArgs = exports.agUiToolCallStart = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Tool call events
// ---------------------------------------------------------------------------
exports.agUiToolCallStart = {
    name: 'ag-ui.TOOL_CALL_START',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Agent begins a tool invocation. toolCallId is unique per call within a run.',
    schema: {
        type: 'object',
        required: ['type', 'toolCallId', 'toolCallName'],
        properties: {
            type: { type: 'string', const: 'TOOL_CALL_START' },
            toolCallId: { type: 'string' },
            toolCallName: { type: 'string' },
            parentMessageId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiToolCallArgs = {
    name: 'ag-ui.TOOL_CALL_ARGS',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Carries a JSON delta fragment of the tool call arguments.',
    schema: {
        type: 'object',
        required: ['type', 'toolCallId', 'delta'],
        properties: {
            type: { type: 'string', const: 'TOOL_CALL_ARGS' },
            toolCallId: { type: 'string' },
            delta: { type: 'string', description: 'Partial JSON of arguments being streamed.' },
        },
        additionalProperties: true,
    },
};
exports.agUiToolCallEnd = {
    name: 'ag-ui.TOOL_CALL_END',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Agent finishes streaming arguments for a tool call.',
    schema: {
        type: 'object',
        required: ['type', 'toolCallId'],
        properties: {
            type: { type: 'string', const: 'TOOL_CALL_END' },
            toolCallId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiToolCallResult = {
    name: 'ag-ui.TOOL_CALL_RESULT',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Carries the result of a completed tool call.',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'toolCallId', 'toolCallName', 'content'],
        properties: {
            type: { type: 'string', const: 'TOOL_CALL_RESULT' },
            messageId: { type: 'string' },
            toolCallId: { type: 'string' },
            toolCallName: { type: 'string' },
            content: {},
        },
        additionalProperties: true,
    },
};
exports.agUiToolCallChunk = {
    name: 'ag-ui.TOOL_CALL_CHUNK',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Single-frame variant: complete tool call in one event.',
    schema: {
        type: 'object',
        required: ['type', 'toolCallId'],
        properties: {
            type: { type: 'string', const: 'TOOL_CALL_CHUNK' },
            toolCallId: { type: 'string' },
            toolCallName: { type: 'string' },
            delta: { type: 'string' },
            parentMessageId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=tool-calls.js.map