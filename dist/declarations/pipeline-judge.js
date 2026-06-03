"use strict";
// src/declarations/pipeline-judge.ts
//
// Wave 3 / track JUDGE-EC — `pipeline:judge:*` signal events emitted by the
// platform-api JudgeStepHandler (DC-21 customStepHandler for `llm:judge`).
//
// Producer is `platform-api` — unlike P1/P2 pipeline events whose producer
// is `distributed-core` (PipelineExecutor itself), the judge step lives
// outside DC. DC just dispatches into the handler; the handler emits these
// events via `helpers.emit(...)` on the executor's EventBus.
//
// Transport is `signal` for all four — these are UI/observability signals,
// never durable. Persistence of the JudgmentResult itself happens via
// JudgmentRepository (DDB), not via these events.
//
// Coordination note: Declaring these here lets JudgeStepHandler drop the
// `as unknown as LooseEmit` cast (the comment in JudgeStepHandler.ts
// explicitly points to "wave 3 / event-catalog" for this work).
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineJudgeDeclarations = exports.pipelineJudgeBudgetExceeded = exports.pipelineJudgeFailed = exports.pipelineJudgeScored = exports.pipelineJudgeStarted = void 0;
const PRODUCER = 'platform-api';
const TAGS_BASE = ['pipeline', 'judge', 'producer:platform-api'];
/**
 * Common envelope for `pipeline:judge:*` events. All four carry
 * `{ runId, stepId, at }` at minimum; per-event extras add on top.
 */
function judgeSchema(extra, required) {
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
// Lifecycle: started → (scored | failed | budget-exceeded)
// ---------------------------------------------------------------------------
exports.pipelineJudgeStarted = {
    namespace: 'pipeline',
    name: 'pipeline:judge:started',
    transport: 'signal',
    producer: PRODUCER,
    description: 'JudgeStepHandler entered the LLM-as-judge call after resolving inputs and passing the budget gate.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: judgeSchema({
        pipelineId: { type: 'string' },
        rubricId: { type: 'string' },
        rubricVersion: { type: 'number' },
        judgeModel: {
            type: 'string',
            description: 'Anthropic model id used for the judge call.',
        },
        mode: {
            type: 'string',
            enum: ['absolute', 'comparison'],
        },
    }, ['pipelineId', 'rubricId', 'rubricVersion', 'judgeModel', 'mode']),
};
exports.pipelineJudgeScored = {
    namespace: 'pipeline',
    name: 'pipeline:judge:scored',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Judge call completed successfully. Carries the full JudgmentResult (per-criterion scores + aggregated overall) plus usage/cost metrics for UI rendering and cost rollups.',
    tags: [...TAGS_BASE, 'step-lifecycle'],
    schema: judgeSchema({
        pipelineId: { type: 'string' },
        judgmentId: { type: 'string' },
        rubricId: { type: 'string' },
        judgeModel: { type: 'string' },
        /**
         * JudgmentResult shape from platform-api/src/pipeline/judge/types.ts.
         * Kept loose here — the canonical TS type is the source of truth;
         * additional fields land as ui-components grow new render needs.
         */
        result: {
            type: 'object',
            description: 'Full JudgmentResult — rubricSnapshot, criteria[], overallScore/Verdict/Passed, model/tokens/cost, etc.',
            additionalProperties: true,
        },
        usage: {
            type: 'object',
            properties: {
                inputTokens: { type: 'number' },
                outputTokens: { type: 'number' },
                cacheReadTokens: { type: 'number' },
                cacheCreationTokens: { type: 'number' },
            },
            additionalProperties: true,
        },
        costUsd: { type: 'number' },
        cacheHitRatio: {
            type: 'number',
            description: '0..1 fraction of input tokens served from cache. CLI path always emits 0 today.',
        },
        latencyMs: { type: 'number' },
    }, [
        'pipelineId',
        'judgmentId',
        'rubricId',
        'judgeModel',
        'result',
        'usage',
        'costUsd',
        'latencyMs',
    ]),
};
exports.pipelineJudgeFailed = {
    namespace: 'pipeline',
    name: 'pipeline:judge:failed',
    transport: 'signal',
    producer: PRODUCER,
    description: 'Judge call did not produce a usable JudgmentResult — input resolution failed, model returned malformed JSON after retry, the CLI subprocess exited non-zero, or the call was aborted. Usage/cost still propagate when available so cost accounting stays honest (rule #1).',
    tags: [...TAGS_BASE, 'step-lifecycle', 'failure'],
    schema: judgeSchema({
        reason: {
            type: 'string',
            enum: [
                'input-resolution',
                'malformed',
                'aborted',
                'budget-exhausted',
                'unknown',
            ],
            description: 'Discriminator for the failure mode.',
        },
        error: { type: 'string' },
        tokensIn: { type: 'number' },
        tokensOut: { type: 'number' },
        costUsd: { type: 'number' },
        latencyMs: { type: 'number' },
    }, ['reason', 'error']),
};
exports.pipelineJudgeBudgetExceeded = {
    namespace: 'pipeline',
    name: 'pipeline:judge:budget-exceeded',
    transport: 'signal',
    producer: PRODUCER,
    description: 'JudgeBudgetGuard reported the daily budget exhausted before the LLM call. Step completes with `{skipped:"budget-exhausted"}` output — the judge is signal, not a correctness gate, so the step does not fail the run.',
    tags: [...TAGS_BASE, 'budget'],
    schema: judgeSchema({
        pipelineId: { type: 'string' },
    }, ['pipelineId']),
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/**
 * All `pipeline:judge:*` declarations for bulk-registration by consumers.
 */
exports.pipelineJudgeDeclarations = [
    exports.pipelineJudgeStarted,
    exports.pipelineJudgeScored,
    exports.pipelineJudgeFailed,
    exports.pipelineJudgeBudgetExceeded,
];
//# sourceMappingURL=pipeline-judge.js.map