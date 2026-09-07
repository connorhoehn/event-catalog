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
    sfuProducerStateChanged,
    sfuParticipantDisconnected,
    sfuMemberOwnerChanged,
    sfuChatEvent,
    sfuRecordingComposeQueued,
    sfuRecordingComposeStarted,
    sfuRecordingComposeProgress,
    sfuRecordingComposeFailed,
    sfuRecordingComposeCompleted,
} from '../src/declarations/sfu';
import { gatewaySignalDeclarations } from '../src/declarations/gateway-signal';
import { pipelineDeclarations } from '../src/declarations/pipeline';

/**
 * The five frames that ride the Redis channel `chat-bus:<arn>`.
 *
 * Listed explicitly rather than matched on the `sfu.chat.` prefix: since
 * 2026-09-07 `sfu.chat.event` also starts with that prefix but is a
 * stream-events control-plane event, so a prefix match would assert the
 * chat-bus invariants against an event that legitimately breaks them.
 */
const CHAT_BUS_EVENTS = [
    'sfu.chat.message',
    'sfu.chat.message_deleted',
    'sfu.chat.user_disconnected',
    'sfu.chat.user.banned',
    'sfu.chat.user.unbanned',
];

function registryWith(decl: Parameters<Registry['declare']>[0]): Registry {
    const registry = new Registry();
    registry.declare(decl);
    return registry;
}

describe('sfu declarations — bulk registration', () => {
    it('registers all 29 SFU events in a fresh registry without error', () => {
        const registry = new Registry();
        for (const decl of sfuDeclarations) {
            expect(registry.declare(decl).compatible, decl.name).toBe(true);
        }
        expect(registry.size()).toBe(29);
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

    it('splits 12 durable webhook events from 17 signal events', () => {
        const durable = sfuDeclarations.filter((d) => d.transport === 'durable');
        const signal = sfuDeclarations.filter((d) => d.transport === 'signal');
        expect(durable).toHaveLength(12);
        expect(signal).toHaveLength(17);
    });

    it('every durable event names the queue it lands on and a retention', () => {
        for (const decl of sfuDeclarations.filter((d) => d.transport === 'durable')) {
            expect(decl.queue, decl.name).toBeTruthy();
            expect(typeof decl.retention, decl.name).toBe('number');
        }
    });

    it('every signal event that is not on the chat-bus names the stream-events bus', () => {
        const onTheHub = sfuDeclarations.filter(
            (d) => d.transport === 'signal' && !CHAT_BUS_EVENTS.includes(d.name),
        );
        expect(onTheHub).toHaveLength(12);
        for (const decl of onTheHub) {
            expect(decl.channel, decl.name).toBe('stream-events');
        }
    });

    it('the chat-bus events carry no channel — the arn is the Redis channel name', () => {
        for (const decl of sfuDeclarations.filter((d) => CHAT_BUS_EVENTS.includes(d.name))) {
            expect(decl.channel, decl.name).toBeUndefined();
            expect(
                Object.keys(decl.schema.properties as object).includes('channelArn'),
                decl.name,
            ).toBe(false);
        }
    });

    it('every event off the chat-bus carries channelArn as a required field', () => {
        for (const decl of sfuDeclarations.filter((d) => !CHAT_BUS_EVENTS.includes(d.name))) {
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

// ---------------------------------------------------------------------------
// The nine events added 2026-09-07. Each `REAL` object below is the producer's
// own literal, transcribed from the construction site named in the comment and
// joined to the envelope's channelArn — the same convention the webhook tests
// above use.
// ---------------------------------------------------------------------------

describe('sfu.producer.state-changed', () => {
    /** api/channels/producerState.js:215 verbatim. */
    const REAL = {
        channelArn: 'arn:sfu:channel/abc',
        producerId: 'prod_1',
        participantId: 'p_1',
        kind: 'audio',
        state: { muted: true },
    };

    it('accepts the patch payload the emit site builds', () => {
        expect(
            registryWith(sfuProducerStateChanged).validate('sfu.producer.state-changed', REAL).valid,
        ).toBe(true);
    });

    it('accepts a null kind — the room index may hold no kind for the producer', () => {
        expect(
            registryWith(sfuProducerStateChanged)
                .validate('sfu.producer.state-changed', { ...REAL, kind: null }).valid,
        ).toBe(true);
    });

    it('leaves state open — muted is only the first mutable field', () => {
        expect(
            registryWith(sfuProducerStateChanged).validate('sfu.producer.state-changed', {
                ...REAL,
                state: { muted: false, paused: true },
            }).valid,
        ).toBe(true);
    });
});

describe('sfu.participant.disconnected — two sites, different fields', () => {
    /** api/admin/disconnect-session.js:104 verbatim. */
    it('accepts the admin-disconnect payload, which carries transportId', () => {
        expect(
            registryWith(sfuParticipantDisconnected).validate('sfu.participant.disconnected', {
                channelArn: 'arn:sfu:channel/abc',
                participantId: 'p_1',
                transportId: 'transport_1',
                reason: 'admin disconnect',
                source: 'admin-disconnect',
            }).valid,
        ).toBe(true);
    });

    /** workers/denyListWatcher.js:102 verbatim — no transportId at all. */
    it('accepts the denylist payload, which has no transportId', () => {
        expect(
            registryWith(sfuParticipantDisconnected).validate('sfu.participant.disconnected', {
                channelArn: 'arn:sfu:channel/abc',
                participantId: 'p_1',
                reason: 'denylist',
                source: 'denylist',
            }).valid,
        ).toBe(true);
    });

    it('pins source to the two subsystems that emit', () => {
        expect(
            registryWith(sfuParticipantDisconnected).validate('sfu.participant.disconnected', {
                channelArn: 'arn:sfu:channel/abc',
                participantId: 'p_1',
                reason: 'whatever',
                source: 'made-up',
            }).valid,
        ).toBe(false);
    });
});

describe('sfu.member.owner.changed', () => {
    /** ws/stageWsServer.js:478 verbatim, token carrying a sub claim. */
    const REAL = {
        channelArn: 'arn:sfu:channel/abc',
        memberId: 'm_1',
        userId: 'u_1',
        ownerClientId: 'p_1::abc::def',
        participantId: 'p_1',
    };

    it('accepts the owner-assignment payload', () => {
        expect(registryWith(sfuMemberOwnerChanged).validate('sfu.member.owner.changed', REAL).valid).toBe(true);
    });

    it('accepts a token with no sub claim — userId is spread in conditionally', () => {
        const { userId: _dropped, ...withoutUserId } = REAL;
        expect(
            registryWith(sfuMemberOwnerChanged).validate('sfu.member.owner.changed', withoutUserId).valid,
        ).toBe(true);
    });

    it('accepts a null ownerClientId — no session store means nobody arbitrated', () => {
        expect(
            registryWith(sfuMemberOwnerChanged)
                .validate('sfu.member.owner.changed', { ...REAL, ownerClientId: null, participantId: null }).valid,
        ).toBe(true);
    });
});

describe('sfu.chat.event — a stream-events frame, not a chat-bus one', () => {
    /** api/channels/chat-events.js:184 verbatim. */
    const REAL = {
        channelArn: 'arn:sfu:channel/abc',
        eventName: 'poll.opened',
        attributes: { pollId: 'poll_1' },
        publishedAt: '2026-09-07T10:00:00.000Z',
    };

    it('accepts the published custom event', () => {
        expect(registryWith(sfuChatEvent).validate('sfu.chat.event', REAL).valid).toBe(true);
    });

    it('accepts the empty attributes the endpoint substitutes when the caller omits them', () => {
        expect(
            registryWith(sfuChatEvent).validate('sfu.chat.event', { ...REAL, attributes: {} }).valid,
        ).toBe(true);
    });

    it('rejects an eventName past the endpoint\'s 64-character limit', () => {
        expect(
            registryWith(sfuChatEvent)
                .validate('sfu.chat.event', { ...REAL, eventName: 'x'.repeat(65) }).valid,
        ).toBe(false);
    });

    it('carries channelArn and names the stream-events bus, unlike the chat-bus frames', () => {
        expect(sfuChatEvent.channel).toBe('stream-events');
        expect(sfuChatEvent.schema.required as string[]).toContain('channelArn');
    });
});

describe('sfu.recording.compose.* — the background job lifecycle', () => {
    const arn = 'arn:sfu:channel/abc';

    /** RecordingManager.js:1668 verbatim. */
    it('queued: accepts the finalize-time enqueue payload', () => {
        expect(
            registryWith(sfuRecordingComposeQueued).validate('sfu.recording.compose.queued', {
                channelArn: arn,
                recordingId: 'rec_1',
                legCount: 3,
                durationMs: 60000,
                recordingStartedAt: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(true);
    });

    it('queued: rejects a zero legCount — the emit is gated on at least one leg', () => {
        expect(
            registryWith(sfuRecordingComposeQueued).validate('sfu.recording.compose.queued', {
                channelArn: arn,
                recordingId: 'rec_1',
                legCount: 0,
                durationMs: 60000,
                recordingStartedAt: '2026-09-07T10:00:00.000Z',
            }).valid,
        ).toBe(false);
    });

    /** RecordingManager.js:3754 verbatim. */
    it('started: accepts the job-open payload', () => {
        expect(
            registryWith(sfuRecordingComposeStarted).validate('sfu.recording.compose.started', {
                channelArn: arn, recordingId: 'rec_1', jobId: 'job_1',
            }).valid,
        ).toBe(true);
    });

    it('started: accepts a direct invocation with no jobId — the producer guards on it', () => {
        expect(
            registryWith(sfuRecordingComposeStarted)
                .validate('sfu.recording.compose.started', { channelArn: arn, recordingId: 'rec_1' }).valid,
        ).toBe(true);
    });

    /** RecordingManager.js:3965 verbatim. */
    it('progress: accepts a bucket crossing', () => {
        expect(
            registryWith(sfuRecordingComposeProgress).validate('sfu.recording.compose.progress', {
                channelArn: arn, recordingId: 'rec_1', jobId: 'job_1', progressPct: 40,
            }).valid,
        ).toBe(true);
    });

    it('progress: rejects 100 — the producer caps at 99 and never reports completion here', () => {
        expect(
            registryWith(sfuRecordingComposeProgress).validate('sfu.recording.compose.progress', {
                channelArn: arn, recordingId: 'rec_1', jobId: 'job_1', progressPct: 100,
            }).valid,
        ).toBe(false);
    });

    /** RecordingManager.js:3897 verbatim — the pre-pass site sets `stage`. */
    it('failed: accepts the windowed pre-pass failure, which has stage and no exitCode', () => {
        expect(
            registryWith(sfuRecordingComposeFailed).validate('sfu.recording.compose.failed', {
                channelArn: arn,
                recordingId: 'rec_1',
                jobId: 'job_1',
                wallMs: 1200,
                stage: 'prepass',
                reason: 'window probe failed',
            }).valid,
        ).toBe(true);
    });

    /** RecordingManager.js:4011 verbatim — the ffmpeg site sets `exitCode`. */
    it('failed: accepts the ffmpeg failure, which has exitCode and no stage', () => {
        expect(
            registryWith(sfuRecordingComposeFailed).validate('sfu.recording.compose.failed', {
                channelArn: arn,
                recordingId: 'rec_1',
                jobId: 'job_1',
                wallMs: 8000,
                exitCode: 1,
                reason: 'ffmpeg exit=1',
            }).valid,
        ).toBe(true);
    });

    it('failed: accepts exitCode -1 — the spawn-error sentinel', () => {
        expect(
            registryWith(sfuRecordingComposeFailed).validate('sfu.recording.compose.failed', {
                channelArn: arn,
                recordingId: 'rec_1',
                jobId: 'job_1',
                wallMs: 5,
                exitCode: -1,
                reason: 'spawn ENOENT',
            }).valid,
        ).toBe(true);
    });

    /** RecordingManager.js:4093 verbatim. */
    const COMPLETED = {
        channelArn: arn,
        recordingId: 'rec_1',
        jobId: 'job_1',
        wallMs: 12000,
        composeStatus: 'ok',
        composedSegment: {
            key: 'arn_abc/rec_1/composed.mp4',
            url: 'https://cdn/arn_abc/rec_1/composed.mp4',
            size: 2048,
            legCount: 2,
            composedAt: '2026-09-07T10:05:00.000Z',
        },
        outputProbedDurationMs: 59980,
    };

    it('completed: accepts the successful compose payload', () => {
        expect(
            registryWith(sfuRecordingComposeCompleted)
                .validate('sfu.recording.compose.completed', COMPLETED).valid,
        ).toBe(true);
    });

    it('completed: accepts the degraded grade and a file:// url from an unwired backend', () => {
        expect(
            registryWith(sfuRecordingComposeCompleted).validate('sfu.recording.compose.completed', {
                ...COMPLETED,
                composeStatus: 'degraded',
                composedSegment: { ...COMPLETED.composedSegment, url: 'file:///var/rec/composed.mp4' },
            }).valid,
        ).toBe(true);
    });

    it('completed: accepts a null probed duration — ffprobe may be absent', () => {
        expect(
            registryWith(sfuRecordingComposeCompleted)
                .validate('sfu.recording.compose.completed', { ...COMPLETED, outputProbedDurationMs: null }).valid,
        ).toBe(true);
    });

    it('completed: never grades `failed` — that is a separate event', () => {
        expect(
            registryWith(sfuRecordingComposeCompleted)
                .validate('sfu.recording.compose.completed', { ...COMPLETED, composeStatus: 'failed' }).valid,
        ).toBe(false);
    });
});
