import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    pipelineP2Declarations,
    pipelineRunStarted,
    pipelineRunFailed,
    pipelineRunStuck,
    pipelineRunResumedFromStep,
    pipelineJoinWaiting,
    pipelineJoinFired,
    pipelineStepBreakpoint,
} from '../src/declarations/pipeline-p2';
import { pipelineP1Declarations } from '../src/declarations/pipeline-p1';
import { pipelineDeclarations } from '../src/declarations/pipeline';

describe('pipeline-p2 declarations (wave4-ec-10)', () => {
    it('bulk-registers every P2 pipeline event in a fresh registry', () => {
        const registry = new Registry();
        for (const decl of pipelineP2Declarations) {
            registry.declare(decl);
        }
        expect(registry.size()).toBe(pipelineP2Declarations.length);

        // Every declaration is signal-transport from distributed-core.
        const all = registry.list();
        expect(all.every((e) => e.transport === 'signal')).toBe(true);
        expect(all.every((e) => e.producer === 'distributed-core')).toBe(true);
    });

    it('declares unique event names with the expected cluster prefixes', () => {
        const names = pipelineP2Declarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);

        // Cluster prefix coverage — sanity check.
        expect(names.some((n) => n.startsWith('pipeline:run:'))).toBe(true);
        expect(names.some((n) => n.startsWith('pipeline:step:'))).toBe(true);
        expect(names.some((n) => n.startsWith('pipeline:join:'))).toBe(true);
    });

    it('does NOT overlap with EC-1 or EC-2 declarations', () => {
        const ec1Names = new Set(pipelineDeclarations.map((d) => d.name));
        const ec2Names = new Set(pipelineP1Declarations.map((d) => d.name));
        for (const decl of pipelineP2Declarations) {
            expect(ec1Names.has(decl.name)).toBe(false);
            expect(ec2Names.has(decl.name)).toBe(false);
        }
    });

    it('covers the expected EC-10 event list (10 names)', () => {
        const expected = new Set([
            'pipeline:run:started',
            'pipeline:run:completed',
            'pipeline:run:failed',
            'pipeline:run:orphaned',
            'pipeline:run:reassigned',
            'pipeline:run:resumed-from-step',
            'pipeline:run:stuck',
            'pipeline:step:breakpoint',
            'pipeline:join:waiting',
            'pipeline:join:fired',
        ]);
        const actual = new Set(pipelineP2Declarations.map((d) => d.name));
        expect(actual).toEqual(expected);
    });

    it('validates pipeline:run:started + pipeline:run:failed payloads', () => {
        const registry = new Registry();
        registry.declare(pipelineRunStarted);
        registry.declare(pipelineRunFailed);

        expect(
            registry.validate('pipeline:run:started', {
                runId: 'r1',
                pipelineId: 'pl_abc',
                triggeredBy: { kind: 'manual', userId: 'u1' },
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        // Missing `pipelineId` should fail.
        expect(
            registry.validate('pipeline:run:started', {
                runId: 'r1',
                triggeredBy: { kind: 'manual' },
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(false);

        // run:failed: structured error object accepted.
        expect(
            registry.validate('pipeline:run:failed', {
                runId: 'r1',
                error: { code: 'STEP_FAILED', message: 'boom', stepId: 's2' },
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('validates pipeline:run:stuck with nullable lastHeartbeatAt', () => {
        const registry = new Registry();
        registry.declare(pipelineRunStuck);

        // String form (heartbeat seen at some point).
        expect(
            registry.validate('pipeline:run:stuck', {
                runId: 'r1',
                lastHeartbeatAt: '2026-05-14T11:50:00.000Z',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        // Null form (no heartbeat ever observed).
        expect(
            registry.validate('pipeline:run:stuck', {
                runId: 'r1',
                lastHeartbeatAt: null,
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('validates pipeline:run:resumed-from-step with optional originalFailedStepId', () => {
        const registry = new Registry();
        registry.declare(pipelineRunResumedFromStep);

        // Without optional field.
        expect(
            registry.validate('pipeline:run:resumed-from-step', {
                runId: 'r1',
                fromNodeId: 'node_42',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        // With optional field present.
        expect(
            registry.validate('pipeline:run:resumed-from-step', {
                runId: 'r1',
                fromNodeId: 'node_42',
                originalFailedStepId: 'step_old',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        // Missing required `fromNodeId` should fail.
        expect(
            registry.validate('pipeline:run:resumed-from-step', {
                runId: 'r1',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(false);
    });

    it('validates join + breakpoint payloads', () => {
        const registry = new Registry();
        registry.declare(pipelineJoinWaiting);
        registry.declare(pipelineJoinFired);
        registry.declare(pipelineStepBreakpoint);

        expect(
            registry.validate('pipeline:join:waiting', {
                runId: 'r1',
                stepId: 'join_1',
                received: 2,
                required: 3,
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        expect(
            registry.validate('pipeline:join:fired', {
                runId: 'r1',
                stepId: 'join_1',
                inputs: ['a', 'b', 'c'],
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);

        expect(
            registry.validate('pipeline:step:breakpoint', {
                runId: 'r1',
                stepId: 'step_debug',
                at: '2026-05-14T12:00:00.000Z',
            }).valid,
        ).toBe(true);
    });
});
