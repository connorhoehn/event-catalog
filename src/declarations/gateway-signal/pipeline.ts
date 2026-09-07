import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS, wsSchema } from './_shared';

// ===========================================================================
// PIPELINE WS push frames — src/services/pipeline-service.ts
//
// Frames pushed FROM the gateway TO subscribed clients (not the
// pipeline:run:* BusEvent declarations which live in pipeline*.ts).
// ===========================================================================

/** Subscription confirmation for a pipeline channel. */
export const wsPipelineSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Subscription confirmation sent when a client subscribes to a pipeline channel.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline', {
        action: { type: 'string', const: 'subscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/** Unsubscription confirmation for a pipeline channel. */
export const wsPipelineUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Unsubscription confirmation from a pipeline channel.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline', {
        action: { type: 'string', const: 'unsubscribed' },
        channel: { type: 'string' },
    }, ['action', 'channel']),
};

/**
 * Acknowledgement frame for client-initiated pipeline actions
 * (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).
 * Note: frame type is `pipeline:ack`.
 */
export const wsPipelineAck: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.ack',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Acknowledgement frame for client-initiated pipeline commands (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:ack', {
        action: { type: 'string' },
        runId: { type: 'string' },
        correlationId: {},
    }, ['action']),
};

/**
 * Pipeline run state snapshot sent in response to a `getRun` request.
 * Note: frame type is `pipeline:snapshot`.
 */
export const wsPipelineSnapshot: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.snapshot',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Current pipeline run state sent in response to a getRun request.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:snapshot', {
        runId: { type: 'string' },
        run: { type: ['object', 'null'], additionalProperties: true },
        correlationId: {},
    }, ['runId']),
};

/**
 * BusEvent history for a run, sent in response to a `getHistory` request.
 * Note: frame type is `pipeline:history`.
 */
export const wsPipelineHistory: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.history',
    transport: 'signal',
    producer: PRODUCER,
    description: 'BusEvent history for a pipeline run sent in response to a getHistory request.',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:history', {
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
export const wsPipelineEvent: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.pipeline.event',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Pipeline BusEvent fan-out frame delivered to channel subscribers (pipeline:run:{runId}, pipeline:all, pipeline:approvals).',
    tags: [...BASE_TAGS, 'pipeline'],
    schema: wsSchema('pipeline:event', {
        eventType: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
        channel: { type: 'string' },
        seq: { type: 'number' },
        sourceNodeId: { type: 'string' },
        emittedAt: { type: 'number' },
    }, ['eventType', 'channel']),
};
