import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    pipelineP1Declarations,
    pipelineStepCompleted,
    pipelineLlmToken,
    pipelineContextPatched,
    pipelineRunCancelled,
} from '../src/declarations/pipeline-p1';

describe('pipeline-p1 declarations (wave1-ec-2)', () => {
    it('bulk-registers every P1 pipeline event in a fresh registry', () => {
        const registry = new Registry();
        for (const decl of pipelineP1Declarations) {
            registry.declare(decl);
        }
        expect(registry.size()).toBe(pipelineP1Declarations.length);

        // Every declaration is signal-transport from distributed-core.
        const all = registry.list();
        expect(all.every((e) => e.transport === 'signal')).toBe(true);
        expect(all.every((e) => e.producer === 'distributed-core')).toBe(true);
    });

    it('declares unique event names with the expected cluster prefixes', () => {
        const names = pipelineP1Declarations.map((d) => d.name);
        // No duplicates.
        expect(new Set(names).size).toBe(names.length);
        // Cluster prefix coverage — sanity check.
        expect(names.some((n) => n.startsWith('pipeline:run:'))).toBe(true);
        expect(names.some((n) => n.startsWith('pipeline:step:'))).toBe(true);
        expect(names.some((n) => n.startsWith('pipeline:llm:'))).toBe(true);
        expect(names.some((n) => n.includes('context.'))).toBe(true);
    });

    it('does NOT overlap with EC-1 approval/checkpoint event names', () => {
        // EC-1 declares these three on a parallel branch; EC-2 must not.
        const ec1Names = new Set([
            'pipeline.approval.requested',
            'pipeline.approval.recorded',
            'pipeline.run.checkpoint',
        ]);
        for (const decl of pipelineP1Declarations) {
            expect(ec1Names.has(decl.name)).toBe(false);
        }
    });

    it('validates a realistic pipeline:step:completed payload', () => {
        const registry = new Registry();
        registry.declare(pipelineStepCompleted);
        const result = registry.validate('pipeline:step:completed', {
            runId: 'run_01',
            stepId: 'step_abc',
            durationMs: 1234,
            at: '2026-05-14T12:00:00.000Z',
        });
        expect(result.valid).toBe(true);

        // Missing required `durationMs` should fail.
        const missing = registry.validate('pipeline:step:completed', {
            runId: 'run_01',
            stepId: 'step_abc',
            at: '2026-05-14T12:00:00.000Z',
        });
        expect(missing.valid).toBe(false);
    });

    it('validates pipeline:llm:token + pipeline:run:cancelled payloads', () => {
        const registry = new Registry();
        registry.declare(pipelineLlmToken);
        registry.declare(pipelineRunCancelled);

        expect(
            registry.validate('pipeline:llm:token', {
                runId: 'r1',
                stepId: 's1',
                token: 'hello',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        expect(
            registry.validate('pipeline:run:cancelled', {
                runId: 'r1',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('exposes context.patched with the discriminator-style payload', () => {
        // Use the imported declaration directly (not via registry) so we
        // exercise the constant export path.
        expect(pipelineContextPatched.name).toBe('pipeline:step:context.patched');
        expect(pipelineContextPatched.transport).toBe('signal');
        const required = (pipelineContextPatched.schema as { required?: string[] }).required ?? [];
        expect(required).toContain('patchId');
        expect(required).toContain('mode');
    });
});
