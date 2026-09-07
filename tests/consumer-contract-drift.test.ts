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
