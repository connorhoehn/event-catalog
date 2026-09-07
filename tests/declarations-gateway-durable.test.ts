// tests/declarations-gateway-durable.test.ts
//
// The gateway's durable surface. Unlike the WS frames in gateway-signal,
// these two events are persisted, retried and drained by platform-api — so
// the validation cases below are written from the PRODUCER's real object
// literal and the CONSUMER's real field reads, not from the gateway's own
// (uniformly loose) mirror declaration.

import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    activityRecorded,
    callReactionRecorded,
    gatewayDurableDeclarations,
} from '../src/declarations/gateway-durable';
import { gatewaySignalDeclarations } from '../src/declarations/gateway-signal';

/** The exact payload realtime-modules ActivityService.handlePublish builds. */
const REAL_ACTIVITY_PAYLOAD = {
    eventType: 'doc.finalize',
    detail: { documentId: 'doc_1' },
    timestamp: '2026-09-07T10:00:00.000Z',
    userId: 'u_42',
    displayName: 'Ada',
};

/** The exact payload realtime-examples server.ts:1044 builds. */
const REAL_REACTION_PAYLOAD = {
    reactionId: 'r_abc',
    channel: 'call:standup',
    lobbyName: 'standup',
    userId: 'u_42',
    displayName: 'Ada',
    emoji: 'tada',
    effect: 'confetti',
    at: '2026-09-07T10:00:00.000Z',
};

function registryWith(...decls: Parameters<Registry['declare']>[0][]): Registry {
    const registry = new Registry();
    for (const d of decls) registry.declare(d);
    return registry;
}

describe('gateway-durable declarations — bulk registration', () => {
    it('registers every gateway durable event in a fresh registry without error', () => {
        const registry = new Registry();
        for (const decl of gatewayDurableDeclarations) {
            expect(registry.declare(decl).compatible).toBe(true);
        }
        expect(registry.size()).toBe(gatewayDurableDeclarations.length);
    });

    it('declares exactly the two events the gateway publishes durably', () => {
        // Every `catalog.publish(...)` call site in realtime-examples/src.
        // A third one appearing here without a declaration is the gap this
        // module was written to close.
        expect(gatewayDurableDeclarations.map((d) => d.name).sort()).toEqual([
            'activity.recorded',
            'call:reaction.recorded',
        ]);
    });

    it('has no duplicate event names', () => {
        const names = gatewayDurableDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('every event reaches the durable transport', () => {
        for (const decl of gatewayDurableDeclarations) {
            expect(['durable', 'both'], decl.name).toContain(decl.transport);
        }
    });

    it('all events attribute websocket-gateway as producer', () => {
        expect(gatewayDurableDeclarations.every((d) => d.producer === 'websocket-gateway')).toBe(true);
    });

    it('does not overlap with the gateway signal frames', () => {
        const signalNames = new Set(gatewaySignalDeclarations.map((d) => d.name));
        for (const decl of gatewayDurableDeclarations) {
            expect(signalNames.has(decl.name), decl.name).toBe(false);
        }
    });
});

describe('activity.recorded', () => {
    it('is dual-transport — durable for the DDB drain, signal for the live feed', () => {
        expect(activityRecorded.transport).toBe('both');
    });

    it('accepts the payload ActivityService actually enriches and publishes', () => {
        const registry = registryWith(activityRecorded);
        expect(registry.validate('activity.recorded', REAL_ACTIVITY_PAYLOAD).valid).toBe(true);
    });

    it('accepts an anonymous entry — userId is null, not absent', () => {
        const registry = registryWith(activityRecorded);
        expect(
            registry.validate('activity.recorded', {
                ...REAL_ACTIVITY_PAYLOAD,
                userId: null,
                displayName: 'anonymous',
            }).valid,
        ).toBe(true);
    });

    it('requires every field the producer unconditionally constructs', () => {
        const registry = registryWith(activityRecorded);
        for (const field of ['eventType', 'detail', 'timestamp', 'userId', 'displayName']) {
            const payload: Record<string, unknown> = { ...REAL_ACTIVITY_PAYLOAD };
            delete payload[field];
            expect(
                registry.validate('activity.recorded', payload).valid,
                `omitting ${field} should be rejected`,
            ).toBe(false);
        }
    });

    it('rejects an empty eventType — the consumer uses it as a pipeline-trigger key', () => {
        const registry = registryWith(activityRecorded);
        expect(
            registry.validate('activity.recorded', { ...REAL_ACTIVITY_PAYLOAD, eventType: '' }).valid,
        ).toBe(false);
    });

    it('stays open to added fields', () => {
        const registry = registryWith(activityRecorded);
        expect(
            registry.validate('activity.recorded', { ...REAL_ACTIVITY_PAYLOAD, orgId: 'org_1' }).valid,
        ).toBe(true);
    });
});

describe('call:reaction.recorded', () => {
    it('is durable only — the live fan-out stays on the signal reaction frames', () => {
        expect(callReactionRecorded.transport).toBe('durable');
    });

    it('carries the queue settings platform-api drains against', () => {
        expect(callReactionRecorded.queue).toBe('call-reaction-recorded');
        expect(callReactionRecorded.dlqAfterAttempts).toBe(3);
    });

    it('accepts the payload the ReactionService onReaction tap actually publishes', () => {
        const registry = registryWith(callReactionRecorded);
        expect(registry.validate('call:reaction.recorded', REAL_REACTION_PAYLOAD).valid).toBe(true);
    });

    it('accepts an anonymous reaction with no displayName and no effect', () => {
        const registry = registryWith(callReactionRecorded);
        const { displayName: _d, effect: _e, ...rest } = REAL_REACTION_PAYLOAD;
        expect(registry.validate('call:reaction.recorded', { ...rest, userId: null }).valid).toBe(true);
    });

    it('requires the fields the DDB row is built from', () => {
        const registry = registryWith(callReactionRecorded);
        for (const field of ['reactionId', 'channel', 'lobbyName', 'userId', 'emoji', 'at']) {
            const payload: Record<string, unknown> = { ...REAL_REACTION_PAYLOAD };
            delete payload[field];
            expect(
                registry.validate('call:reaction.recorded', payload).valid,
                `omitting ${field} should be rejected`,
            ).toBe(false);
        }
    });

    it('rejects a non-call channel — the tap fires for call: reactions only', () => {
        const registry = registryWith(callReactionRecorded);
        expect(
            registry.validate('call:reaction.recorded', {
                ...REAL_REACTION_PAYLOAD,
                channel: 'doc:readme',
            }).valid,
        ).toBe(false);
    });

    it('stays open so the producer can start stamping orgId for tenancy', () => {
        // platform-api's call-reaction-consumer already reads payload.orgId
        // and routes org-less rows to the TENANTLESS namespace. Closing this
        // schema would block that fix rather than document it.
        const registry = registryWith(callReactionRecorded);
        expect(
            registry.validate('call:reaction.recorded', { ...REAL_REACTION_PAYLOAD, orgId: 'org_1' }).valid,
        ).toBe(true);
    });
});
