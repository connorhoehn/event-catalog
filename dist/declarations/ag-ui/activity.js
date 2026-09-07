"use strict";
// src/declarations/ag-ui/activity.ts
//
// AG-UI activity-feed events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiActivityDelta = exports.agUiActivitySnapshot = void 0;
const _shared_1 = require("./_shared");
// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------
exports.agUiActivitySnapshot = {
    name: 'ag-ui.ACTIVITY_SNAPSHOT',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Full replacement of the activity feed (tool calls, reasoning, sub-steps).',
    schema: {
        type: 'object',
        required: ['type', 'snapshot'],
        properties: {
            type: { type: 'string', const: 'ACTIVITY_SNAPSHOT' },
            snapshot: { type: 'array', items: {} },
        },
        additionalProperties: true,
    },
};
exports.agUiActivityDelta = {
    name: 'ag-ui.ACTIVITY_DELTA',
    namespace: _shared_1.NAMESPACE,
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    tags: _shared_1.TAGS,
    description: 'Incremental update to the activity feed (append or update one item).',
    schema: {
        type: 'object',
        required: ['type', 'delta'],
        properties: {
            type: { type: 'string', const: 'ACTIVITY_DELTA' },
            delta: { type: 'array', items: {} },
        },
        additionalProperties: true,
    },
};
//# sourceMappingURL=activity.js.map