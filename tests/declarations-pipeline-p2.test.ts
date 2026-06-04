import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    pipelineP2Declarations,
    pipelineRunStarted,
    pipelineRunFailed,
    pipelineRunRetry,
    pipelineRunStuck,
    pipelineRunResumedFromStep,
    pipelineJoinWaiting,
    pipelineJoinFired,
    pipelineStepBreakpoint,
} from '../src/declarations/pipeline-p2';
import { pipelineP1Declarations } from '../src/declarations/pipeline-p1';
import { pipelineDeclarations } from '../src/declarations/pipeline';
import {
    pipelineRaftStateMachineDeclarations,
    pipelineRaftDeclarations,
    pipelineRaftRunStarted,
    pipelineRaftRunSynthesized,
    pipelineRaftRunUpdated,
    pipelineRaftRunCheckpointed,
    pipelineRaftRunTerminated,
} from '../src/declarations/pipeline-raft';
import { pipelineEventDeclarations } from '../src/declarations/pipeline-events';

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
        // All events are signal-transport; producers are either distributed-core
        // or websocket-gateway (for the gateway-local resumeFromStep stub).
        expect(all.every((e) => ['distributed-core', 'websocket-gateway'].includes(e.producer))).toBe(true);
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

    it('covers the expected EC-10 event list (12 names)', () => {
        const expected = new Set([
            'pipeline:run:started',
            'pipeline:run:completed',
            'pipeline:run:failed',
            'pipeline:run:orphaned',
            'pipeline:run:reassigned',
            'pipeline:run:resumed-from-step',
            'pipeline:run:resumeFromStep',
            'pipeline:run:retry',
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

// ---------------------------------------------------------------------------
// wave20-a additions
// ---------------------------------------------------------------------------

describe('pipeline:run:retry declaration (wave20-a)', () => {
    it('has signal transport + distributed-core producer', () => {
        expect(pipelineRunRetry.name).toBe('pipeline:run:retry');
        expect(pipelineRunRetry.transport).toBe('signal');
        expect(pipelineRunRetry.producer).toBe('distributed-core');
    });

    it('validates { runId, attempt, at }', () => {
        const registry = new Registry();
        registry.declare(pipelineRunRetry);

        expect(
            registry.validate('pipeline:run:retry', {
                runId: 'r1',
                attempt: 2,
                at: '2026-05-20T10:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('rejects when attempt is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineRunRetry);

        expect(
            registry.validate('pipeline:run:retry', {
                runId: 'r1',
                at: '2026-05-20T10:00:00.000Z',
            }).valid,
        ).toBe(false);
    });

    it('rejects when runId is missing', () => {
        const registry = new Registry();
        registry.declare(pipelineRunRetry);

        expect(
            registry.validate('pipeline:run:retry', {
                attempt: 1,
                at: '2026-05-20T10:00:00.000Z',
            }).valid,
        ).toBe(false);
    });
});

describe('pipelineRaftStateMachineDeclarations (wave20-a)', () => {
    it('exports exactly 4 SM transition declarations', () => {
        expect(pipelineRaftStateMachineDeclarations).toHaveLength(4);
    });

    it('contains synthesized, updated, checkpointed, terminated — NOT started', () => {
        const names = pipelineRaftStateMachineDeclarations.map((d) => d.name);
        expect(names).toContain('pipeline:raft:run:synthesized');
        expect(names).toContain('pipeline:raft:run:updated');
        expect(names).toContain('pipeline:raft:run:checkpointed');
        expect(names).toContain('pipeline:raft:run:terminated');
        expect(names).not.toContain('pipeline:raft:run:started');
    });

    it('all SM declarations have signal transport + platform-api producer', () => {
        for (const decl of pipelineRaftStateMachineDeclarations) {
            expect(decl.transport).toBe('signal');
            expect(decl.producer).toBe('platform-api');
        }
    });

    it('bulk-registers in a fresh registry without errors', () => {
        const registry = new Registry();
        for (const decl of pipelineRaftStateMachineDeclarations) {
            const result = registry.declare(decl);
            expect(result.compatible).toBe(true);
        }
        expect(registry.size()).toBe(4);
    });

    it('validates pipeline:raft:run:synthesized with { runId, slot }', () => {
        const registry = new Registry();
        registry.declare(pipelineRaftRunSynthesized);

        const validSlot = { runId: 'run_01', status: 'running', lastAppliedIndex: 1 };
        expect(registry.validate('pipeline:raft:run:synthesized', { runId: 'run_01', slot: validSlot }).valid).toBe(true);
        expect(registry.validate('pipeline:raft:run:synthesized', { runId: 'run_01' }).valid).toBe(false);
    });

    it('validates pipeline:raft:run:updated with { runId, slot }', () => {
        const registry = new Registry();
        registry.declare(pipelineRaftRunUpdated);

        const validSlot = { runId: 'run_01', status: 'running', lastAppliedIndex: 2 };
        expect(registry.validate('pipeline:raft:run:updated', { runId: 'run_01', slot: validSlot }).valid).toBe(true);
    });

    it('validates pipeline:raft:run:checkpointed requires checkpoint in slot', () => {
        const registry = new Registry();
        registry.declare(pipelineRaftRunCheckpointed);

        const slotWithCheckpoint = { runId: 'run_01', status: 'running', lastAppliedIndex: 3, checkpoint: { ctx: {} } };
        const slotWithoutCheckpoint = { runId: 'run_01', status: 'running', lastAppliedIndex: 3 };

        expect(registry.validate('pipeline:raft:run:checkpointed', { runId: 'run_01', slot: slotWithCheckpoint }).valid).toBe(true);
        expect(registry.validate('pipeline:raft:run:checkpointed', { runId: 'run_01', slot: slotWithoutCheckpoint }).valid).toBe(false);
    });

    it('validates pipeline:raft:run:terminated requires terminal status enum', () => {
        const registry = new Registry();
        registry.declare(pipelineRaftRunTerminated);

        expect(registry.validate('pipeline:raft:run:terminated', { runId: 'run_01', slot: { runId: 'run_01', status: 'completed', lastAppliedIndex: 5 } }).valid).toBe(true);
        expect(registry.validate('pipeline:raft:run:terminated', { runId: 'run_01', slot: { runId: 'run_01', status: 'running', lastAppliedIndex: 5 } }).valid).toBe(false);
    });
});

describe('pipelineEventDeclarations includes P2 events (wave20-a)', () => {
    it('exports 30 declarations (P0:3 + P1:11 + P2:9 + Judge:4 + Vision:3)', () => {
        expect(pipelineEventDeclarations).toHaveLength(30);
    });

    it('contains all P2 run lifecycle events', () => {
        const names = pipelineEventDeclarations.map((d) => d.name);
        expect(names).toContain('pipeline:run:started');
        expect(names).toContain('pipeline:run:completed');
        expect(names).toContain('pipeline:run:failed');
        expect(names).toContain('pipeline:run:orphaned');
        expect(names).toContain('pipeline:run:reassigned');
        expect(names).toContain('pipeline:run:resumed-from-step');
        expect(names).toContain('pipeline:run:retry');
        expect(names).toContain('pipeline:join:waiting');
        expect(names).toContain('pipeline:join:fired');
    });

    it('has no duplicate names', () => {
        const names = pipelineEventDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });
});

describe('pipelineRaftDeclarations (full 5-event array)', () => {
    it('exports exactly 5 declarations', () => {
        expect(pipelineRaftDeclarations).toHaveLength(5);
    });

    it('contains pipeline:raft:run:started (absent from SM-only array)', () => {
        const fullNames = pipelineRaftDeclarations.map((d) => d.name);
        const smNames = pipelineRaftStateMachineDeclarations.map((d) => d.name);
        expect(fullNames).toContain('pipeline:raft:run:started');
        expect(smNames).not.toContain('pipeline:raft:run:started');
    });

    it('bulk-registers all 5 events in a fresh registry without errors', () => {
        const registry = new Registry();
        for (const decl of pipelineRaftDeclarations) {
            const result = registry.declare(decl);
            expect(result.compatible).toBe(true);
        }
        expect(registry.size()).toBe(5);
    });

    it('all 5 declarations have signal transport + platform-api producer', () => {
        for (const decl of pipelineRaftDeclarations) {
            expect(decl.transport).toBe('signal');
            expect(decl.producer).toBe('platform-api');
        }
    });

    describe('pipelineRaftRunStarted payload validation', () => {
        let registry: Registry;

        beforeEach(() => {
            registry = new Registry();
            registry.declare(pipelineRaftRunStarted);
        });

        it('accepts a valid payload with runId and full slot', () => {
            expect(registry.validate('pipeline:raft:run:started', {
                runId: 'run_abc',
                slot: {
                    runId: 'run_abc',
                    status: 'running',
                    lastAppliedIndex: 0,
                    pipelineId: 'pipe_001',
                    pipelineVersion: 3,
                    ownerNodeId: 'node_42',
                    checkpoint: {},
                },
            }).valid).toBe(true);
        });

        it('rejects a payload missing runId', () => {
            expect(registry.validate('pipeline:raft:run:started', {
                slot: { runId: 'run_abc', status: 'running', lastAppliedIndex: 0 },
            }).valid).toBe(false);
        });

        it('rejects a payload missing slot', () => {
            expect(registry.validate('pipeline:raft:run:started', {
                runId: 'run_abc',
            }).valid).toBe(false);
        });
    });
});
