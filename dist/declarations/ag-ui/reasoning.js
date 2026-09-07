"use strict";
// src/declarations/ag-ui/reasoning.ts
//
// AG-UI reasoning-trace events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiReasoningEncryptedValue = exports.agUiReasoningEnd = exports.agUiReasoningStart = exports.agUiReasoningMessageChunk = exports.agUiReasoningMessageEnd = exports.agUiReasoningMessageContent = exports.agUiReasoningMessageStart = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Reasoning events
// ---------------------------------------------------------------------------
exports.agUiReasoningMessageStart = {
    name: 'ag-ui.REASONING_MESSAGE_START',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Opens a reasoning trace message stream.',
    schema: {
        type: 'object',
        required: ['type', 'messageId'],
        properties: {
            type: { type: 'string', const: 'REASONING_MESSAGE_START' },
            messageId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningMessageContent = {
    name: 'ag-ui.REASONING_MESSAGE_CONTENT',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Carries a text delta within a reasoning trace stream.',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'delta'],
        properties: {
            type: { type: 'string', const: 'REASONING_MESSAGE_CONTENT' },
            messageId: { type: 'string' },
            delta: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningMessageEnd = {
    name: 'ag-ui.REASONING_MESSAGE_END',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Closes a reasoning trace message stream.',
    schema: {
        type: 'object',
        required: ['type', 'messageId'],
        properties: {
            type: { type: 'string', const: 'REASONING_MESSAGE_END' },
            messageId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningMessageChunk = {
    name: 'ag-ui.REASONING_MESSAGE_CHUNK',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Single-frame reasoning trace message.',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'delta'],
        properties: {
            type: { type: 'string', const: 'REASONING_MESSAGE_CHUNK' },
            messageId: { type: 'string' },
            delta: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningStart = {
    name: 'ag-ui.REASONING_START',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Signals that the agent has entered a reasoning phase.',
    schema: {
        type: 'object',
        required: ['type'],
        properties: {
            type: { type: 'string', const: 'REASONING_START' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningEnd = {
    name: 'ag-ui.REASONING_END',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Signals that the agent has exited the reasoning phase.',
    schema: {
        type: 'object',
        required: ['type'],
        properties: {
            type: { type: 'string', const: 'REASONING_END' },
        },
        additionalProperties: true,
    },
};
exports.agUiReasoningEncryptedValue = {
    name: 'ag-ui.REASONING_ENCRYPTED_VALUE',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Carries an encrypted reasoning payload (provider-specific format).',
    schema: {
        type: 'object',
        required: ['type', 'value'],
        properties: {
            type: { type: 'string', const: 'REASONING_ENCRYPTED_VALUE' },
            value: { type: 'string', description: 'Opaque encrypted bytes.' },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=reasoning.js.map