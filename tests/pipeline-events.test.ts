// tests/pipeline-events.test.ts
//
// Wave 19 / Part A — coverage for the pipelineEventDeclarations aggregate
// introduced in src/declarations/pipeline-events.ts.
//
// Verifies:
//   (a) each declaration has the expected name / transport / producer
//   (b) JSON Schema validates a valid payload sample
//   (c) JSON Schema rejects a payload missing required fields

import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    pipelineEventDeclarations,
    pipelineApprovalRequested,
    pipelineApprovalRecorded,
    pipelineRunCheckpoint,
    pipelineRunCancelled,
    pipelineRunStuck,
    pipelineStepStarted,
    pipelineStepCompleted,
    pipelineStepFailed,
    pipelineStepBreakpoint,
    pipelineContextPatched,
    pipelineContextPatchedUnvalidated,
    pipelineContextPatchReverted,
    pipelineLlmPrompt,
    pipelineLlmResponse,
} from '../src/declarations/pipeline-events';

// ---------------------------------------------------------------------------
// Aggregate shape tests
// ---------------------------------------------------------------------------

describe('pipelineEventDeclarations aggregate (wave19-a)', () => {
    it('exports exactly 14 declarations', () => {
        expect(pipelineEventDeclarations).toHaveLength(14);
    });

    it('has no duplicate names', () => {
        const names = pipelineEventDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('bulk-registers every declaration in a fresh registry', () => {
        const registry = new Registry();
        for (const decl of pipelineEventDeclarations) {
            registry.declare(decl);
        }
        // Registry de-duplicates by name; count >= 14 because aliases expand later.
        expect(registry.size()).toBeGreaterThanOrEqual(14);
    });

    it('contains the expected P0 approval declarations', () => {
        const names = pipelineEventDeclarations.map((d) => d.name);
        expect(names).toContain('pipeline.approval.requested');
        expect(names).toContain('pipeline.approval.recorded');
    });

    it('contains the expected P1 signal declarations', () => {
        const names = pipelineEventDeclarations.map((d) => d.name);
        expect(names).toContain('pipeline:run:cancelled');
        expect(names).toContain('pipeline:run:stuck');
        expect(names).toContain('pipeline:step:started');
        expect(names).toContain('pipeline:step:completed');
        expect(names).toContain('pipeline:step:failed');
        expect(names).toContain('pipeline:step:breakpoint');
        expect(names).toContain('pipeline:step:context.patched');
        expect(names).toContain('pipeline:step:context.patched-unvalidated');
        expect(names).toContain('pipeline:step:context.patch-reverted');
        expect(names).toContain('pipeline:llm:prompt');
        expect(names).toContain('pipeline:llm:response');
    });
});

// ---------------------------------------------------------------------------
// P0 approval — name / transport / producer
// ---------------------------------------------------------------------------

describe('P0 approval declarations — shape', () => {
    it('pipeline.approval.requested has transport=both + dual producers + colon alias', () => {
        expect(pipelineApprovalRequested.name).toBe('pipeline.approval.requested');
        expect(pipelineApprovalRequested.transport).toBe('both');
        expect(pipelineApprovalRequested.producer).toEqual(['distributed-core', 'platform-api']);
        const aliasNames = (pipelineApprovalRequested.aliases ?? []).map((a) => a.name);
        expect(aliasNames).toContain('pipeline:approval:requested');
    });

    it('pipeline.approval.recorded has transport=both + dual producers + colon alias', () => {
        expect(pipelineApprovalRecorded.name).toBe('pipeline.approval.recorded');
        expect(pipelineApprovalRecorded.transport).toBe('both');
        expect(pipelineApprovalRecorded.producer).toEqual(['distributed-core', 'platform-api']);
        const aliasNames = (pipelineApprovalRecorded.aliases ?? []).map((a) => a.name);
        expect(aliasNames).toContain('pipeline:approval:recorded');
    });

    it('pipeline.run.checkpoint is signal-only with distributed-core producer', () => {
        expect(pipelineRunCheckpoint.name).toBe('pipeline.run.checkpoint');
        expect(pipelineRunCheckpoint.transport).toBe('signal');
        expect(pipelineRunCheckpoint.producer).toBe('distributed-core');
    });
});

// ---------------------------------------------------------------------------
// P0 approval — schema validation
// ---------------------------------------------------------------------------

describe('P0 approval declarations — schema validation', () => {
    it('validates pipeline.approval.requested with a conforming payload', () => {
        const registry = new Registry();
        registry.declare(pipelineApprovalRequested);

        expect(registry.validate('pipeline.approval.requested', {
            runId: 'run_01',
            stepId: 'step_approval',
            approverIds: ['user-a', 'user-b'],
            requestedAt: 1_700_000_000_000,
        }).valid).toBe(true);
    });

    it('rejects pipeline.approval.requested when approverIds is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineApprovalRequested);

        expect(registry.validate('pipeline.approval.requested', {
            runId: 'run_01',
            stepId: 'step_approval',
            requestedAt: 1_700_000_000_000,
        }).valid).toBe(false);
    });

    it('validates pipeline.approval.recorded with approve decision', () => {
        const registry = new Registry();
        registry.declare(pipelineApprovalRecorded);

        expect(registry.validate('pipeline.approval.recorded', {
            runId: 'run_01',
            stepId: 'step_approval',
            approver: 'user-a',
            decision: 'approve',
            decidedAt: 1_700_000_001_000,
        }).valid).toBe(true);
    });

    it('rejects pipeline.approval.recorded when decision is invalid enum value', () => {
        const registry = new Registry();
        registry.declare(pipelineApprovalRecorded);

        expect(registry.validate('pipeline.approval.recorded', {
            runId: 'run_01',
            stepId: 'step_approval',
            approver: 'user-a',
            decision: 'maybe',
            decidedAt: 1_700_000_001_000,
        }).valid).toBe(false);
    });

    it('validates pipeline.run.checkpoint with a conforming payload', () => {
        const registry = new Registry();
        registry.declare(pipelineRunCheckpoint);

        expect(registry.validate('pipeline.run.checkpoint', {
            runId: 'run_01',
            context: { stage: 'mid', counter: 5 },
            currentStepIds: ['step_a', 'step_b'],
            sequenceNumber: 3,
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline.run.checkpoint when sequenceNumber is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineRunCheckpoint);

        expect(registry.validate('pipeline.run.checkpoint', {
            runId: 'run_01',
            context: {},
            currentStepIds: [],
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// P1 run lifecycle — name / transport / producer + schema
// ---------------------------------------------------------------------------

describe('P1 run lifecycle declarations', () => {
    it('pipeline:run:cancelled has signal transport + distributed-core producer', () => {
        expect(pipelineRunCancelled.name).toBe('pipeline:run:cancelled');
        expect(pipelineRunCancelled.transport).toBe('signal');
        expect(pipelineRunCancelled.producer).toBe('distributed-core');
    });

    it('validates pipeline:run:cancelled with { runId, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineRunCancelled);

        expect(registry.validate('pipeline:run:cancelled', {
            runId: 'run_01',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:run:cancelled when runId is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineRunCancelled);

        expect(registry.validate('pipeline:run:cancelled', {
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('pipeline:run:stuck has signal transport + distributed-core producer', () => {
        expect(pipelineRunStuck.name).toBe('pipeline:run:stuck');
        expect(pipelineRunStuck.transport).toBe('signal');
        expect(pipelineRunStuck.producer).toBe('distributed-core');
    });

    it('validates pipeline:run:stuck with lastHeartbeatAt as string', () => {
        const registry = new Registry();
        registry.declare(pipelineRunStuck);

        expect(registry.validate('pipeline:run:stuck', {
            runId: 'run_01',
            lastHeartbeatAt: '2026-05-15T09:50:00.000Z',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('validates pipeline:run:stuck with lastHeartbeatAt as null', () => {
        const registry = new Registry();
        registry.declare(pipelineRunStuck);

        expect(registry.validate('pipeline:run:stuck', {
            runId: 'run_01',
            lastHeartbeatAt: null,
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// P1 step lifecycle — name / transport / producer + schema
// ---------------------------------------------------------------------------

describe('P1 step lifecycle declarations', () => {
    it('pipeline:step:started has signal transport + distributed-core producer', () => {
        expect(pipelineStepStarted.name).toBe('pipeline:step:started');
        expect(pipelineStepStarted.transport).toBe('signal');
        expect(pipelineStepStarted.producer).toBe('distributed-core');
    });

    it('validates pipeline:step:started with { runId, stepId, nodeType, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineStepStarted);

        expect(registry.validate('pipeline:step:started', {
            runId: 'run_01',
            stepId: 'step_a',
            nodeType: 'llm',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:started when nodeType is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineStepStarted);

        expect(registry.validate('pipeline:step:started', {
            runId: 'run_01',
            stepId: 'step_a',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('validates pipeline:step:completed with { runId, stepId, durationMs, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineStepCompleted);

        expect(registry.validate('pipeline:step:completed', {
            runId: 'run_01',
            stepId: 'step_a',
            durationMs: 1500,
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:completed when durationMs is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineStepCompleted);

        expect(registry.validate('pipeline:step:completed', {
            runId: 'run_01',
            stepId: 'step_a',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('validates pipeline:step:failed with { runId, stepId, error, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineStepFailed);

        expect(registry.validate('pipeline:step:failed', {
            runId: 'run_01',
            stepId: 'step_a',
            error: 'Timeout after 30s',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:failed when error is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineStepFailed);

        expect(registry.validate('pipeline:step:failed', {
            runId: 'run_01',
            stepId: 'step_a',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('validates pipeline:step:breakpoint with { runId, stepId, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineStepBreakpoint);

        expect(registry.validate('pipeline:step:breakpoint', {
            runId: 'run_01',
            stepId: 'step_debug',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:breakpoint when stepId is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineStepBreakpoint);

        expect(registry.validate('pipeline:step:breakpoint', {
            runId: 'run_01',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// P1 context mutation declarations
// ---------------------------------------------------------------------------

describe('P1 context mutation declarations', () => {
    it('pipeline:step:context.patched has signal transport + distributed-core producer', () => {
        expect(pipelineContextPatched.name).toBe('pipeline:step:context.patched');
        expect(pipelineContextPatched.transport).toBe('signal');
        expect(pipelineContextPatched.producer).toBe('distributed-core');
    });

    it('validates pipeline:step:context.patched with a conforming payload', () => {
        const registry = new Registry();
        registry.declare(pipelineContextPatched);

        expect(registry.validate('pipeline:step:context.patched', {
            runId: 'run_01',
            stepId: 'step_paused',
            patchId: 'patch_01',
            mode: 'replace',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:context.patched when patchId is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineContextPatched);

        expect(registry.validate('pipeline:step:context.patched', {
            runId: 'run_01',
            stepId: 'step_paused',
            mode: 'replace',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('pipeline:step:context.patched-unvalidated has same transport/producer as patched', () => {
        expect(pipelineContextPatchedUnvalidated.name).toBe('pipeline:step:context.patched-unvalidated');
        expect(pipelineContextPatchedUnvalidated.transport).toBe('signal');
        expect(pipelineContextPatchedUnvalidated.producer).toBe('distributed-core');
    });

    it('validates pipeline:step:context.patch-reverted with { runId, stepId, patchId, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineContextPatchReverted);

        expect(registry.validate('pipeline:step:context.patch-reverted', {
            runId: 'run_01',
            stepId: 'step_paused',
            patchId: 'patch_01',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:step:context.patch-reverted when patchId is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineContextPatchReverted);

        expect(registry.validate('pipeline:step:context.patch-reverted', {
            runId: 'run_01',
            stepId: 'step_paused',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// P1 LLM observability declarations
// ---------------------------------------------------------------------------

describe('P1 LLM observability declarations', () => {
    it('pipeline:llm:prompt has signal transport + distributed-core producer', () => {
        expect(pipelineLlmPrompt.name).toBe('pipeline:llm:prompt');
        expect(pipelineLlmPrompt.transport).toBe('signal');
        expect(pipelineLlmPrompt.producer).toBe('distributed-core');
    });

    it('validates pipeline:llm:prompt with { runId, stepId, prompt, model, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineLlmPrompt);

        expect(registry.validate('pipeline:llm:prompt', {
            runId: 'run_01',
            stepId: 'step_llm',
            prompt: 'Summarize the document.',
            model: 'gpt-4o',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:llm:prompt when model is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineLlmPrompt);

        expect(registry.validate('pipeline:llm:prompt', {
            runId: 'run_01',
            stepId: 'step_llm',
            prompt: 'Summarize.',
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });

    it('pipeline:llm:response has signal transport + distributed-core producer', () => {
        expect(pipelineLlmResponse.name).toBe('pipeline:llm:response');
        expect(pipelineLlmResponse.transport).toBe('signal');
        expect(pipelineLlmResponse.producer).toBe('distributed-core');
    });

    it('validates pipeline:llm:response with { runId, stepId, response, tokensIn, tokensOut, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineLlmResponse);

        expect(registry.validate('pipeline:llm:response', {
            runId: 'run_01',
            stepId: 'step_llm',
            response: 'The document is about...',
            tokensIn: 120,
            tokensOut: 45,
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(true);
    });

    it('rejects pipeline:llm:response when tokensOut is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineLlmResponse);

        expect(registry.validate('pipeline:llm:response', {
            runId: 'run_01',
            stepId: 'step_llm',
            response: 'Some text',
            tokensIn: 100,
            at: '2026-05-15T10:00:00.000Z',
        }).valid).toBe(false);
    });
});
