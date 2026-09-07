"use strict";
// src/declarations/ag-ui/text.ts
//
// AG-UI streamed text-message events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiTextMessageChunk = exports.agUiTextMessageEnd = exports.agUiTextMessageContent = exports.agUiTextMessageStart = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Text streaming events
// ---------------------------------------------------------------------------
exports.agUiTextMessageStart = {
    name: 'ag-ui.TEXT_MESSAGE_START',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Opens a new streamed text message. Role identifies the speaker (assistant/user/system).',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'role'],
        properties: {
            type: { type: 'string', const: 'TEXT_MESSAGE_START' },
            messageId: { type: 'string' },
            role: { type: 'string', enum: ['assistant', 'user', 'system'] },
        },
        additionalProperties: true,
    },
};
exports.agUiTextMessageContent = {
    name: 'ag-ui.TEXT_MESSAGE_CONTENT',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Carries a text delta for an in-progress message stream.',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'delta'],
        properties: {
            type: { type: 'string', const: 'TEXT_MESSAGE_CONTENT' },
            messageId: { type: 'string' },
            delta: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiTextMessageEnd = {
    name: 'ag-ui.TEXT_MESSAGE_END',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Closes a streamed text message.',
    schema: {
        type: 'object',
        required: ['type', 'messageId'],
        properties: {
            type: { type: 'string', const: 'TEXT_MESSAGE_END' },
            messageId: { type: 'string' },
        },
        additionalProperties: true,
    },
};
exports.agUiTextMessageChunk = {
    name: 'ag-ui.TEXT_MESSAGE_CHUNK',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Single-frame variant: complete text message in one event (no START/END pair).',
    schema: {
        type: 'object',
        required: ['type', 'messageId', 'role', 'delta'],
        properties: {
            type: { type: 'string', const: 'TEXT_MESSAGE_CHUNK' },
            messageId: { type: 'string' },
            role: { type: 'string' },
            delta: { type: 'string' },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=text.js.map