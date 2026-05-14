// src/declarations/pipeline-p1.ts
//
// Wave 1 / track EC-2 — bulk P1 pipeline event declarations.
//
// Bulk declares the P1 colon-form signal events produced by
// `distributed-core`'s `PipelineExecutor` (a library, not a runtime
// service) so consumers (gateway, platform-api, pipeline-worker) share a
// single source of truth for the wire shape.
//
// Producer is `distributed-core` for every event here (in-process EventBus
// emissions). Transport is `signal` — these are NOT durable. Payload
// shapes mirror `PipelineEventMap` in
// `distributed-core/src/applications/pipeline/types.ts`. Schemas are
// intentionally loose (`additionalProperties: true`) per the
// additive-first convention used by gateway-event-declarations.js; they
// will be tightened over time as consumers begin relying on them.
//
// Coordination note: EC-1 owns `pipeline.approval.{requested,recorded}`
// and `pipeline.run.checkpoint` (declared in ./pipeline.ts). EC-3 owns
// the publishSignal() bypass fix. EC-4 owns channel_message extraction.
// This file deliberately does NOT touch any of those.

import type { EventDeclaration } from '../types/index';

const PRODUCER = 'distributed-core';
const TAGS_BASE = ['pipeline', 'producer:distributed-core'];

/** Common envelope-shape builder for events whose payload follows the
 *  `{ runId, ...fields, at }` pattern emitted by PipelineExecutor. */
function pipelineSchema(
    extra: Record<string, unknown>,
    required: string[],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            at: { type: 'string', description: 'ISO-8601 timestamp' },
            ...extra,
        },
        required: ['runId', ...required, 'at'],
        additionalProperties: true,
    };
}

// ---------------------------------------------------------------------------
// Run lifecycle (cancelled, paused, resumed)
// ---------------------------------------------------------------------------

export const pipelineRunCancelled: EventDeclaration = {
    name: 'pipeline:run:cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'PipelineExecutor cancelled an in-flight run.',
    tags: [...TAGS_BASE, 'run-lifecycle'],
    schema: pipelineSchema({}, []),
};

export const pipelineRunPaused: EventDeclaration = {
    name: 'pipeline:run:paused',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Run paused (Phase 5 pause/resume — reserved; no producer yet).',
    tags: [...TAGS_BASE, 'run-lifecycle', 'reserved'],
    schema: pipelineSchema(
        { atStepIds: { type: 'array', items: { type: 'string' } } },
        ['atStepIds'],
    ),
};

export const pipelineRunResumed: EventDeclaration = {
    name: 'pipeline:run:resumed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Run resumed (Phase 5 pause/resume — reserved; no producer yet).',
    tags: [...TAGS_BASE, 'run-lifecycle', 'reserved'],
    schema: pipelineSchema({}, []),
};

// ---------------------------------------------------------------------------
// Step lifecycle (started, completed, failed, skipped, cancelled, heartbeat,
// attempt:started, attempt:failed)
// ---------------------------------------------------------------------------

export const pipelineStepStarted: EventDeclaration = {
    name: 'pipeline:step:started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A pipeline step entered execution.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            nodeType: { type: 'string' },
        },
        ['stepId', 'nodeType'],
    ),
};

export const pipelineStepCompleted: EventDeclaration = {
    name: 'pipeline:step:completed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A pipeline step finished successfully.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            durationMs: { type: 'number' },
            output: {},
        },
        ['stepId', 'durationMs'],
    ),
};

export const pipelineStepFailed: EventDeclaration = {
    name: 'pipeline:step:failed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A pipeline step failed (after retry exhaustion).',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            error: { type: 'string' },
        },
        ['stepId', 'error'],
    ),
};

export const pipelineStepSkipped: EventDeclaration = {
    name: 'pipeline:step:skipped',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A step was skipped (condition false, cancellation, etc.).',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            reason: { type: 'string' },
        },
        ['stepId', 'reason'],
    ),
};

export const pipelineStepCancelled: EventDeclaration = {
    name: 'pipeline:step:cancelled',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A step was cancelled mid-execution.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: pipelineSchema(
        { stepId: { type: 'string' } },
        ['stepId'],
    ),
};

export const pipelineStepHeartbeat: EventDeclaration = {
    name: 'pipeline:step:heartbeat',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Periodic non-LLM step heartbeat (hub#1285). Consumed by StuckRunDetector.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'heartbeat'],
    schema: pipelineSchema(
        { stepId: { type: 'string' } },
        ['stepId'],
    ),
};

export const pipelineStepAttemptStarted: EventDeclaration = {
    name: 'pipeline:step:attempt:started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A per-step retry attempt started (hub#1687). Distinct schema: `startedAt` instead of `at`.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'retry'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            attemptNumber: { type: 'number' },
            startedAt: { type: 'string', description: 'ISO-8601 timestamp' },
        },
        required: ['runId', 'stepId', 'attemptNumber', 'startedAt'],
        additionalProperties: true,
    },
};

export const pipelineStepAttemptFailed: EventDeclaration = {
    name: 'pipeline:step:attempt:failed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A per-step retry attempt failed (hub#1687). `willRetry` indicates whether a further attempt is scheduled.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'retry'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            attemptNumber: { type: 'number' },
            error: { type: 'string' },
            nextBackoffMs: { type: 'number' },
            willRetry: { type: 'boolean' },
        },
        required: ['runId', 'stepId', 'attemptNumber', 'error', 'nextBackoffMs', 'willRetry'],
        additionalProperties: true,
    },
};

// ---------------------------------------------------------------------------
// LLM observability (prompt, token, response, stream:opened)
// ---------------------------------------------------------------------------

export const pipelineLlmPrompt: EventDeclaration = {
    name: 'pipeline:llm:prompt',
    transport: 'signal',
    producer: PRODUCER,
    description: 'LLM step prompt about to be sent to the provider.',
    tags: [...TAGS_BASE, 'llm'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            model: { type: 'string' },
            prompt: { type: 'string' },
        },
        ['stepId', 'model', 'prompt'],
    ),
};

export const pipelineLlmToken: EventDeclaration = {
    name: 'pipeline:llm:token',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Streamed LLM output token. High-volume; rate-limit before forwarding to clients.',
    tags: [...TAGS_BASE, 'llm', 'high-volume'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            token: { type: 'string' },
        },
        ['stepId', 'token'],
    ),
};

export const pipelineLlmResponse: EventDeclaration = {
    name: 'pipeline:llm:response',
    transport: 'signal',
    producer: PRODUCER,
    description: 'LLM step received its full response, including token accounting.',
    tags: [...TAGS_BASE, 'llm'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            response: { type: 'string' },
            tokensIn: { type: 'number' },
            tokensOut: { type: 'number' },
        },
        ['stepId', 'response', 'tokensIn', 'tokensOut'],
    ),
};

export const pipelineLlmStreamOpened: EventDeclaration = {
    name: 'pipeline:llm:stream:opened',
    transport: 'signal',
    producer: PRODUCER,
    description: 'LLM stream `for await` entry (DC-14). Pairs with first :token event for first-token-latency. Uses `openedAt` field (not `at`).',
    tags: [...TAGS_BASE, 'llm'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            model: { type: 'string' },
            openedAt: { type: 'string', description: 'ISO-8601 timestamp' },
        },
        required: ['runId', 'stepId', 'model', 'openedAt'],
        additionalProperties: true,
    },
};

// ---------------------------------------------------------------------------
// Context mutations (edit-and-continue at breakpoints — hub#2226)
// ---------------------------------------------------------------------------

export const pipelineContextPatched: EventDeclaration = {
    name: 'pipeline:step:context.patched',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A paused-run context patch was applied AND validated (or applied where no validator is registered for the node type).',
    tags: [...TAGS_BASE, 'context-patch', 'debug'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            patchId: { type: 'string' },
            mode: { type: 'string' },
        },
        ['stepId', 'patchId', 'mode'],
    ),
};

export const pipelineContextPatchedUnvalidated: EventDeclaration = {
    name: 'pipeline:step:context.patched-unvalidated',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Variant of `context.patched` for the warning case where the paused step\'s node type has no ContextValidator registered.',
    tags: [...TAGS_BASE, 'context-patch', 'debug', 'warning'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            patchId: { type: 'string' },
            mode: { type: 'string' },
        },
        ['stepId', 'patchId', 'mode'],
    ),
};

export const pipelineContextPatchReverted: EventDeclaration = {
    name: 'pipeline:step:context.patch-reverted',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A previously-applied paused-run context patch was reverted (only legal while still paused at the same node).',
    tags: [...TAGS_BASE, 'context-patch', 'debug'],
    schema: pipelineSchema(
        {
            stepId: { type: 'string' },
            patchId: { type: 'string' },
        },
        ['stepId', 'patchId'],
    ),
};

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * All P1 colon-form pipeline signal declarations exported by this module.
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use.
 */
export const pipelineP1Declarations: EventDeclaration[] = [
    // run lifecycle
    pipelineRunCancelled,
    pipelineRunPaused,
    pipelineRunResumed,
    // step lifecycle
    pipelineStepStarted,
    pipelineStepCompleted,
    pipelineStepFailed,
    pipelineStepSkipped,
    pipelineStepCancelled,
    pipelineStepHeartbeat,
    pipelineStepAttemptStarted,
    pipelineStepAttemptFailed,
    // LLM observability
    pipelineLlmPrompt,
    pipelineLlmToken,
    pipelineLlmResponse,
    pipelineLlmStreamOpened,
    // context mutations
    pipelineContextPatched,
    pipelineContextPatchedUnvalidated,
    pipelineContextPatchReverted,
];
