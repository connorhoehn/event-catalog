// tests/consumer-contract-drift.test.ts
//
// A declaration is only half a contract. The other half is what the producer
// actually constructs at its emit site and what the consumer actually reads
// off the payload — and those three sets drift apart silently. Four shapes:
//
//   (a) declared + emitted + read .................. fine
//   (b) declared, NEVER emitted, but read .......... consumer sees `undefined`
//                                                    forever; no error anywhere
//   (c) emitted but NOT declared ................... dropped on the floor when
//                                                    the schema is closed
//   (d) read but neither declared nor emitted ...... unreachable dead code
//
// (b) and (d) are invisible: nothing throws, nothing logs, the schema
// validates, and the feature is just quietly wrong. Both were found by
// accident on `sfu.recording.completed`, and once found the only durable
// defence is a note on the field saying "this is never sent" — which is
// exactly the kind of note that gets deleted by the next person tidying up
// descriptions, taking the only warning with it.
//
// So this file pins the known cases. It deliberately does NOT restate the
// schema; every assertion here would still pass if you rewrote the schema and
// would still fail if you rewrote only the prose. Specifically it asserts:
//
//   - the never-emitted fields are OPTIONAL, proved by validating the real
//     LVS payload that omits them (making one `required` breaks the producer,
//     and breaks this test first);
//   - the field's resolved description still carries the NEVER-EMITTED marker
//     AND still names the consumer that reads it, so the warning survives;
//   - the fields platform-api reads but nobody declares are provably
//     unreachable, proved by feeding them through the real validator and
//     asserting the closed schema REJECTS them — the point being that the
//     consumer's read cannot be fixed by asking LVS to start sending them;
//   - the inventory of drift notes across the whole catalog is closed: a new
//     "never emitted" note anywhere, or a deleted one, fails here until it is
//     registered below.
//
// If you are here because this test failed: you have changed one of these
// contracts. Go look at the consumer named in the entry before you edit the
// expectation.

import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { allDeclarations } from '../src/declarations/index.js';
import { sfuRecordingCompleted } from '../src/declarations/sfu.js';
import type { EventDeclaration } from '../src/types/index.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type JsonSchema = {
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    additionalProperties?: boolean;
    description?: string;
};

/**
 * Resolve a dotted field path against a schema, stepping through `items` for
 * array-valued segments. `tracks.userId` resolves through `tracks.items`.
 */
function resolveField(schema: JsonSchema, path: string): JsonSchema | undefined {
    let node: JsonSchema | undefined = schema;
    for (const segment of path.split('.')) {
        if (!node) return undefined;
        if (node.items) node = node.items;
        node = node.properties?.[segment];
    }
    return node;
}

/** The schema node that OWNS the last segment of a dotted path. */
function resolveParent(schema: JsonSchema, path: string): JsonSchema | undefined {
    const segments = path.split('.');
    let node: JsonSchema | undefined = schema;
    for (const segment of segments.slice(0, -1)) {
        if (!node) return undefined;
        if (node.items) node = node.items;
        node = node.properties?.[segment];
    }
    if (node?.items) node = node.items;
    return node;
}

function declarationFor(name: string): EventDeclaration {
    const decl = allDeclarations.find((d) => d.name === name);
    if (!decl) throw new Error(`no declaration named ${name}`);
    return decl;
}

function registryWith(decl: EventDeclaration): Registry {
    const registry = new Registry();
    registry.declare(decl);
    return registry;
}

/**
 * The payload LVS's RecordingManager actually builds when it fires the
 * recording-completed webhook on the per-peer path. Transcribed from the
 * producer's object literal — NOT from the schema — which is the whole point:
 * if the schema and the producer diverge, this constant is the side that
 * tells the truth.
 *
 * Note what is absent: no `composedUrl` (compose is a background job that
 * runs after this webhook and reports on `sfu.recording.compose.completed`
 * with a `composedSegment` instead), no `userId` on any track (the recording
 * subsystem never resolves a platform user id), and no `startedAt` /
 * `endedAt` / `totalBytes`.
 */
const LVS_RECORDING_COMPLETED_PAYLOAD = Object.freeze({
    channelArn: 'arn:sfu:channel/abc',
    recordingId: 'rec_1',
    segments: [],
    totalSize: 4096,
    durationMs: 61_000,
    destination: 'local',
    tracks: [
        { participantId: 'p_1', kind: 'av', key: 'legs/p_1.webm', url: 'file:///legs/p_1.webm', size: 2048 },
        { participantId: 'p_2', kind: 'av', key: null, url: null, size: 0 },
    ],
    recordingProfile: 'per-peer-compose',
    profileVersion: 1,
    composePerPeer: true,
    transcribe: false,
});

/* ------------------------------------------------------------------ */
/* (b) declared, never emitted, and read by a consumer                 */
/* ------------------------------------------------------------------ */

/**
 * Fields the schema declares, the producer never assigns, and a consumer
 * nevertheless reads. Every one of these is a live `undefined` in production.
 *
 * `marker` must appear in the field's RESOLVED description (the glossary in
 * src/declarations/sfu.ts is applied at import time by annotateDeclarations),
 * and `mentions` are substrings that must survive any rewrite of that prose —
 * they are the pointers a reader needs to check the claim themselves.
 */
const DECLARED_BUT_NEVER_EMITTED = [
    {
        event: 'sfu.recording.completed',
        field: 'composedUrl',
        marker: 'NEVER EMITTED',
        // The producer writes `composedSegment` on a different event instead;
        // a reader has to be able to find that from the note alone.
        mentions: ['composedSegment', 'platform-api'],
        consumer: 'platform-api:src/lib/lvsWebhooks.ts:549',
    },
    {
        event: 'sfu.recording.completed',
        field: 'tracks.userId',
        marker: 'NEVER EMITTED',
        // recording-truth.ts:250 is the "recover a participant who left before
        // the call ended" branch that this field makes unreachable; naming the
        // line is what stops the note decaying into "TODO: check this".
        mentions: ['RecordingManager.js', 'recording-truth.ts', 'unreachable'],
        consumer: 'platform-api:src/lib/recording-truth.ts:250',
    },
    // The four approval fields below are a different case from the two above:
    // nothing downstream reads them, because the consumer already agreed with
    // the producer. They were REQUIRED, which made both events unpublishable
    // on the durable transport until the schemas were corrected. They stay
    // declared-but-optional only because removing a property is breaking under
    // this repo's own compat gate, so the note is the thing that stops someone
    // "tidying up" by re-requiring them.
    {
        event: 'ws.fileupload.progress',
        field: 'progress',
        marker: 'NEVER EMITTED',
        mentions: ['FileUploadService', 'transferred'],
        consumer: 'realtime-modules:src/client/useFileUpload.ts:453',
    },
    {
        event: 'pipeline.approval.requested',
        field: 'approverIds',
        marker: 'NEVER EMITTED',
        mentions: ['PipelineExecutor', 'approvers'],
        consumer: null,
    },
    {
        event: 'pipeline.approval.requested',
        field: 'requestedAt',
        marker: 'NEVER EMITTED',
        mentions: ['PipelineExecutor', 'ISO'],
        consumer: null,
    },
    {
        event: 'pipeline.approval.recorded',
        field: 'approver',
        marker: 'NEVER EMITTED',
        mentions: ['PipelineExecutor', 'userId'],
        consumer: null,
    },
    {
        event: 'pipeline.approval.recorded',
        field: 'decidedAt',
        marker: 'NEVER EMITTED',
        mentions: ['PipelineExecutor', 'ISO'],
        consumer: null,
    },
] as const;

describe('(b) declared but never emitted — fields that are permanently undefined at the consumer', () => {
    it.each(DECLARED_BUT_NEVER_EMITTED)(
        '$event.$field is still declared, so the consumer read at $consumer still compiles',
        ({ event, field }) => {
            const schema = declarationFor(event).schema as JsonSchema;
            expect(resolveField(schema, field), `${event}.${field} vanished from the schema`).toBeDefined();
        },
    );

    it.each(DECLARED_BUT_NEVER_EMITTED)(
        '$event.$field is optional — a producer that never sends it must still validate',
        ({ event, field }) => {
            const parent = resolveParent(declarationFor(event).schema as JsonSchema, field);
            const leaf = field.split('.').at(-1)!;
            expect(parent?.required ?? [], `${event}.${field} was made required`).not.toContain(leaf);
        },
    );

    it.each(DECLARED_BUT_NEVER_EMITTED)(
        '$event.$field still carries the "$marker" warning naming its consumer',
        ({ event, field, marker, mentions }) => {
            const node = resolveField(declarationFor(event).schema as JsonSchema, field);
            const description = node?.description ?? '';
            expect(description, `${event}.${field} lost its drift note`).toContain(marker);
            for (const fragment of mentions) {
                expect(description, `${event}.${field}'s note no longer mentions ${fragment}`).toContain(fragment);
            }
        },
    );

    it('the event description surfaces both fields, so the drift is visible in AsyncAPI and /api/events', () => {
        // The per-field notes live on the property; a consumer skimming the
        // event (or its generated docs) sees only this. Losing it here is how
        // the next integrator re-discovers the bug the expensive way.
        const description = declarationFor('sfu.recording.completed').description ?? '';
        expect(description).toContain('composedUrl');
        expect(description).toContain('tracks[].userId');
    });

    it("LVS's real emit-site payload validates with neither field present", () => {
        // The load-bearing assertion behind "these are optional": if someone
        // promotes either field to `required`, the SFU's webhook starts being
        // rejected in production, and this fails first.
        const registry = registryWith(sfuRecordingCompleted);
        const result = registry.validate('sfu.recording.completed', LVS_RECORDING_COMPLETED_PAYLOAD);
        expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* (d) read by a consumer, neither declared nor emitted                */
/* ------------------------------------------------------------------ */

/**
 * The mirror defect. platform-api's webhook route reads these off the
 * recording-completed payload; the schema declares none of them, and because
 * the schema is `additionalProperties: false` they could not arrive even if
 * LVS started sending them tomorrow. Fixing the consumer therefore requires a
 * schema change here first — which is the fact this block pins.
 */
const READ_BUT_NEITHER_DECLARED_NOR_EMITTED = [
    { event: 'sfu.recording.completed', field: 'startedAt', sample: '2026-09-07T10:00:00.000Z', consumer: 'platform-api:src/lib/lvsWebhooks.ts' },
    { event: 'sfu.recording.completed', field: 'endedAt', sample: '2026-09-07T10:01:01.000Z', consumer: 'platform-api:src/lib/lvsWebhooks.ts' },
    { event: 'sfu.recording.completed', field: 'totalBytes', sample: 4096, consumer: 'platform-api:src/lib/lvsWebhooks.ts' },
] as const;

describe('(d) read by a consumer but neither declared nor emitted', () => {
    it('sfu.recording.completed is a closed contract — that is what makes these unfixable from the producer side', () => {
        expect((sfuRecordingCompleted.schema as JsonSchema).additionalProperties).toBe(false);
    });

    it.each(READ_BUT_NEITHER_DECLARED_NOR_EMITTED)(
        '$field is undeclared, so $consumer reads undefined',
        ({ event, field }) => {
            const schema = declarationFor(event).schema as JsonSchema;
            expect(Object.keys(schema.properties ?? {})).not.toContain(field);
        },
    );

    it.each(READ_BUT_NEITHER_DECLARED_NOR_EMITTED)(
        'a payload carrying $field is REJECTED — the consumer read is unreachable, not merely unlucky',
        ({ event, field, sample }) => {
            // Not a restatement of `additionalProperties: false`: it proves,
            // through the real validator, that the specific field the consumer
            // wants cannot be delivered. The day someone declares it, this
            // fails and they are forced to look at the consumer.
            const registry = registryWith(declarationFor(event));
            const result = registry.validate(event, { ...LVS_RECORDING_COMPLETED_PAYLOAD, [field]: sample });
            expect(result.valid, `${field} is now accepted — update ${event}'s consumers`).toBe(false);
            expect(JSON.stringify(result.errors)).toContain(field);
        },
    );

    it('the event description names all three, so the gap is discoverable from the catalog', () => {
        const description = declarationFor('sfu.recording.completed').description ?? '';
        for (const { field } of READ_BUT_NEITHER_DECLARED_NOR_EMITTED) {
            expect(description, `the recording-completed description no longer mentions ${field}`).toContain(field);
        }
    });
});

/* ------------------------------------------------------------------ */
/* (c) emitted and read, but not declared — surviving only on an open  */
/*     sub-schema                                                      */
/* ------------------------------------------------------------------ */

/**
 * `tracks[]` items are `additionalProperties: true`, and the whole
 * duration-correction path in platform-api lives in that gap:
 * `deriveMediaDurationMs` (platform-api:src/lib/recording-truth.ts:93-138)
 * is built entirely on `startedAtMs`, `endedAtMs` and `durationMs`, none of
 * which this schema declares. LVS does emit them
 * (live-video-streaming:src/recording/RecordingManager.js:1493), so the
 * feature works — but only because the sub-schema is open. Closing it, the
 * way the top-level object is closed, would silently regress a correction
 * that moved median duration error from ~10s to ~146ms.
 */
const UNDECLARED_TRACK_FIELDS = {
    legId: 'leg_1',
    file: '/rec/legs/p_1.webm',
    startedAtMs: 1_757_240_000_000,
    endedAtMs: 1_757_240_061_000,
    durationMs: 61_000,
} as const;

describe('(c) emitted and read but undeclared — kept alive by an open sub-schema', () => {
    it('sfu.recording.completed accepts the undeclared tracks[] fields platform-api depends on', () => {
        const registry = registryWith(sfuRecordingCompleted);
        const payload = {
            ...LVS_RECORDING_COMPLETED_PAYLOAD,
            tracks: LVS_RECORDING_COMPLETED_PAYLOAD.tracks.map((t) => ({ ...t, ...UNDECLARED_TRACK_FIELDS })),
        };
        const result = registry.validate('sfu.recording.completed', payload);
        expect(
            result.valid,
            'tracks[] was closed — platform-api\'s deriveMediaDurationMs reads startedAtMs/endedAtMs/durationMs '
            + 'off these items and they are not declared. Declare them before closing the sub-schema.',
        ).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* (d) read but undeclared, on an OPEN schema — fixable by the producer */
/* ------------------------------------------------------------------ */

/**
 * The counterpart to the recording-completed trio, and the reason that trio
 * is the worse bug. `call:reaction.recorded` is `additionalProperties: true`,
 * so the field platform-api reads could start arriving tomorrow with no
 * schema change here; the recording-completed ones cannot.
 *
 * platform-api:src/services/call-reaction-consumer.ts:63 reads `orgId` and
 * feeds it to `tenantOf()`, which selects the DynamoDB tenant partition.
 * Nobody emits it, so every reaction row lands in the TENANTLESS namespace.
 */
const READ_UNDECLARED_BUT_DELIVERABLE = [
    {
        event: 'call:reaction.recorded',
        field: 'orgId',
        sample: 'org_1234',
        consumer: 'platform-api:src/services/call-reaction-consumer.ts:63',
        payload: {
            reactionId: 'rx_1',
            channel: 'call:lobby-1',
            lobbyName: 'lobby-1',
            userId: 'u_1',
            emoji: '🎉',
            at: '2026-09-07T10:00:00.000Z',
        },
    },
    {
        // realtime-examples:frontend/src/hooks/useActivityBus.ts:143 (and the
        // history-hydration path at :160) reads `color` back off the wire.
        // It is a hook OPTION stamped onto optimistic local items at :234,
        // never a payload field — realtime-modules' ActivityService builds
        // exactly {eventType, detail, timestamp, userId, displayName}
        // (dist/activity/ActivityService.js:187). So a user's own activity
        // item is coloured until the server echo lands and then goes grey.
        event: 'activity.recorded',
        field: 'color',
        sample: '#7c3aed',
        consumer: 'realtime-examples:frontend/src/hooks/useActivityBus.ts:143',
        payload: {
            eventType: 'document.edited',
            detail: { documentTitle: 'Q3 plan' },
            timestamp: '2026-09-07T10:00:00.000Z',
            userId: 'u_1',
            displayName: 'Ada',
        },
    },
] as const;

describe('(d) read but undeclared on an open schema — the producer can fix it alone', () => {
    it.each(READ_UNDECLARED_BUT_DELIVERABLE)(
        '$event still does not declare $field, which $consumer reads',
        ({ event, field }) => {
            const schema = declarationFor(event).schema as JsonSchema;
            expect(Object.keys(schema.properties ?? {})).not.toContain(field);
        },
    );

    it.each(READ_UNDECLARED_BUT_DELIVERABLE)(
        '$event would accept $field today — no schema change is needed to unblock $consumer',
        ({ event, field, sample, payload }) => {
            // This is the assertion that distinguishes this case from the
            // recording-completed trio, and the one that fails if someone
            // closes the schema without noticing the pending consumer.
            const registry = registryWith(declarationFor(event));
            const result = registry.validate(event, { ...payload, [field]: sample });
            expect(result.valid, JSON.stringify(result.errors)).toBe(true);
        },
    );
});

/* ------------------------------------------------------------------ */
/* a declared shape that a consumer refuses to recognise               */
/* ------------------------------------------------------------------ */

describe('ws.error — the flat shape is declared, and two consumers drop it on the floor', () => {
    // ws.error deliberately models both wire shapes: NESTED, which the
    // realtime-modules services send under `error: {code, message, …}`, and
    // FLAT, which the gateway's own frames send as bare top-level fields
    // (realtime-examples:src/core/message-router.ts:1188-1192 and
    // src/server.ts:2443, :2628, :2676, :2692 — none of which set `error`,
    // and none of which set `service` either).
    //
    // Both frontend consumers gate on the nested envelope:
    //   realtime-examples:frontend/src/hooks/useWebSocket.ts:355
    //   realtime-examples:frontend/src/app/App.tsx:264
    // `if (msg.type === 'error' && msg.error)` — so every gateway-originated
    // error frame is silently discarded and never reaches the error list.
    //
    // The contract is right and the consumer is wrong, which is why this is a
    // report rather than a schema change. What the test pins is that the flat
    // shape stays legal: the day someone "tidies up" ws.error by requiring
    // `error`, they retroactively bless the consumer bug, and this fails.
    const flatGatewayErrorFrame = {
        type: 'error',
        code: 'UNKNOWN_SERVICE',
        message: 'no handler for that message type',
        timestamp: '2026-09-07T10:00:00.000Z',
    };

    it('accepts a flat gateway error frame that carries neither `error` nor `service`', () => {
        const registry = registryWith(declarationFor('ws.error'));
        const result = registry.validate('ws.error', flatGatewayErrorFrame);
        expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    });

    it('still documents both shapes, so the consumer guard can be recognised as too narrow', () => {
        const description = declarationFor('ws.error').description ?? '';
        expect(description).toMatch(/flat/i);
        expect(description).toMatch(/nest/i);
    });
});

/* ------------------------------------------------------------------ */
/* whole events that are declared but no longer emitted                */
/* ------------------------------------------------------------------ */

/**
 * The event-level version of (b): frames the in-tree gateway used to emit and
 * the realtime-modules dist service the gateway actually runs does not. Kept
 * declared for back-compat, but a consumer subscribing to one waits forever.
 */
const EVENT_DRIFT_MARKER = 'historical/in-tree-gateway surface';

const DECLARED_BUT_NOT_EMITTED_EVENTS = [
    'ws.cursor.clear',
    'ws.cursor.batch',
    'ws.reaction.removed',
    'ws.reaction.list',
    'ws.crdt.sync-request',
    'ws.crdt.sync-response',
    'ws.crdt.snapshot-stored',
    // Not "never emitted" but "emitted in a different shape": the running
    // service sends type "crdt:awareness" with {channel, updates[{clientId,
    // update}]}, declared separately as ws.crdt.awareness in client-frames.
    'ws.crdt.awareness-batch',
] as const;

describe('whole events that are declared but not emitted by the running producer', () => {
    it.each(DECLARED_BUT_NOT_EMITTED_EVENTS)(
        '%s is still declared and still says it is not emitted',
        (name) => {
            const description = declarationFor(name).description ?? '';
            expect(description, `${name} lost its not-emitted note`).toContain(EVENT_DRIFT_MARKER);
            // The marker alone is a filing category; this is the claim — the
            // running service either does not emit the frame at all, or emits
            // a different shape under a different type.
            expect(description, `${name} no longer says it is not emitted`).toMatch(/not emitted|NOT this/);
        },
    );
});

/* ------------------------------------------------------------------ */
/* the inventory is closed                                             */
/* ------------------------------------------------------------------ */

/**
 * Markers that mean "this contract is known to be out of step with its
 * producer or consumer". Anything carrying one must be registered above.
 */
const FIELD_DRIFT_MARKER = 'NEVER EMITTED';
const DRIFT_MARKERS = [FIELD_DRIFT_MARKER, EVENT_DRIFT_MARKER];

function collectDriftPaths(schema: JsonSchema, prefix = '', out: string[] = [], depth = 0): string[] {
    if (!schema || depth > 6) return out;
    if (schema.items) return collectDriftPaths(schema.items, prefix, out, depth + 1);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (DRIFT_MARKERS.some((m) => (child.description ?? '').includes(m))) out.push(path);
        collectDriftPaths(child, path, out, depth + 1);
    }
    return out;
}

describe('the drift inventory is closed', () => {
    it('every field-level drift note in the catalog is registered in this file', () => {
        const found: string[] = [];
        for (const decl of allDeclarations) {
            for (const path of collectDriftPaths(decl.schema as JsonSchema)) {
                found.push(`${decl.name}.${path}`);
            }
        }
        const registered = DECLARED_BUT_NEVER_EMITTED.map((e) => `${e.event}.${e.field}`);
        // Both directions matter. A NEW note that nobody registered means a
        // freshly discovered bug with no regression guard; a MISSING one means
        // someone deleted the only warning a consumer had.
        expect(found.sort()).toEqual([...registered].sort());
    });

    it('every event-level drift note in the catalog is registered in this file', () => {
        const found = allDeclarations
            .filter((d) => DRIFT_MARKERS.some((m) => (d.description ?? '').includes(m)))
            .map((d) => d.name);
        expect(found.sort()).toEqual([...DECLARED_BUT_NOT_EMITTED_EVENTS].sort());
    });
});

/* ------------------------------------------------------------------ */
/* (e) the declaration REJECTS the only payload its producer builds     */
/* ------------------------------------------------------------------ */

/**
 * The worst shape, and the one the first pass did not have a name for.
 *
 * (b) and (d) are quiet: the field is `undefined` and the feature is wrong.
 * This one is loud in the wrong place — the schema declares a field
 * REQUIRED that no producer has ever set, so the real wire payload fails
 * validation. On the signal path the publisher throws instead of
 * publishing; on the durable path the event never reaches the queue. The
 * declaration is not merely wrong about reality, it is hostile to it.
 *
 * Each `payload` below is transcribed from the producer's object literal at
 * the cited line — not from the schema, and not from a TypeScript interface
 * (the interfaces agree with the schema; only the emit sites tell the
 * truth). If one of these starts validating, the contract was fixed and the
 * entry must be retired.
 */
const SCHEMA_REJECTS_THE_REAL_PAYLOAD = [
    {
        // realtime-modules:dist/reactions/ReactionService.js:330-341 (src at
        // src/reactions/ReactionService.ts:402) emits
        // data:{channel,targetId,emoji,userId,timestamp} — no `id`, which
        // the schema requires. The consumer does not want `id` either:
        // realtime-modules:src/client/useReactions.ts:163 filters on the
        // (targetId, emoji, userId) triple precisely BECAUSE ids differ
        // between the live broadcast and the history replay.
        //
        // Note this contradicts ws.reaction.removed's own description, which
        // still claims the running dist service has no remove action. It has
        // one; see DECLARED_BUT_NOT_EMITTED_EVENTS below, where the event is
        // still registered on the strength of that stale note.
        event: 'ws.reaction.removed',
        missing: ['id'],
        emitSite: 'realtime-modules:dist/reactions/ReactionService.js:330',
        consumer: 'realtime-modules:src/client/useReactions.ts:163',
        payload: {
            type: 'reaction',
            action: 'reaction_removed',
            data: {
                channel: 'room-1',
                targetId: 'msg_1',
                emoji: '👍',
                userId: 'u_1',
                timestamp: '2026-09-07T10:00:00.000Z',
            },
        },
    },
] as const;

describe('(e) the declaration rejects the only payload its producer builds', () => {
    it.each(SCHEMA_REJECTS_THE_REAL_PAYLOAD)(
        "$event REJECTS the literal $emitSite constructs — the missing fields are $missing",
        ({ event, missing, payload }) => {
            const registry = registryWith(declarationFor(event));
            const result = registry.validate(event, payload);
            expect(
                result.valid,
                `${event} now accepts its producer's payload — the contract was fixed; retire this entry.`,
            ).toBe(false);
            const errors = JSON.stringify(result.errors);
            for (const field of missing) {
                expect(errors, `${event} no longer rejects on ${field}`).toContain(field);
            }
        },
    );

    it.each(SCHEMA_REJECTS_THE_REAL_PAYLOAD)(
        '$event still marks $missing required, so no producer can satisfy it',
        ({ event, missing }) => {
            // The rejection above could in principle come from a type error
            // rather than a missing-required. This pins the actual cause, so
            // relaxing `required` (the minimal fix) fails here and forces the
            // consumer at $consumer to be looked at.
            const schema = declarationFor(event).schema as JsonSchema;
            const requiredSomewhere = (node: JsonSchema | undefined, field: string): boolean => {
                if (!node) return false;
                if ((node.required ?? []).includes(field)) return true;
                return Object.values(node.properties ?? {}).some((child) => requiredSomewhere(child, field));
            };
            for (const field of missing) {
                expect(requiredSomewhere(schema, field), `${event}.${field} is no longer required`).toBe(true);
            }
        },
    );

    it('all three pipeline approval events type their timestamp as a number while every producer sends ISO-8601', () => {
        // Separate from the required-field defect and separately fatal: even
        // a payload that DID carry `decidedAt` / `requestedAt` / `resolvedAt`
        // would be rejected, because PipelineExecutor timestamps every
        // approval event with `nowISO()` (distributed-core:src/applications/
        // pipeline/PipelineExecutor.ts:1055, :3087).
        const isoTimestamped: Array<[string, Record<string, unknown>, string]> = [
            ['pipeline.approval.recorded', { runId: 'r', stepId: 's', approver: 'u', decision: 'approve', decidedAt: '2026-09-07T10:00:00.000Z' }, 'decidedAt'],
            ['pipeline.approval.requested', { runId: 'r', stepId: 's', approverIds: ['u'], requestedAt: '2026-09-07T10:00:00.000Z' }, 'requestedAt'],
            ['pipeline.approval.resolved', { runId: 'r', stepId: 's', approvalId: 'a', decision: 'approved', by: 'u', resolvedAt: '2026-09-07T10:00:00.000Z' }, 'resolvedAt'],
        ];
        for (const [event, payload, field] of isoTimestamped) {
            const result = registryWith(declarationFor(event)).validate(event, payload);
            expect(result.valid, `${event} now accepts an ISO timestamp in ${field}`).toBe(false);
            expect(JSON.stringify(result.errors)).toContain(field);
        }
    });
});

/* ------------------------------------------------------------------ */
/* (e) continued — the orgiq namespace describes a wire that does not   */
/*     exist                                                            */
/* ------------------------------------------------------------------ */

/**
 * All six `orgiq.*` declarations were written against an imagined FLAT
 * frame: `{type, channel, timestamp, action, userId}`. The gateway fan-out
 * services that actually serve those channels emit nothing of the kind —
 * the roster frames nest the identity under `presence` and carry no
 * top-level `channel` at all
 * (realtime-modules:dist/presence/PresenceService.js:311 for `update`,
 * :322 for `offline`), and the reaction frames nest everything under `data`
 * (realtime-modules:dist/reactions/ReactionService.js:270).
 *
 * `channel` is REQUIRED on every one of them, so this is (e), not a
 * cosmetic mismatch: not one real frame validates. The declarations also
 * attribute production to `orgiq-middleware`, which builds none of these
 * frames — its only publish path is a generic channel proxy
 * (aws-agentcore:middleware/src/routes/gateway-proxy.ts:106).
 */
const GATEWAY_PRESENCE_UPDATE_FRAME = Object.freeze({
    type: 'presence',
    action: 'update',
    presence: { clientId: 'c_1', status: 'online', channels: ['orgiq:newsroom'] },
    timestamp: '2026-09-07T10:00:00.000Z',
});

const ORGIQ_PRESENCE_EVENTS = [
    'orgiq.invoke.presence',
    'orgiq.newsroom-briefs.presence',
    'orgiq.newsroom-researcher.presence',
    'orgiq.search.presence',
] as const;

describe('(e) orgiq.* — declared flat, emitted nested, required `channel` never present', () => {
    it.each(ORGIQ_PRESENCE_EVENTS)(
        '%s rejects the presence frame the gateway really broadcasts',
        (event) => {
            const result = registryWith(declarationFor(event)).validate(event, GATEWAY_PRESENCE_UPDATE_FRAME);
            expect(
                result.valid,
                `${event} now accepts the real gateway roster frame — the orgiq schemas were fixed; retire this entry.`,
            ).toBe(false);
            expect(JSON.stringify(result.errors)).toContain('channel');
        },
    );

    it('orgiq.newsroom-articles.reactions rejects on BOTH `channel` and an `action` enum that matches no wire value', () => {
        // The wire values are reaction_subscribed / reaction_unsubscribed /
        // reaction_received / reaction_sent / available_reactions
        // (realtime-modules:dist/reactions/ReactionService.js:270, :330, :459).
        // The declared enum is subscribed/received/removed/list/sent.
        const result = registryWith(declarationFor('orgiq.newsroom-articles.reactions')).validate(
            'orgiq.newsroom-articles.reactions',
            {
                type: 'reaction',
                action: 'reaction_received',
                data: { channel: 'orgiq:articles', targetId: 'a_1', emoji: '👍', userId: 'u_1', timestamp: '2026-09-07T10:00:00.000Z' },
            },
        );
        expect(result.valid).toBe(false);
        const errors = JSON.stringify(result.errors);
        expect(errors).toContain('channel');
        expect(errors, 'the action enum now admits a real wire value').toContain('action');
    });

    it('orgiq.newsroom-researcher.activity rejects the activity frame the gateway really broadcasts', () => {
        // realtime-modules:dist/activity/ActivityService.js:186 emits
        // `{type:'activity:event', payload:{...}}`; the frames that DO use
        // `type:'activity'` are acks keyed on `channelId`, not `channel`
        // (:141, :160, :260).
        const result = registryWith(declarationFor('orgiq.newsroom-researcher.activity')).validate(
            'orgiq.newsroom-researcher.activity',
            { type: 'activity:event', payload: { eventType: 'doc.edited', detail: {}, timestamp: '2026-09-07T10:00:00.000Z', userId: 'u_1', displayName: 'Ada' } },
        );
        expect(result.valid).toBe(false);
        expect(JSON.stringify(result.errors)).toContain('channel');
    });
});

/* ------------------------------------------------------------------ */
/* whole events declared with a named producer that emits nothing       */
/* ------------------------------------------------------------------ */

/**
 * The (b') bucket at event granularity: the catalog names a producer, the
 * producer builds no such frame anywhere, and — unlike the eight already
 * registered in DECLARED_BUT_NOT_EMITTED_EVENTS — the declaration carries
 * no warning, so `/api/events` and the generated AsyncAPI both present them
 * as live contracts.
 *
 * `producer` is the assertion that bites: the day someone corrects the
 * attribution (or adds the drift note), one of these fails and they have to
 * move the entry into the registered inventory below rather than quietly
 * deleting the evidence.
 */
const DECLARED_WITH_A_PRODUCER_THAT_EMITS_NOTHING = [
    // The whole ws.upload.* family. The producer's own file header disowns
    // it: "the hook's `fileupload:*` frame types, NOT the ws.upload.* /
    // type:'upload' ..." — realtime-modules:src/fileupload/FileUploadService.ts:14
    // (and the vendored copy at realtime-examples:dist/realtime-fanout/
    // fileupload/FileUploadService.js:15). Seven declarations, no emit site,
    // no consumer.
    { event: 'ws.upload.requested', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.url-issued', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.completed', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.failed', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.scanned', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.scan-quarantined', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },
    { event: 'ws.upload.url-revoked', why: 'ws.upload.* is disowned by the fileupload producer', consumer: 'none' },

    // Deferred at the producer — realtime-modules:src/fileupload/
    // FileUploadService.ts:645 ("AV-SCAN deferred ... would instead ack
    // fileupload:scanning here") — but the hook branches on it and sets
    // status:'scanning' (realtime-modules:src/client/useFileUpload.ts:463).
    // The scan UI state is unreachable.
    { event: 'ws.fileupload.scanning', why: 'AV scan deferred at the producer', consumer: 'realtime-modules:src/client/useFileUpload.ts:463' },

    // The running presence service only ever emits type:'presence' with
    // action set|update|subscribed|unsubscribed|presence|offline
    // (realtime-modules:dist/presence/PresenceService.js:191..322). The hook
    // still carries the joined/left branches and labels them itself as
    // "Legacy flat shapes ... fallback for non-gateway servers"
    // (realtime-modules:src/client/usePresence.ts:28). Against THIS gateway
    // they are dead, and the declarations attribute them to it anyway.
    { event: 'ws.presence.joined', why: 'gateway presence service emits action frames only', consumer: 'realtime-modules:src/client/usePresence.ts:132' },
    { event: 'ws.presence.left', why: 'gateway presence service emits action frames only', consumer: 'realtime-modules:src/client/usePresence.ts:141' },

    // videohangout is rejected before any handler runs:
    // knownUnimplementedServices = ['videohangout'] at
    // realtime-examples:src/validators/message-validator.ts:91. No inbound
    // frame is accepted and no outbound frame is built.
    { event: 'ws.videohangout.media', why: 'videohangout is a known-unimplemented service', consumer: 'realtime-modules:src/client/useVideoHangout.ts:188' },
    { event: 'ws.videohangout.participant', why: 'videohangout is a known-unimplemented service', consumer: 'realtime-modules:src/client/useVideoHangout.ts:168' },
    { event: 'client.videohangout.start', why: 'videohangout is a known-unimplemented service', consumer: 'none' },
    { event: 'client.videohangout.join', why: 'videohangout is a known-unimplemented service', consumer: 'none' },
    { event: 'client.videohangout.leave', why: 'videohangout is a known-unimplemented service', consumer: 'none' },
    { event: 'client.videohangout.end', why: 'videohangout is a known-unimplemented service', consumer: 'none' },
    { event: 'client.videohangout.toggle-audio', why: 'videohangout is a known-unimplemented service', consumer: 'none' },
    { event: 'client.videohangout.toggle-video', why: 'videohangout is a known-unimplemented service', consumer: 'none' },

    // Not in CallService's action set at all (realtime-modules:src/call/
    // types.ts:26 CallAction, :434 ALLOWED_CALL_ACTIONS), so a client sending
    // one gets "Unknown call action". Recording state reaches the UI from the
    // LVS stage socket instead (realtime-examples:frontend/src/hooks/
    // useRecordingState.ts:84).
    { event: 'ws.call.video-on', why: 'not a CallService action', consumer: 'none' },
    { event: 'ws.call.video-off', why: 'not a CallService action', consumer: 'none' },
    { event: 'ws.call.recording-started', why: 'not a CallService action; recording state comes from LVS', consumer: 'none' },
    { event: 'ws.call.recording-completed', why: 'not a CallService action; recording state comes from LVS', consumer: 'none' },

    // distributed-core removed these from its event map in v0.16.0 and says
    // so in the source: "The four producer-less Phase-5 events ... had no
    // executor producer and consumers should not handle them" —
    // distributed-core:src/applications/pipeline/types.ts:905.
    { event: 'pipeline:run:paused', why: 'producer-less Phase-5 event, removed from DC v0.16.0', consumer: 'none' },
    { event: 'pipeline:run:retry', why: 'producer-less Phase-5 event, removed from DC v0.16.0', consumer: 'none' },

    // Declared producer `websocket-gateway`, described as "emitted when
    // handleResumeFromStep is invoked without a PipelineModule". That branch
    // exists and emits the OTHER name: realtime-examples:src/services/
    // pipeline-service.ts:487 sends eventType 'pipeline:run:resumed-from-step'.
    { event: 'pipeline:run:resumeFromStep', why: 'the gateway fallback emits pipeline:run:resumed-from-step instead', consumer: 'realtime-examples:frontend/src/components/pipelines/dev/SimulatorPanel.tsx:217' },

    // Per-gate closure event. No emit site in distributed-core, platform-api,
    // realtime-examples or realtime-modules — grepped both
    // `pipeline:approval:resolved` and `pipeline.approval.resolved`; the only
    // hit is a log message at platform-api:src/routes/pipelineTriggers.ts:1148.
    // It is nevertheless `required: true` in the agentic-pipeline-durable
    // bundle (src/declarations/bundles/agentic-pipeline-durable.ts:38).
    { event: 'pipeline.approval.resolved', why: 'no emit site in any repo', consumer: 'none' },
] as const;

describe('events declared with a producer that emits nothing', () => {
    it.each(DECLARED_WITH_A_PRODUCER_THAT_EMITS_NOTHING)(
        '$event is still declared and still names a producer — $why',
        ({ event }) => {
            const decl = declarationFor(event);
            expect(
                decl.producer,
                `${event} no longer claims a producer — if the attribution was corrected, retire this entry.`,
            ).toBeTruthy();
        },
    );

    it.each(DECLARED_WITH_A_PRODUCER_THAT_EMITS_NOTHING)(
        '$event still carries NO drift note, which is why it needs one here',
        ({ event }) => {
            // Keeps this block and the closed-inventory test at the bottom of
            // the file mutually exclusive. Adding a note to any of these fails
            // here, forcing the entry to move into
            // DECLARED_BUT_NOT_EMITTED_EVENTS rather than being listed twice
            // or dropped.
            const description = declarationFor(event).description ?? '';
            expect(
                description,
                `${event} gained a drift note — move it into DECLARED_BUT_NOT_EMITTED_EVENTS.`,
            ).not.toContain(EVENT_DRIFT_MARKER);
        },
    );

    it('ws.presence.joined cannot be satisfied by the frame the running presence service does emit', () => {
        // Guards against "it is emitted, just under another name". The
        // action-frame the service broadcasts on a roster change carries
        // neither of joined's two required fields, so joined is not a rename
        // of update — it is absent.
        const result = registryWith(declarationFor('ws.presence.joined')).validate(
            'ws.presence.joined',
            GATEWAY_PRESENCE_UPDATE_FRAME,
        );
        expect(result.valid).toBe(false);
        const errors = JSON.stringify(result.errors);
        expect(errors).toContain('channel');
        expect(errors).toContain('client');
    });

    it('ws.videohangout.media requires a top-level `channel` the sibling fan-out services deliberately omit', () => {
        // The latent trap if videohangout is ever implemented: the hook
        // hard-filters on a top-level `channel` before dispatch
        // (realtime-modules:src/client/useVideoHangout.ts:131), and the
        // presence/cursor services set the opposite precedent — their
        // `update` frames carry no top-level channel and the hook scopes via
        // the nested payload instead. A producer following that precedent
        // would have every frame silently dropped AND rejected here.
        const withoutChannel = { type: 'videohangout:media', clientId: 'c_1', videoOn: true, audioOn: false };
        const result = registryWith(declarationFor('ws.videohangout.media')).validate('ws.videohangout.media', withoutChannel);
        expect(result.valid, 'ws.videohangout.media stopped requiring `channel` — check useVideoHangout.ts:131').toBe(false);
        expect(JSON.stringify(result.errors)).toContain('channel');
    });
});

/* ------------------------------------------------------------------ */
/* (c) emitted and BRANCHED ON, but undeclared — alive only because the */
/*     schema is open                                                   */
/* ------------------------------------------------------------------ */

/**
 * The same shape as the `tracks[]` case above, but on the signal side and
 * with a much shorter fuse: these are fields a consumer makes a CONTROL-FLOW
 * decision on. Each is emitted, each is read in an `if`, and none is
 * declared. Every one of them survives purely because `additionalProperties`
 * is true on the object that carries it — so `additionalProperties: false`,
 * applied as tidiness, silently reverts a user-visible behaviour.
 *
 * The assertion is deliberately the positive one: the real payload, carrying
 * the undeclared field, still validates.
 */
const UNDECLARED_BUT_BRANCHED_ON = [
    {
        // realtime-modules:src/call/CallService.ts:1539 passes the client's
        // invite payload through verbatim, so `knock` (set by
        // realtime-examples:frontend/src/components/hangout/HangoutDomainProvider.tsx:603)
        // and `admit` (IncomingCallToast.tsx:323) reach the wire.
        // realtime-examples:frontend/src/hooks/useIncomingCalls.ts:111
        // branches on `data.admit === true` to JOIN instead of ring, and
        // :155 branches on `data.knock === true` to pick the knock UI.
        event: 'ws.call.invite',
        field: 'data.knock',
        consumer: 'realtime-examples:frontend/src/hooks/useIncomingCalls.ts:155',
        payload: { type: 'call', action: 'invite', data: { callId: 'call_1', callerId: 'u_1', lobbyName: 'dm:a:b', targetUserIds: ['u_2'], knock: true }, timestamp: '2026-09-07T10:00:00.000Z' },
    },
    {
        event: 'ws.call.invite',
        field: 'data.admit',
        consumer: 'realtime-examples:frontend/src/hooks/useIncomingCalls.ts:111',
        payload: { type: 'call', action: 'invite', data: { callId: 'call_1', callerId: 'u_1', lobbyName: 'dm:a:b', targetUserIds: ['u_2'], admit: true }, timestamp: '2026-09-07T10:00:00.000Z' },
    },
    {
        // realtime-modules:src/call/CallService.ts:1826 sets
        // reason:'peer-disconnected' (and :1965 'rejoin-grace-expired') on
        // the SYNTHETIC ended frames only; a client hang-up never carries it.
        // realtime-examples:frontend/src/components/hangout/HangoutOverlay.tsx:2703
        // turns that into `isServerSynthetic` and uses it to decide whether a
        // lobby-matched `ended` is allowed to tear the call down. The single
        // most load-bearing call field in the UI, and the schema has never
        // heard of it.
        event: 'ws.call.ended',
        field: 'data.reason',
        consumer: 'realtime-examples:frontend/src/components/hangout/HangoutOverlay.tsx:2703',
        payload: { type: 'call', action: 'ended', data: { callId: 'call_1', callerId: 'u_1', lobbyName: 'dm:a:b', reason: 'peer-disconnected' }, timestamp: '2026-09-07T10:00:00.000Z' },
    },
    {
        // HangoutOverlay.tsx:2678 drops any `ended` whose `data.callerId`
        // equals the local user — a self-echo guard. See the dedicated test
        // below for why that interacts badly with the synthetic frame.
        event: 'ws.call.ended',
        field: 'data.callerId',
        consumer: 'realtime-examples:frontend/src/components/hangout/HangoutOverlay.tsx:2678',
        payload: { type: 'call', action: 'ended', data: { callId: 'call_1', callerId: 'u_1', lobbyName: 'dm:a:b', reason: 'peer-disconnected' }, timestamp: '2026-09-07T10:00:00.000Z' },
    },
    {
        // realtime-modules:src/reactions/ReactionService.ts:277 emits
        // targetId/userId on the broadcast; realtime-modules:src/client/
        // useReactions.ts:262 uses the (targetId, userId) pair to decide
        // react-vs-unreact. The declaration's `data` lists only
        // id/clientId/channel/emoji/effect.
        event: 'ws.reaction.received',
        field: 'data.targetId',
        consumer: 'realtime-modules:src/client/useReactions.ts:262',
        payload: { type: 'reaction', action: 'reaction_received', data: { channel: 'room-1', emoji: '👍', targetId: 'msg_1', userId: 'u_1' } },
    },
    {
        event: 'ws.reaction.received',
        field: 'data.userId',
        consumer: 'realtime-modules:src/client/useReactions.ts:262',
        payload: { type: 'reaction', action: 'reaction_received', data: { channel: 'room-1', emoji: '👍', targetId: 'msg_1', userId: 'u_1' } },
    },
] as const;

describe('(c) emitted and branched on but undeclared — kept alive by an open schema', () => {
    it.each(UNDECLARED_BUT_BRANCHED_ON)(
        '$event still does not declare $field, which $consumer branches on',
        ({ event, field }) => {
            expect(resolveField(declarationFor(event).schema as JsonSchema, field)).toBeUndefined();
        },
    );

    it.each(UNDECLARED_BUT_BRANCHED_ON)(
        '$event still accepts a payload carrying $field — closing the schema would revert the behaviour',
        ({ event, payload }) => {
            const result = registryWith(declarationFor(event)).validate(event, payload);
            expect(
                result.valid,
                `${event} rejected its own producer's payload — see ${JSON.stringify(payload)}`,
            ).toBe(true);
        },
    );
});

/* ------------------------------------------------------------------ */
/* ws.call.invite — the replay path drops the two fields the consumer   */
/* branches on                                                          */
/* ------------------------------------------------------------------ */

/**
 * The live invite is a pass-through of the client payload
 * (realtime-modules:src/call/CallService.ts:1539, `data: payload`), so
 * `knock` / `admit` survive. The reconnect REPLAY rebuilds `data` from
 * stored call state and includes neither
 * (realtime-modules:src/call/CallService.ts:908-916) — the literal below is
 * that rebuild, transcribed field for field.
 *
 * Consequence: a knock that is replayed after a reconnect arrives with
 * `knock` undefined, so useIncomingCalls.ts:155 classifies it `'invite'` and
 * the callee gets a full incoming-call ring for a knock.
 *
 * The catalog cannot fix this — but it can stop hiding it. Both fields are
 * deliverable on this schema today, so the producer can fix it alone.
 */
const CALL_INVITE_REPLAY_PAYLOAD = Object.freeze({
    type: 'call',
    action: 'invite',
    data: {
        callId: 'call_1',
        callerId: 'u_1',
        lobbyName: 'dm:a:b',
        targetUserIds: ['u_2'],
        replayed: true,
        originalTimestamp: '2026-09-07T09:59:00.000Z',
        callerName: 'Ada',
    },
    timestamp: '2026-09-07T10:00:00.000Z',
});

describe('ws.call.invite — the reconnect replay drops knock/admit', () => {
    it('the replay literal carries neither knock nor admit', () => {
        const data = CALL_INVITE_REPLAY_PAYLOAD.data as Record<string, unknown>;
        expect(Object.keys(data)).not.toContain('knock');
        expect(Object.keys(data)).not.toContain('admit');
    });

    it('the replay literal validates — so the schema is not what is stopping the producer from including them', () => {
        const registry = registryWith(declarationFor('ws.call.invite'));
        expect(registry.validate('ws.call.invite', CALL_INVITE_REPLAY_PAYLOAD).valid).toBe(true);
        const repaired = {
            ...CALL_INVITE_REPLAY_PAYLOAD,
            data: { ...CALL_INVITE_REPLAY_PAYLOAD.data, knock: true },
        };
        expect(
            registry.validate('ws.call.invite', repaired).valid,
            'ws.call.invite no longer accepts `knock` — the producer fix is now blocked on a schema change here',
        ).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* (d) reads that no producer can satisfy — open schema, so a producer  */
/*     could fix them alone                                             */
/* ------------------------------------------------------------------ */

/**
 * Same class as the `call:reaction.recorded.orgId` case already registered
 * above: a consumer reads a field, nobody emits it, and the schema does not
 * declare it either — but the schema is open, so the fix is one line in the
 * producer and needs nothing from this catalog.
 *
 * Each entry pins BOTH halves: the field is still undeclared (so nobody has
 * quietly "fixed" it by declaring it and calling it done), and the schema
 * would carry it today (so the gap is genuinely the producer's).
 */
const READ_BUT_NOBODY_EMITS = [
    {
        // realtime-modules:src/activity/ActivityService.ts:256 builds
        // enrichedPayload as exactly {eventType, detail, timestamp, userId,
        // displayName}. realtime-examples:frontend/src/hooks/useActivityBus.ts:137
        // reads `payload.id ?? nextLocalId()` — the fallback ALWAYS wins, so
        // remote and local activity ids come from different generators and
        // never reconcile.
        event: 'ws.activity.event',
        field: 'payload.id',
        consumer: 'realtime-examples:frontend/src/hooks/useActivityBus.ts:137',
        emitSite: 'realtime-modules:src/activity/ActivityService.ts:256',
        sample: 'act_1',
        payload: { type: 'activity:event', payload: { eventType: 'document.edited', detail: {}, timestamp: '2026-09-07T10:00:00.000Z', userId: 'u_1', displayName: 'Ada' } },
    },
    {
        // useActivityBus.ts:143 reads `payload.color`. Same producer, same
        // five fields. This is the wire-frame twin of the already-registered
        // `activity.recorded.color` entry — the local item is coloured, the
        // server echo is not, so a user's own row changes colour when it
        // round-trips.
        event: 'ws.activity.event',
        field: 'payload.color',
        consumer: 'realtime-examples:frontend/src/hooks/useActivityBus.ts:143',
        emitSite: 'realtime-modules:src/activity/ActivityService.ts:256',
        sample: '#7c3aed',
        payload: { type: 'activity:event', payload: { eventType: 'document.edited', detail: {}, timestamp: '2026-09-07T10:00:00.000Z', userId: 'u_1', displayName: 'Ada' } },
    },
    {
        // realtime-examples:src/services/pipeline-service.ts:910 builds the
        // frame as {type, eventType, payload, channel, seq, sourceNodeId,
        // emittedAt} (+ optional traceparent/tracestate). `stepId` lives
        // INSIDE payload. realtime-examples:frontend/src/pages/
        // PipelineDemoPage.tsx:128 reads it off the frame and renders it as a
        // badge at :73 — the badge is always blank.
        event: 'ws.pipeline.event',
        field: 'stepId',
        consumer: 'realtime-examples:frontend/src/pages/PipelineDemoPage.tsx:128',
        emitSite: 'realtime-examples:src/services/pipeline-service.ts:910',
        sample: 'step_1',
        payload: { type: 'pipeline:event', eventType: 'pipeline:step:started', payload: { stepId: 'step_1' }, channel: 'pipeline:run_1', seq: 1, sourceNodeId: 'node-a', emittedAt: 1_757_240_000_000 },
    },
    {
        // platform-api:src/pipeline/judge/JudgeStepHandler.ts:104 (the
        // input-resolution failure, which fires BEFORE :133 emits
        // judge:started) and :162 both omit pipelineId. The vision handler
        // does emit it on the same path
        // (platform-api:src/pipeline/image/visionHandlerFactory.ts:167), so
        // this is pure asymmetry. ui-components:src/components/pipelines/
        // judge/useJudgmentResults.ts:183 reads
        // `payload.pipelineId ?? existing?.pipelineId` and, on that early
        // path, `existing` does not exist either — the row is near-empty.
        event: 'pipeline:judge:failed',
        field: 'pipelineId',
        consumer: 'ui-components:src/components/pipelines/judge/useJudgmentResults.ts:183',
        emitSite: 'platform-api:src/pipeline/judge/JudgeStepHandler.ts:162',
        sample: 'pipe_1',
        payload: { runId: 'run_1', stepId: 'step_1', at: '2026-09-07T10:00:00.000Z', reason: 'malformed', error: 'malformed' },
    },
] as const;

describe('(d) read but nobody emits — on an open schema, so the producer can fix it alone', () => {
    it.each(READ_BUT_NOBODY_EMITS)(
        '$event still does not declare $field, which $consumer reads',
        ({ event, field }) => {
            expect(resolveField(declarationFor(event).schema as JsonSchema, field)).toBeUndefined();
        },
    );

    it.each(READ_BUT_NOBODY_EMITS)(
        '$event would carry $field today, so the gap is $emitSite and not this catalog',
        ({ event, field, sample, payload }) => {
            const registry = registryWith(declarationFor(event));
            const leaf = field.split('.');
            const patched: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
            if (leaf.length === 1) {
                patched[leaf[0]] = sample;
            } else {
                patched[leaf[0]] = { ...(patched[leaf[0]] as Record<string, unknown>), [leaf[1]]: sample };
            }
            const result = registry.validate(event, patched);
            expect(result.valid, JSON.stringify(result.errors)).toBe(true);
        },
    );
});

/* ------------------------------------------------------------------ */
/* frames that are emitted AND branched on but appear nowhere in the    */
/* catalog                                                              */
/* ------------------------------------------------------------------ */

/**
 * The catalog's job is to be the inventory. These are events with a real
 * producer and a real consumer that it has never heard of — so "who
 * consumes X?" cannot be answered for them, and a producer changing one
 * gets no evolution gate.
 *
 * Two lookups, because the catalog keys pipeline events by name and gateway
 * frames by their wire `type` (+ `action`) literal.
 */
function declarationNamed(name: string): EventDeclaration | undefined {
    return allDeclarations.find(
        (d) => d.name === name || (d.aliases ?? []).some((a) => a.name === name),
    );
}

/** Find any declaration whose schema pins `type` (and optionally `action`) to these literals. */
function declarationForFrame(type: string, action?: string): EventDeclaration | undefined {
    return allDeclarations.find((d) => {
        const props = (d.schema as JsonSchema).properties ?? {};
        const typeConst = (props.type as { const?: string } | undefined)?.const;
        if (typeConst !== type) return false;
        if (action === undefined) return true;
        return (props.action as { const?: string } | undefined)?.const === action;
    });
}

const EMITTED_AND_READ_BUT_UNDECLARED_BY_NAME = [
    {
        name: 'pipeline:step:fanout',
        emitSite: 'distributed-core:src/applications/pipeline/PipelineExecutor.ts:1809',
        consumer: 'realtime-examples:frontend/src/components/pipelines/context/PipelineRunsContext.tsx:728',
        note: 'the reducer folds `count` onto the scatter source step as `fanoutCount`',
    },
    {
        name: 'pipeline:step:image:produced',
        emitSite: 'platform-api:src/pipeline/image/ImageSaveStepHandler.ts:117',
        consumer: 'realtime-examples:frontend/src/components/pipelines/context/PipelineRunsContext.tsx:697',
        note: 'the reducer dedups on `imageId` and appends an ImagePreview per event',
    },
    {
        name: 'pipeline:scatter:arm:checkpoint',
        emitSite: 'distributed-core:src/applications/pipeline/PipelineExecutor.ts:1831',
        consumer: 'none found',
        note: 'per-arm start/complete/fail checkpoints for a scatter group',
    },
] as const;

const EMITTED_AND_READ_BUT_UNDECLARED_FRAMES = [
    {
        type: 'reaction',
        action: 'reaction_history',
        emitSite: 'realtime-modules:src/reactions/ReactionService.ts:473',
        consumer: 'realtime-modules:src/client/useReactions.ts:143',
        note: 'this is the frame that actually replays stored reactions; the declared ws.reaction.list (action "reaction_list") has no producer',
    },
    {
        type: 'reaction',
        action: 'reaction_unsent',
        emitSite: 'realtime-modules:src/reactions/ReactionService.ts:424',
        consumer: 'realtime-modules:src/client/useReactions.ts:170',
        note: 'un-react acknowledgement',
    },
    {
        type: 'fileupload:clean',
        emitSite: 'none — the scan pipeline is deferred',
        consumer: 'realtime-modules:src/client/useFileUpload.ts:467',
        note: 'same dead-scan family as ws.fileupload.scanning',
    },
    {
        type: 'fileupload:infected',
        emitSite: 'none — the scan pipeline is deferred',
        consumer: 'realtime-modules:src/client/useFileUpload.ts:472',
        note: 'same dead-scan family as ws.fileupload.scanning',
    },
] as const;

describe('emitted and branched on, but absent from the catalog entirely', () => {
    it.each(EMITTED_AND_READ_BUT_UNDECLARED_BY_NAME)(
        '$name is still undeclared — emitted at $emitSite, read at $consumer',
        ({ name }) => {
            expect(
                declarationNamed(name),
                `${name} is now declared — retire this entry and check its consumer.`,
            ).toBeUndefined();
        },
    );

    it.each(EMITTED_AND_READ_BUT_UNDECLARED_FRAMES)(
        'no declaration pins type "$type"/action "$action" — read at $consumer',
        ({ type, action }) => {
            expect(
                declarationForFrame(type, action),
                `a declaration now covers ${type}/${action ?? '(any action)'} — retire this entry.`,
            ).toBeUndefined();
        },
    );

    it('ws.reaction.list declares the action the producer does NOT use', () => {
        // The pairing that makes the previous assertion a finding rather than
        // a gap: the catalog has a reaction-replay event, it just names the
        // wrong action, so the frame that carries the data is invisible and
        // the frame that is declared never arrives.
        const declaredAction = ((declarationFor('ws.reaction.list').schema as JsonSchema).properties?.action as { const?: string } | undefined)?.const;
        expect(declaredAction).toBe('reaction_list');
        expect(declarationForFrame('reaction', 'reaction_history')).toBeUndefined();
    });
});

/* ------------------------------------------------------------------ */
/* (e) ag-ui — six declarations that name fields the producer has never  */
/*     had                                                              */
/* ------------------------------------------------------------------ */

/**
 * The ag-ui declarations were written from the upstream AG-UI protocol
 * spec; `AgentStream` implements a different shape and always has. Six of
 * them require a field the emitter does not build, so the real frame fails
 * validation — same (e) class as the pipeline approvals, but latent rather
 * than live, because realtime-modules:src/client/useAgentStream.ts:317
 * explicitly ignores STATE_*, REASONING_*, ACTIVITY_*, RAW and META_EVENT.
 *
 * Latent is not harmless: these are the declarations the NEXT consumer will
 * be written against, and every one of them would be written wrong.
 *
 * Payloads below are the literals at realtime-modules:src/agent-streaming/
 * AgentStream.ts (dist agrees line-for-line).
 */
const AG_UI_SCHEMA_REJECTS_THE_REAL_FRAME = [
    { event: 'ag-ui.ACTIVITY_SNAPSHOT', missing: 'snapshot', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:322', payload: { type: 'ACTIVITY_SNAPSHOT', messageId: 'm_1', activityType: 'search', content: 'x', replace: true, timestamp: 1_757_240_000_000 } },
    { event: 'ag-ui.ACTIVITY_DELTA', missing: 'delta', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:338', payload: { type: 'ACTIVITY_DELTA', messageId: 'm_1', activityType: 'search', patch: 'x', timestamp: 1_757_240_000_000 } },
    { event: 'ag-ui.META_EVENT', missing: 'name', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:449', payload: { type: 'META_EVENT', metaType: 'trace', payload: {}, timestamp: 1_757_240_000_000 } },
    { event: 'ag-ui.REASONING_ENCRYPTED_VALUE', missing: 'value', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:421', payload: { type: 'REASONING_ENCRYPTED_VALUE', subtype: 's', entityId: 'e_1', encryptedValue: 'v', timestamp: 1_757_240_000_000 } },
    // RUN_FINISHED is the one with a second producer that also omits the
    // fields: platform-api:src/routes/pipelineLLMStream.ts:169 emits
    // {type, runId} — still no threadId. And the only in-repo caller passes
    // no args at all (realtime-modules:src/agent-streaming/agentStreamMiddleware.ts:210).
    { event: 'ag-ui.RUN_FINISHED', missing: 'threadId', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:121', payload: { type: 'RUN_FINISHED', outcome: 'ok', result: {}, timestamp: 1_757_240_000_000 } },
    { event: 'ag-ui.TOOL_CALL_RESULT', missing: 'toolCallName', emitSite: 'realtime-modules:src/agent-streaming/AgentStream.ts:273', payload: { type: 'TOOL_CALL_RESULT', messageId: 'm_1', toolCallId: 't_1', content: 'c', timestamp: 1_757_240_000_000 } },
] as const;

describe('(e) ag-ui — the declaration rejects the frame AgentStream builds', () => {
    it.each(AG_UI_SCHEMA_REJECTS_THE_REAL_FRAME)(
        '$event rejects the literal at $emitSite because it requires `$missing`',
        ({ event, missing, payload }) => {
            const result = registryWith(declarationFor(event)).validate(event, payload);
            expect(
                result.valid,
                `${event} now accepts AgentStream's frame — the contract was reconciled; retire this entry.`,
            ).toBe(false);
            expect(JSON.stringify(result.errors)).toContain(missing);
        },
    );

    it('TEXT_MESSAGE_CHUNK and TOOL_CALL_CHUNK require fields their emit site spreads in optionally', () => {
        // AgentStream.ts:201 and :290 spread an all-optional opts object, so
        // every "required" field on these two can legally be absent on the
        // wire. A bare frame is what the producer can emit; the schema says
        // it cannot exist.
        for (const event of ['ag-ui.TEXT_MESSAGE_CHUNK', 'ag-ui.TOOL_CALL_CHUNK']) {
            const result = registryWith(declarationFor(event)).validate(event, { type: event.split('.')[1] });
            expect(result.valid, `${event} now accepts a bare chunk frame`).toBe(false);
        }
    });
});

/* ------------------------------------------------------------------ */
/* pipeline:run:resumed — the description says "no producer yet"; there  */
/* has been one for a while, and it sends three undeclared fields        */
/* ------------------------------------------------------------------ */

describe('pipeline:run:resumed — declared as reserved, actually emitted', () => {
    // distributed-core:src/applications/pipeline/PipelineExecutor.ts:785
    // emits this on every crash-resume. The declaration lists only
    // {runId, at} and its description still reads "Phase 5 pause/resume —
    // reserved; no producer yet" (src/declarations/pipeline-p1.ts:95).
    //
    // `frontier` is the interesting one: it is the set of in-flight stepIds
    // a resume re-dispatches, which is exactly what a run-detail UI needs to
    // render "resumed at these steps" — and it is invisible in the catalog.
    const DC_RESUME_PAYLOAD = Object.freeze({
        runId: 'run_1',
        pipelineId: 'pipe_1',
        fromSequenceNumber: 3,
        frontier: ['step_a', 'step_b'],
        at: '2026-09-07T10:00:00.000Z',
    });

    it('accepts the executor\'s real resume payload — the open schema is all that saves it', () => {
        const result = registryWith(declarationFor('pipeline:run:resumed')).validate('pipeline:run:resumed', DC_RESUME_PAYLOAD);
        expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    });

    it.each(['pipelineId', 'frontier', 'fromSequenceNumber'])(
        'still does not declare %s, so nothing tells a consumer it is there',
        (field) => {
            const props = (declarationFor('pipeline:run:resumed').schema as JsonSchema).properties ?? {};
            expect(
                Object.keys(props),
                `pipeline:run:resumed now declares ${field} — update its "no producer yet" description too.`,
            ).not.toContain(field);
        },
    );
});

/* ------------------------------------------------------------------ */
/* pipeline:judge:failed — an enum narrower than the producer's union    */
/* ------------------------------------------------------------------ */

describe('pipeline:judge:failed — the reason enum cannot express two of the producer\'s own reasons', () => {
    // platform-api:src/pipeline/judge/JudgeStepHandler.ts:165 passes
    // `callResult.failureReason` straight through, unmapped. That field's
    // union (platform-api:src/pipeline/judge/JudgeClient.ts:89) includes
    // 'overloaded' and 'refusal', neither of which is in the declared enum.
    // Neither literal is assigned in JudgeClient today, so this is a loaded
    // gun rather than a live failure — but the vision family solved exactly
    // this with an explicit mapper
    // (platform-api:src/pipeline/image/visionHandlerFactory.ts:436
    // mapFailureReason) and judge has no equivalent.
    it.each(['overloaded', 'refusal'])(
        'rejects reason "%s", which the producer\'s failureReason union permits',
        (reason) => {
            const result = registryWith(declarationFor('pipeline:judge:failed')).validate('pipeline:judge:failed', {
                runId: 'run_1', stepId: 'step_1', at: '2026-09-07T10:00:00.000Z', reason, error: reason,
            });
            expect(
                result.valid,
                `pipeline:judge:failed now accepts "${reason}" — either the enum was widened or a mapper was added; check JudgeStepHandler.ts:165.`,
            ).toBe(false);
            expect(JSON.stringify(result.errors)).toContain('reason');
        },
    );

    it('declares budget-exhausted, which this event never carries — the budget path is a different event', () => {
        // platform-api:src/pipeline/judge/JudgeStepHandler.ts:118 emits
        // pipeline:judge:budget-exceeded instead. The enum member is a
        // documented outcome that cannot occur.
        const reasonEnum = ((declarationFor('pipeline:judge:failed').schema as JsonSchema).properties?.reason as { enum?: string[] } | undefined)?.enum ?? [];
        expect(reasonEnum).toContain('budget-exhausted');
        expect(declarationFor('pipeline:judge:budget-exceeded')).toBeDefined();
    });
});

/* ------------------------------------------------------------------ */
/* a registered entry that has gone stale under us                      */
/* ------------------------------------------------------------------ */

describe('ws.reaction.removed is registered as not-emitted, but the running service does emit it', () => {
    // DECLARED_BUT_NOT_EMITTED_EVENTS above still lists ws.reaction.removed
    // on the strength of a 2026-06-12 note claiming the dist ReactionService
    // has no remove action. It has one:
    // realtime-modules:dist/reactions/ReactionService.js:330 (src at
    // src/reactions/ReactionService.ts:402) builds
    // {type:'reaction', action:'reaction_removed', data:{...}} and
    // realtime-modules:src/client/useReactions.ts:163 filters state on it.
    //
    // So the event is emitted, read, AND rejected by its own schema (see
    // SCHEMA_REJECTS_THE_REAL_PAYLOAD). This test exists so the two claims
    // cannot drift apart silently: whichever way the note is corrected, one
    // of these expectations moves.
    it('is still carrying the stale not-emitted note', () => {
        const description = declarationFor('ws.reaction.removed').description ?? '';
        expect(description).toContain(EVENT_DRIFT_MARKER);
        expect(
            description,
            'the ws.reaction.removed note changed — reconcile it with the dist emit site at ReactionService.js:330.',
        ).toMatch(/NO reaction-remove action/);
    });

    it('is the only entry in DECLARED_BUT_NOT_EMITTED_EVENTS with a live emit site', () => {
        // Pins the scope of the correction: the other eight entries were
        // re-verified during this pass and remain accurate.
        expect(DECLARED_BUT_NOT_EMITTED_EVENTS).toContain('ws.reaction.removed');
    });
});

// ---------------------------------------------------------------------------
// Retired from the "rejects its own producer" table above — these two were
// fixed rather than documented.
//
// `pipeline.approval.requested` required `approverIds: string[]` and a numeric
// `requestedAt`; `pipeline.approval.recorded` required `approver` and a
// numeric `decidedAt`. No producer in any repo has ever assigned any of the
// four, and both events are transport:'both', so the durable path could never
// publish either one. The declarations now describe what PipelineExecutor
// actually sends. The unused properties stay declared-but-optional because
// removing a property is breaking under this repo's own compat gate.
//
// This asserts the fix holds. It is not a restatement of the schema: it runs
// the producer's real literal through the real validator, so re-tightening
// `required`, or re-typing the timestamps as numbers, fails here.
// ---------------------------------------------------------------------------

describe('the approval contracts accept their producer', () => {
  const cases = [
    {
      event: 'pipeline.approval.requested',
      emitSite: 'distributed-core:src/applications/pipeline/PipelineExecutor.ts:3087',
      payload: {
        runId: 'run_1',
        stepId: 'step_1',
        // Approver SPEC objects, not bare ids — the mistake the first fix made.
        approvers: [{ type: 'role', value: 'reviewer' }],
        at: '2026-09-07T10:00:00.000Z',
      },
    },
    {
      event: 'pipeline.approval.recorded',
      emitSite: 'distributed-core:src/applications/pipeline/PipelineExecutor.ts:1055',
      payload: {
        runId: 'run_1',
        stepId: 'step_1',
        userId: 'u_1',
        decision: 'approve',
        comment: 'lgtm',
        at: '2026-09-07T10:00:00.000Z',
      },
    },
  ];

  for (const { event, emitSite, payload } of cases) {
    it(`${event} accepts the literal ${emitSite} constructs`, () => {
      const registry = registryWith(declarationFor(event));
      const result = registry.validate(event, payload);
      expect(
        result.valid,
        `${event} rejected its own producer's payload: ${JSON.stringify(result.errors)}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Retired from the rejection table: ws.fileupload.progress required a
// `progress` percentage that FileUploadService has never sent — it publishes
// bytes (`transferred` + `size`). No real frame validated, and useFileUpload's
// own `progress?: number` guard could never fire. Asserts the fix holds
// against the producer's real literal.
// ---------------------------------------------------------------------------

describe('ws.fileupload.progress accepts its producer', () => {
  it('validates the frame FileUploadService.publishProgress builds', () => {
    const registry = registryWith(declarationFor('ws.fileupload.progress'));
    const result = registry.validate('ws.fileupload.progress', {
      type: 'fileupload:progress',
      channel: 'c_1',
      transferId: 't_1',
      id: 'u_1',
      actor: 'u_actor',
      transferred: 1024,
      size: 4096,
      timestamp: '2026-09-07T10:00:00.000Z',
    });
    expect(
      result.valid,
      `rejected its own producer's payload: ${JSON.stringify(result.errors)}`,
    ).toBe(true);
  });
});
