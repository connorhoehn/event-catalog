"use strict";
// src/declarations/ag-ui/extensions.ts
//
// AG-UI extension events — the protocol's escape hatches.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiMetaEvent = exports.agUiCustom = exports.agUiRaw = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Extension events
// ---------------------------------------------------------------------------
exports.agUiRaw = {
    name: 'ag-ui.RAW',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Escape hatch for unstructured provider-native payloads.',
    schema: {
        type: 'object',
        required: ['type', 'event'],
        properties: {
            type: { type: 'string', const: 'RAW' },
            event: {},
        },
        additionalProperties: true,
    },
};
exports.agUiCustom = {
    name: 'ag-ui.CUSTOM',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Application-specific custom event with arbitrary structured payload.',
    schema: {
        type: 'object',
        required: ['type', 'name'],
        properties: {
            type: { type: 'string', const: 'CUSTOM' },
            name: { type: 'string' },
            value: {},
        },
        additionalProperties: true,
    },
};
exports.agUiMetaEvent = {
    name: 'ag-ui.META_EVENT',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Protocol metadata event (e.g. heartbeats, version negotiation).',
    schema: {
        type: 'object',
        required: ['type', 'name'],
        properties: {
            type: { type: 'string', const: 'META_EVENT' },
            name: { type: 'string' },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=extensions.js.map