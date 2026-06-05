// src/declarations/pipeline-image-vision.ts
//
// `pipeline:image:vision:*` signal events emitted by the platform-api
// VisionStepHandler (DC-21 customStepHandler for `image:vision-analyze`).
//
// Producer is `platform-api` — the vision step lives outside DC. DC
// dispatches into the handler; the handler emits these events via
// `helpers.emit(...)` on the executor's EventBus.
//
// Transport is `signal` for all three — these are UI/observability
// signals, never durable. Persistence of the VisionResult happens via
// VisionResultRepository (DDB).
//
// Wire shape mirrors `pipeline-judge.ts` exactly. Three events form the
// step lifecycle:
//   started → (analyzed | failed)
// There is no budget-exceeded event on the vision family — cost gating
// is out of scope per the v1 design.

import type { EventDeclaration } from '../types/index';

const PRODUCER = 'platform-api';
const TAGS_BASE = ['pipeline', 'image', 'vision', 'producer:platform-api'];

/**
 * Common envelope for `pipeline:image:vision:*` events. All three carry
 * `{ runId, stepId, at }` at minimum; per-event extras add on top.
 */
function visionSchema(
    extra: Record<string, unknown>,
    required: string[],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            at: { type: 'string', description: 'ISO-8601 timestamp' },
            ...extra,
        },
        required: ['runId', 'stepId', ...required, 'at'],
        additionalProperties: true,
    };
}

// ---------------------------------------------------------------------------
// Lifecycle: started → (token×N) → (analyzed | failed)
// ---------------------------------------------------------------------------

export const pipelineImageVisionStarted: EventDeclaration = {
    namespace: 'pipeline',
    name: 'pipeline:image:vision:started',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'VisionStepHandler entered the LLM-vision call after resolving the image ref and prompt template.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: visionSchema(
        {
            pipelineId: { type: 'string' },
            imageId: {
                type: 'string',
                description: 'imageId in the pipeline-images DDB table',
            },
            visionModel: {
                type: 'string',
                description: 'Anthropic model id used for the vision call.',
            },
            hasSchema: {
                type: 'boolean',
                description: 'True when the step config supplied an outputSchema for structured extraction.',
            },
        },
        ['pipelineId', 'imageId', 'visionModel', 'hasSchema'],
    ),
};

/**
 * Per-token stream event during the vision call's response phase. Fires
 * once per `content_block_delta` text chunk from the Claude Code CLI's
 * stream-json output. Subscribers use this to render live typing in the
 * frontend (same pattern as `pipeline.llm.token`).
 *
 * Hot path — high volume. Subscribers MUST be cheap (in-memory state
 * mutation only; no IO, no network, no DDB). The handler dispatches
 * fire-and-forget so a slow subscriber can't backpressure the model loop.
 */
export const pipelineImageVisionToken: EventDeclaration = {
    namespace: 'pipeline',
    name: 'pipeline:image:vision:token',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Per-token text delta emitted as the CLI streams the model response. UI subscribers fold this into a live preview; ignore when off-screen.',
    tags: [...TAGS_BASE, 'streaming', 'hot-path'],
    schema: visionSchema(
        {
            pipelineId: { type: 'string' },
            imageId: { type: 'string' },
            seq: {
                type: 'number',
                description: 'Monotonic per-call counter starting at 1. Allows subscribers to detect drops or out-of-order delivery in transports that don\'t preserve order.',
            },
            delta: {
                type: 'string',
                description: 'The new text appended since the previous token event.',
            },
            accumulated: {
                type: 'string',
                description: 'Full response text so far. Convenience for subscribers that don\'t track their own accumulator.',
            },
        },
        ['pipelineId', 'imageId', 'seq', 'delta', 'accumulated'],
    ),
};

export const pipelineImageVisionAnalyzed: EventDeclaration = {
    namespace: 'pipeline',
    name: 'pipeline:image:vision:analyzed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Vision call completed successfully. Carries the full VisionResult plus usage/cost telemetry for UI rendering and audit drill-in.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: visionSchema(
        {
            pipelineId: { type: 'string' },
            visionId: { type: 'string', description: 'UUID for this vision call (also the DDB primary key in pipeline-vision-results)' },
            imageId: { type: 'string' },
            visionModel: { type: 'string' },
            /**
             * VisionResult shape from platform-api/src/pipeline/image/types.ts
             * (subset mirror of ui-components/pipelines/vision/types.ts).
             * Kept loose here — the canonical TS type is the source of
             * truth; additional fields land as ui-components grow new
             * render needs.
             */
            result: {
                type: 'object',
                description:
                    'Full VisionResult — caption, tags, structured fields when schema supplied, plus model/tokens/cost metadata.',
                additionalProperties: true,
            },
            usage: {
                type: 'object',
                properties: {
                    inputTokens: { type: 'number' },
                    outputTokens: { type: 'number' },
                    imageTokens: {
                        type: 'number',
                        description: 'Tokens consumed by the image content block (provider-specific calculation).',
                    },
                },
                additionalProperties: true,
            },
            costUsd: {
                type: 'number',
                description: 'Telemetry only — cost is not enforced in v1 (no budget gate).',
            },
            latencyMs: { type: 'number' },
        },
        [
            'pipelineId',
            'visionId',
            'imageId',
            'visionModel',
            'result',
            'usage',
            'costUsd',
            'latencyMs',
        ],
    ),
};

export const pipelineImageVisionFailed: EventDeclaration = {
    namespace: 'pipeline',
    name: 'pipeline:image:vision:failed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Vision call did not produce a usable VisionResult — image fetch failed, model returned malformed JSON after retry, the CLI subprocess exited non-zero, or the call was aborted. Usage/cost still propagate when available so telemetry stays honest.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'failure'],
    schema: visionSchema(
        {
            pipelineId: { type: 'string' },
            imageId: { type: 'string' },
            reason: {
                type: 'string',
                enum: [
                    'image-fetch',
                    'input-resolution',
                    'malformed',
                    'aborted',
                    'unknown',
                ],
                description: 'Discriminator for the failure mode.',
            },
            error: { type: 'string' },
            tokensIn: { type: 'number' },
            tokensOut: { type: 'number' },
            costUsd: { type: 'number' },
            latencyMs: { type: 'number' },
        },
        ['reason', 'error'],
    ),
};

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * All `pipeline:image:vision:*` declarations for bulk-registration by
 * consumers.
 */
export const pipelineImageVisionDeclarations: EventDeclaration[] = [
    pipelineImageVisionStarted,
    pipelineImageVisionToken,
    pipelineImageVisionAnalyzed,
    pipelineImageVisionFailed,
];
