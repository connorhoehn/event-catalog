"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsPipelineEvent = exports.wsPipelineHistory = exports.wsPipelineSnapshot = exports.wsPipelineAck = exports.wsPipelineUnsubscribed = exports.wsPipelineSubscribed = void 0;
const _shared_1 = require("./_shared");
// ===========================================================================
// PIPELINE WS push frames — src/services/pipeline-service.ts
//
// Frames pushed FROM the gateway TO subscribed clients (not the
// pipeline:run:* BusEvent declarations which live in pipeline*.ts).
// ===========================================================================
/** Subscription confirmation for a pipeline channel. */
exports.wsPipelineSubscribed = {
    namespace: 'ws',
    name: 'ws.pipeline.subscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to a pipeline channel.',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/** Unsubscription confirmation for a pipeline channel. */
exports.wsPipelineUnsubscribed = {
    namespace: 'ws',
    name: 'ws.pipeline.unsubscribed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Unsubscription confirmation from a pipeline channel.',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};
/**
 * Acknowledgement frame for client-initiated pipeline actions
 * (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).
 * Note: frame type is `pipeline:ack`.
 */
exports.wsPipelineAck = {
    namespace: 'ws',
    name: 'ws.pipeline.ack',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Acknowledgement frame for client-initiated pipeline commands (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline:ack', {
        action: { type: 'string' },
        runId: { type: 'string' },
        correlationId: {},
    }, ['action']),
};
/**
 * Pipeline run state snapshot sent in response to a `getRun` request.
 * Note: frame type is `pipeline:snapshot`.
 */
exports.wsPipelineSnapshot = {
    namespace: 'ws',
    name: 'ws.pipeline.snapshot',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Current pipeline run state sent in response to a getRun request.',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline:snapshot', {
        runId: { type: 'string' },
        run: { type: ['object', 'null'], additionalProperties: true },
        correlationId: {},
    }, ['runId']),
};
/**
 * BusEvent history for a run, sent in response to a `getHistory` request.
 * Note: frame type is `pipeline:history`.
 */
exports.wsPipelineHistory = {
    namespace: 'ws',
    name: 'ws.pipeline.history',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'BusEvent history for a pipeline run sent in response to a getHistory request.',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline:history', {
        runId: { type: 'string' },
        fromVersion: { type: 'number' },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
        correlationId: {},
    }, ['runId', 'events']),
};
/**
 * Pipeline BusEvent broadcast to channel subscribers by PipelineBridge.
 * Note: frame type is `pipeline:event`.
 */
exports.wsPipelineEvent = {
    namespace: 'ws',
    name: 'ws.pipeline.event',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'Pipeline BusEvent fan-out frame delivered to channel subscribers (pipeline:run:{runId}, pipeline:all, pipeline:approvals).',
    tags: [..._shared_1.BASE_TAGS, 'pipeline'],
    schema: (0, _shared_1.wsSchema)('pipeline:event', {
        eventType: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
        channel: { type: 'string' },
        seq: { type: 'number' },
        sourceNodeId: { type: 'string' },
        emittedAt: { type: 'number' },
    }, ['eventType', 'channel']),
};
//# sourceMappingURL=pipeline.js.map