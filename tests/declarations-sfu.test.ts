// tests/declarations-sfu.test.ts
//
// The `sfu.*` namespace. The interesting cases here are the five schemas
// that were corrected against the SFU's real emit sites: LVS's own copy is
// `additionalProperties: false` throughout, so every field the producer sends
// but the schema omits is a payload the contract REJECTS. Those five each get
// a test that feeds the producer's actual object literal through the
// validator.

import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import {
    sfuDeclarations,
    sfuSessionCreated,
    sfuStreamHealthDegraded,
    sfuRecordingStarted,
    sfuRecordingCompleted,
    sfuRecordingStateChanged,
    sfuProducerAdded,
    sfuProducerRemoved,
    sfuChatMessage,
    sfuChatUserBanned,
    sfuChannelDeleted,
} from '../src/declarations/sfu';
import { gatewaySignalDeclarations } from '../src/declarations/gateway-signal';
import { pipelineDeclarations } from '../src/declarations/pipeline';

function registryWith(decl: Parameters<Registry['declare']>[0]): Registry {
    const registry = new Registry();
    registry.declare(decl);
    return registry;
}

describe('sfu declarations — bulk registration', () => {
    it('registers all 20 SFU events in a fresh registry without error', () => {
        const registry = new Registry();
        for (const decl of sfuDeclarations) {
            expect(registry.declare(decl).compatible, decl.name).toBe(true);
        }
        expect(registry.size()).toBe(20);
    });

    it('has no duplicate event names', () => {
        const names = sfuDeclarations.map((d) => d.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('all events use the sfu namespace, an sfu. name, and the sfu-cluster producer', () => {
        for (const decl of sfuDeclarations) {
            expect(decl.namespace, decl.name).toBe('sfu');
            expect(decl.name.startsWith('sfu.'), decl.name).toBe(true);
            expect(decl.producer, decl.name).toBe('sfu-cluster');
        }
    });

    it('splits 12 durable webhook events from 8 signal events', () => {
        const durable = sfuDeclarations.filter((d) => d.transport === 'durable');
        const signal = sfuDeclarations.filter((d) => d.transport === 'signal');
        expect(durable).toHaveLength(12);
        expect(signal).toHaveLength(8);
    });

    it('every durable event names the queue it lands on and a retention', () => {
        for (const decl of sfuDeclarations.filter((d) => d.transport === 'durable')) {
            expect(decl.queue, decl.name).toBeTruthy();
            expect(typeof decl.retention, decl.name).toBe('number');
        }
    });

    it('every control-plane signal event names the stream-events bus', () => {
        for (const name of ['sfu.producer.added', 'sfu.producer.removed', 'sfu.recording.state.changed']) {
            const decl = sfuDeclarations.find((d) => d.name === name)!;
            expect(decl.channel, name).toBe('stream-events');
        }
    });

    it('the chat-bus events carry no channel — the arn is the Redis channel name', () => {
        for (const decl of sfuDeclarations.filter((d) => d.name.startsWith('sfu.chat.'))) {
            expect(decl.channel, decl.name).toBeUndefined();
            expect(
                Object.keys(decl.schema.properties as object).includes('channelArn'),
                decl.name,
            ).toBe(false);
        }
    });

    it('every non-chat event carries channelArn as a required field', () => {
        for (const decl of sfuDeclarations.filter((d) => !d.name.startsWith('sfu.chat.'))) {
            expect(decl.schema.required as string[], decl.name).toContain('channelArn');
        }
    });

    it('does not overlap with the gateway or pipeline namespaces', () => {
        const others = new Set([
            ...gatewaySignalDeclarations.map((d) => d.name),
            ...pipelineDeclarations.map((d) => d.name),
        ]);
        for (const decl of sfuDeclarations) {
            expect(others.has(decl.name), decl.name).toBe(false);
        }
    });
});

describe('sfu.session.created', () => {
    it('accepts the emit-site payload joined to the envelope arn', () => {
        const registry = registryWith(sfuSessionCreated);
        expect(
            registry.validate('sfu.session.created', {
                channelArn: 'arn:sfu:channel/abc',
                sessionId: 'transport_1',
                participantId: 'p_1',
            }).valid,
        ).toBe(true);
    });

    it('rejects an unknown field — the webhook payloads are closed contracts', () => {
        const registry = registryWith(sfuSessionCreated);
        expect(
            registry.validate('sfu.session.created', {
                channelArn: 'arn:sfu:channel/abc',
                sessionId: 'transport_1',
                participantId: 'p_1',
                bogus: 1,
            }).valid,
        ).toBe(false);
    });
});

describe('sfu.stream.health.degraded', () => {
    it('accepts null fps and null keyframeGapSec — both are nullable at the monitor', () => {
        const registry = registryWith(sfuStreamHealthDegraded);
        expect(
            registry.validate('sfu.stream.health.degraded', {
                channelArn: 'arn:sfu:channel/abc',
                reasons: ['bitrate_drop_40pct'],
                bitrateBps: 120000,
                fps: null,
                keyframeGapSec: null,
            }).valid,
        ).toBe(true);
    });

    it('rejects an empty reasons array — the monitor never emits without a predicate', () => {
        const registry = registryWith(sfuStreamHealthDegraded);
        expect(
            registry.validate('sfu.stream.health.degraded', {
                channelArn: 'arn:sfu:channel/abc',
                reasons: [],
                bitrateBps: 120000,
                fps: 24,
                keyframeGapSec: 2,
            }).valid,
        ).toBe(false);
    });
});

describe('sfu.recording.started — the per-peer path adds legCount', () => {
    const base = {
        channelArn: 'arn:sfu:channel/abc',
        recordingId: 'rec_1',
        startedAt: '2026-09-07T10:00:00.000Z',
        destination: 'local',
    };

    it('accepts the single-file start payload', () => {
        expect(registryWith(sfuRecordingStarted).validate('sfu.recording.started', base).valid).toBe(true);
    });

    it('accepts the per-peer start payload, which LVS\'s own schema rejected', () => {
        expect(
            registryWith(sfuRecordingStarted)
                .validate('sfu.recording.started', { ...base, legCount: 3 }).valid,
        ).toBe(true);
    });
});

describe('sfu.recording.completed — the seven fields LVS omitted', () => {
    /** RecordingManager.js:1756 verbatim, single-file path. */
    const REAL = {
        channelArn: 'arn:sfu:channel/abc',
        recordingId: 'rec_1',
        segments: [{ key: 'rec_1/seg0.mp4', url: 'https://cdn/rec_1/seg0.mp4', size: 1024 }],
        totalSize: 1024,
        durationMs: 60000,
        destination: 's3',
        recordingProfile: 'single-file',
        profileVersion: 1,
        composePerPeer: false,
        transcribe: true,
    };

    it('accepts the real single-file completion payload', () => {
        expect(registryWith(sfuRecordingCompleted).validate('sfu.recording.completed', REAL).valid).toBe(true);
    });

    it('accepts the per-peer completion payload with tracks, composedUrl and thumbnailUrl', () => {
        expect(
            registryWith(sfuRecordingCompleted).validate('sfu.recording.completed', {
                ...REAL,
                segments: [],
                composePerPeer: true,
                thumbnailUrl: 'https://cdn/rec_1/poster.jpg',
                composedUrl: 'https://cdn/rec_1/composed.mp4',
                tracks: [{
                    participantId: 'p_1',
                    userId: 'u_1',
                    key: 'rec_1/p_1.mp4',
                    url: 'https://cdn/rec_1/p_1.mp4',
                    size: 512,
                    kind: 'av',
                }],
            }).valid,
        ).toBe(true);
    });

    it('requires the four profile fields the producer always sends', () => {
        const registry = registryWith(sfuRecordingCompleted);
        for (const field of ['recordingProfile', 'profileVersion', 'composePerPeer', 'transcribe']) {
            const payload: Record<string, unknown> = { ...REAL };
            delete payload[field];
            expect(
                registry.validate('sfu.recording.completed', payload).valid,
                `omitting ${field} should be rejected`,
            ).toBe(false);
        }
    });

    it('types each segment as { key, url, size }', () => {
        const registry = registryWith(sfuRecordingCompleted);
        expect(
            registry.validate('sfu.recording.completed', {
                ...REAL,
                segments: [{ key: 'k', url: 'u', size: 'big' }],
            }).valid,
        ).toBe(false);
    });
});

describe('sfu.recording.state.changed — the prune path', () => {
    it('accepts the zero-track prune payload, which LVS\'s own schema rejected', () => {
        expect(
            registryWith(sfuRecordingStateChanged).validate('sfu.recording.state.changed', {
                channelArn: 'arn:sfu:channel/abc',
                isRecording: false,
                recordingId: 'rec_1',
                startedAt: '2026-09-07T10:00:00.000Z',
                pruned: true,
                reason: 'no-tracks',
            }).valid,
        ).toBe(true);
    });

    it('accepts the plain start payload', () => {
        expect(
            registryWith(sfuRecordingStateChanged).validate('sfu.recording.state.changed', {
                channelArn: 'arn:sfu:channel/abc',
                isRecording: true,
                recordingId: 'rec_1',
                startedAt: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(true);
    });
});

describe('sfu.producer.added / removed — mesh-pipe fields that are never sent', () => {
    it('accepts the identity-stamped create-producer payload', () => {
        expect(
            registryWith(sfuProducerAdded).validate('sfu.producer.added', {
                channelArn: 'arn:sfu:channel/abc',
                producerId: 'prod_1',
                kind: 'video',
                participantId: 'p_1',
                displayName: 'Ada',
                userId: 'u_1',
                isPiped: false,
                state: { muted: false },
            }).valid,
        ).toBe(true);
    });

    it('accepts the leaner transport-produce payload', () => {
        expect(
            registryWith(sfuProducerAdded).validate('sfu.producer.added', {
                channelArn: 'arn:sfu:channel/abc',
                producerId: 'prod_1',
                kind: 'audio',
                participantId: 'p_1',
                isPiped: false,
            }).valid,
        ).toBe(true);
    });

    it('does not declare sourceNode / originalProducerId — no emit site sends them', () => {
        const props = Object.keys(sfuProducerAdded.schema.properties as object);
        expect(props).not.toContain('sourceNode');
        expect(props).not.toContain('originalProducerId');
    });

    it('does not declare isPiped / sourceNode on removal — neither emit site sends them', () => {
        const props = Object.keys(sfuProducerRemoved.schema.properties as object);
        expect(props).not.toContain('isPiped');
        expect(props).not.toContain('sourceNode');
    });

    it('accepts the removal payload both emit sites build', () => {
        expect(
            registryWith(sfuProducerRemoved).validate('sfu.producer.removed', {
                channelArn: 'arn:sfu:channel/abc',
                producerId: 'prod_1',
                kind: 'video',
                participantId: 'p_1',
            }).valid,
        ).toBe(true);
    });
});

describe('sfu chat-bus events — two wire conventions, on purpose', () => {
    it('accepts the IVS Chat PascalCase message frame verbatim', () => {
        expect(
            registryWith(sfuChatMessage).validate('sfu.chat.message', {
                Type: 'MESSAGE',
                Id: 'abc123',
                RequestId: 'req_1',
                Sender: { UserId: 'u_1', Attributes: {} },
                Content: 'hello',
                Attributes: {},
                SendTime: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('accepts a server-originated message with no RequestId', () => {
        expect(
            registryWith(sfuChatMessage).validate('sfu.chat.message', {
                Type: 'MESSAGE',
                Id: 'abc123',
                Sender: { UserId: 'server', Attributes: {} },
                Content: 'hello',
                Attributes: {},
                SendTime: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('pins the frame discriminator', () => {
        expect(
            registryWith(sfuChatMessage).validate('sfu.chat.message', {
                Type: 'MESSAGE_DELETED',
                Id: 'abc123',
                Sender: { UserId: 'u_1', Attributes: {} },
                Content: 'hello',
                Attributes: {},
                SendTime: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(false);
    });

    it('uses lowercase keys for the internal ban events, which no client sees', () => {
        expect(
            registryWith(sfuChatUserBanned).validate('sfu.chat.user.banned', {
                type: 'user.banned',
                userId: 'u_1',
                reason: '',
                durationSeconds: null,
            }).valid,
        ).toBe(true);
    });
});

describe('sfu.channel.deleted', () => {
    it('carries only the arn — the wire data field is empty', () => {
        expect(Object.keys(sfuChannelDeleted.schema.properties as object)).toEqual(['channelArn']);
        expect(
            registryWith(sfuChannelDeleted)
                .validate('sfu.channel.deleted', { channelArn: 'arn:sfu:channel/abc' }).valid,
        ).toBe(true);
    });
});
