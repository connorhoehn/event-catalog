// tests/orgiq-contract-evidence.test.ts
//
// EVIDENCE FILE — the `orgiq.*` namespace, pending an operator decision.
//
// The six `orgiq.*` declarations (src/declarations/orgiq-signal.ts, added
// 2026-05-22 in dabdbfd "feat(orgiq): declare OrgIQ channel signal events +
// orgiq-newsroom FeatureBundle (v0.3.46)", closing "App #2 OrgIQ Phase 1.4
// Gap 8") were written against an imagined FLAT frame —
// `{type, channel, timestamp, action, userId}` with `channel` REQUIRED.
//
// The gateway fan-out services that actually serve those channels emit
// nothing of the kind. Presence nests identity under `presence`
// (realtime-modules:dist/presence/PresenceService.js:191/216/242/262/322/422),
// reactions nest everything under `data`
// (realtime-modules:dist/reactions/ReactionService.js:268/331/461), and
// activity keys its acks on `channelId`, never `channel`
// (realtime-modules:dist/activity/ActivityService.js:143/160/214/261), with
// the real broadcast carrying `type:'activity:event'` (:194).
//
// Those exact frames are ALREADY declared, correctly, as `ws.presence.*` /
// `ws.reaction.*` / `ws.activity.*` — ground-truth reconciled against the
// same producer dist. So this is not a widening. The question in front of
// the operator is whether a duplicate, wrongly-shaped contract set should be
// rewritten, deprecated, or documented as aspirational.
//
// THIS FILE DECIDES NOTHING. It pins the facts so they cannot change
// silently while the decision is pending. Five groups:
//
//   A. Same wire, two contracts — every real frame is fed through BOTH the
//      `ws.*` declaration and its `orgiq.*` shadow. The `ws.*` side accepts
//      all 12. The `orgiq.*` side rejects 10 and admits 2 only by being
//      strictly looser than the `ws.*` contract already in place.
//   B. The four presence declarations are byte-identical to each other —
//      the channel lives only in the event NAME, so the "channel-scoped"
//      schemas distinguish nothing.
//   C. Producer attribution: all six name `orgiq-middleware`, which builds
//      none of these frames; the frames they shadow name `websocket-gateway`.
//   D. Nothing in this repo consumes them: no FeatureBundle lists an
//      `orgiq.*` name (the orgiq-newsroom bundle covers the same surface
//      with `ws.*` names only), and no source file outside the declaration
//      itself mentions one.
//   E. Current fingerprints, pinned as literals — so "rewriting the schemas
//      moves the fingerprints" is a mechanical failure here, not a claim.
//
// If you are here because this test failed: the orgiq situation changed.
// Read the group's comment, confirm the change was the decision that was
// made, and then update or delete this file deliberately.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../src/registry/index.js';
import { allDeclarations } from '../src/declarations/index.js';
import { allBundles } from '../src/declarations/bundles/index.js';
import { computeSchemaFingerprint } from '../src/registry/fingerprint.js';
import type { EventDeclaration } from '../src/types/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const ORGIQ_EVENTS = [
    'orgiq.newsroom-researcher.presence',
    'orgiq.newsroom-researcher.activity',
    'orgiq.newsroom-briefs.presence',
    'orgiq.search.presence',
    'orgiq.invoke.presence',
    'orgiq.newsroom-articles.reactions',
] as const;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function declarationFor(name: string): EventDeclaration {
    const decl = allDeclarations.find((d) => d.name === name);
    if (!decl) throw new Error(`no declaration named ${name}`);
    return decl;
}

function validate(event: string, payload: unknown): { valid: boolean; errors?: unknown } {
    const registry = new Registry();
    registry.declare(declarationFor(event));
    return registry.validate(event, payload) as { valid: boolean; errors?: unknown };
}

/* ------------------------------------------------------------------ */
/* the real wire — transcribed from the producers' object literals     */
/* ------------------------------------------------------------------ */

/**
 * Every frame below is copied from the producer's emit site in the
 * realtime-modules dist the gateway actually runs, NOT from any schema in
 * this repo. That is the point: when a schema and a producer disagree,
 * these constants are the side that tells the truth.
 */
const WIRE = Object.freeze({
    presenceSet: {
        // PresenceService.js:191 — ack to the client that set presence.
        type: 'presence',
        action: 'set',
        presence: { clientId: 'c_1', status: 'online', channels: ['newsroom-briefs'] },
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    presenceData: {
        // PresenceService.js:216 — get-presence response. `action:'presence'`.
        type: 'presence',
        action: 'presence',
        data: { clientId: 'c_1', status: 'online' },
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    presenceSubscribed: {
        // PresenceService.js:242 — one of only two frames carrying `channel`.
        type: 'presence',
        action: 'subscribed',
        channel: 'newsroom-briefs',
        presence: [{ clientId: 'c_1', status: 'online' }],
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    presenceUnsubscribed: {
        // PresenceService.js:262 — the other frame carrying `channel`.
        type: 'presence',
        action: 'unsubscribed',
        channel: 'newsroom-briefs',
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    presenceUpdate: {
        // PresenceService.js:322 — the roster broadcast. No `channel`.
        type: 'presence',
        action: 'update',
        presence: { clientId: 'c_1', status: 'online', channels: ['newsroom-briefs'] },
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    presenceOffline: {
        // PresenceService.js:422 — disconnect broadcast. No `channel`.
        type: 'presence',
        action: 'offline',
        clientId: 'c_1',
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    reactionReceived: {
        // ReactionService.js:268 — everything under `data`.
        type: 'reaction',
        action: 'reaction_received',
        data: {
            id: 'r_1',
            clientId: 'c_1',
            channel: 'newsroom-articles',
            targetId: 'a_1',
            emoji: '\u{1F44D}',
            userId: 'u_1',
            timestamp: '2026-09-07T10:00:00.000Z',
        },
    },
    reactionRemoved: {
        // ReactionService.js:331 — note there is no `id`; the removal is keyed
        // on the durable (targetId, emoji, userId) triple.
        type: 'reaction',
        action: 'reaction_removed',
        data: {
            channel: 'newsroom-articles',
            targetId: 'a_1',
            emoji: '\u{1F44D}',
            userId: 'u_1',
            timestamp: '2026-09-07T10:00:00.000Z',
        },
    },
    reactionSent: {
        // ReactionService.js:461 sendSuccess — success:true + data:{...}.
        type: 'reaction',
        action: 'reaction_sent',
        success: true,
        data: {
            reactionId: 'r_1',
            emoji: '\u{1F44D}',
            channel: 'newsroom-articles',
            timestamp: '2026-09-07T10:00:00.000Z',
        },
    },
    activitySubscribed: {
        // ActivityService.js:143 — `channelId`, not `channel`.
        type: 'activity',
        action: 'subscribed',
        channelId: 'newsroom-researcher',
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    activityPublished: {
        // ActivityService.js:214.
        type: 'activity',
        action: 'published',
        eventType: 'search.started',
        timestamp: '2026-09-07T10:00:00.000Z',
    },
    activityEvent: {
        // ActivityService.js:194 — the actual broadcast. `type:'activity:event'`.
        type: 'activity:event',
        payload: {
            eventType: 'search.started',
            detail: {},
            timestamp: '2026-09-07T10:00:00.000Z',
            userId: 'u_1',
            displayName: 'Ada',
        },
    },
});

type WireKey = keyof typeof WIRE;

/**
 * Each row: a real frame, the `ws.*` declaration that already covers it, the
 * `orgiq.*` declaration that claims to cover the same channel, and every
 * JSON-pointer path the orgiq schema rejects it on.
 *
 * `orgiqRejectsOn: []` means the orgiq schema ADMITS the frame — see the
 * separate assertion below for why that is not evidence in its favour.
 */
const SAME_WIRE_TWO_CONTRACTS: ReadonlyArray<{
    frame: WireKey;
    ws: string;
    orgiq: string;
    orgiqRejectsOn: readonly string[];
}> = [
    { frame: 'presenceSet', ws: 'ws.presence.set', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: ['channel'] },
    { frame: 'presenceData', ws: 'ws.presence.data', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: ['channel', 'action'] },
    { frame: 'presenceSubscribed', ws: 'ws.presence.subscribed', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: [] },
    { frame: 'presenceUnsubscribed', ws: 'ws.presence.unsubscribed', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: [] },
    { frame: 'presenceUpdate', ws: 'ws.presence.update', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: ['channel'] },
    { frame: 'presenceOffline', ws: 'ws.presence.offline', orgiq: 'orgiq.newsroom-briefs.presence', orgiqRejectsOn: ['channel'] },
    { frame: 'reactionReceived', ws: 'ws.reaction.received', orgiq: 'orgiq.newsroom-articles.reactions', orgiqRejectsOn: ['channel', 'action'] },
    { frame: 'reactionRemoved', ws: 'ws.reaction.removed', orgiq: 'orgiq.newsroom-articles.reactions', orgiqRejectsOn: ['channel', 'action'] },
    { frame: 'reactionSent', ws: 'ws.reaction.sent', orgiq: 'orgiq.newsroom-articles.reactions', orgiqRejectsOn: ['channel', 'action'] },
    { frame: 'activitySubscribed', ws: 'ws.activity.subscribed', orgiq: 'orgiq.newsroom-researcher.activity', orgiqRejectsOn: ['channel'] },
    { frame: 'activityPublished', ws: 'ws.activity.published', orgiq: 'orgiq.newsroom-researcher.activity', orgiqRejectsOn: ['channel'] },
    // `type` is NOT among the rejection paths here even though the frame says
    // `activity:event` and the schema says `const: 'activity'`. The validator
    // this catalog runs (distributed-core JsonSchemaValidator) implements
    // type / enum / required / properties / additionalProperties / items —
    // and NOT `const`. So the frame-type discriminator on every declaration
    // in this repo is decorative, and the orgiq schemas' only live
    // constraints are `required: ['type','channel']` plus the `action` enum.
    { frame: 'activityEvent', ws: 'ws.activity.event', orgiq: 'orgiq.newsroom-researcher.activity', orgiqRejectsOn: ['channel'] },
];

/* ================================================================== */
/* A. Same wire, two contracts                                        */
/* ================================================================== */

describe('A. the orgiq.* set shadows ws.* declarations that already fit the wire', () => {
    it('covers every frame the six orgiq declarations claim (12 emit sites, 3 services)', () => {
        expect(SAME_WIRE_TWO_CONTRACTS).toHaveLength(Object.keys(WIRE).length);
    });

    it.each(SAME_WIRE_TWO_CONTRACTS)(
        'the ws.* contract accepts the real $frame frame',
        ({ frame, ws }) => {
            const result = validate(ws, WIRE[frame]);
            expect(
                result.valid,
                `${ws} no longer accepts the frame its producer really emits: ${JSON.stringify(result.errors)}`,
            ).toBe(true);
        },
    );

    it.each(SAME_WIRE_TWO_CONTRACTS.filter((r) => r.orgiqRejectsOn.length > 0))(
        'the orgiq shadow rejects the same $frame frame on $orgiqRejectsOn',
        ({ frame, orgiq, orgiqRejectsOn }) => {
            const result = validate(orgiq, WIRE[frame]);
            expect(
                result.valid,
                `${orgiq} now accepts the real frame — the orgiq schemas were rewritten; this row is stale.`,
            ).toBe(false);
            const paths = (result.errors as Array<{ path?: string }> | undefined)?.map((e) => e.path) ?? [];
            expect(
                [...paths].sort(),
                `${orgiq} rejects ${frame} on a different set of fields than recorded`,
            ).toEqual([...orgiqRejectsOn].sort());
        },
    );

    /**
     * The only two frames the orgiq schemas admit are the presence
     * subscribe/unsubscribe acks — the only two the producer builds with a
     * top-level `channel` (PresenceService.js:242, :262). That is not a
     * point in the orgiq set's favour, for two reasons pinned below:
     * one orgiq declaration swallows both frames (the catalog has two
     * distinct `ws.presence.*` names for them), and it validates the
     * subscribe ack more weakly than `ws.presence.subscribed` already does.
     */
    it('the two frames it admits are exactly the two the producer builds with a `channel`', () => {
        expect(SAME_WIRE_TWO_CONTRACTS.filter((r) => r.orgiqRejectsOn.length === 0).map((r) => r.frame))
            .toEqual(['presenceSubscribed', 'presenceUnsubscribed']);
    });

    it('one orgiq declaration swallows both, where the catalog has two ws.* names', () => {
        const orgiq = 'orgiq.newsroom-briefs.presence';
        expect(validate(orgiq, WIRE.presenceSubscribed).valid).toBe(true);
        expect(validate(orgiq, WIRE.presenceUnsubscribed).valid).toBe(true);
        expect(declarationFor('ws.presence.subscribed')).not.toBe(declarationFor('ws.presence.unsubscribed'));
    });

    it('and it validates the subscribe ack more weakly than ws.presence.subscribed already does', () => {
        // ws.presence.subscribed types `presence` as an array of members;
        // the orgiq schema declares no `presence` property at all and leans
        // on additionalProperties:true, so a roster that is a bare string
        // sails through it.
        const corrupted = { ...WIRE.presenceSubscribed, presence: 'not-a-roster' };
        expect(
            validate('ws.presence.subscribed', corrupted).valid,
            'ws.presence.subscribed stopped typing the roster — the comparison below is no longer meaningful',
        ).toBe(false);
        expect(
            validate('orgiq.newsroom-briefs.presence', corrupted).valid,
            'the orgiq presence schema now constrains the roster — it is no longer strictly weaker',
        ).toBe(true);
    });

    /**
     * The single cause of all ten rejections is `channel` being REQUIRED on
     * a wire that does not carry it. Proved by relaxing exactly that and
     * re-validating: every rejection whose only complaint was `channel`
     * disappears. This pins the diagnosis, not just the symptom — so a fix
     * that changes the symptom without changing the cause fails here.
     */
    it('`channel` being required is the cause, not a symptom', () => {
        for (const row of SAME_WIRE_TWO_CONTRACTS) {
            const decl = declarationFor(row.orgiq);
            const schema = decl.schema as { required?: string[] };
            expect(schema.required, `${row.orgiq} no longer requires channel`).toContain('channel');

            const relaxed: EventDeclaration = {
                ...decl,
                name: `${decl.name}.relaxed-probe`,
                schema: { ...decl.schema, required: (schema.required ?? []).filter((f) => f !== 'channel') },
            };
            const registry = new Registry();
            registry.declare(relaxed);
            const result = registry.validate(relaxed.name, WIRE[row.frame]) as { valid: boolean };

            const onlyChannel = row.orgiqRejectsOn.length === 0
                || (row.orgiqRejectsOn.length === 1 && row.orgiqRejectsOn[0] === 'channel');
            expect(
                result.valid,
                `${row.orgiq} vs ${row.frame}: dropping the channel requirement ${onlyChannel ? 'should' : 'should not'} be enough`,
            ).toBe(onlyChannel);
        }
    });
});

/* ================================================================== */
/* B. The four presence declarations do not differ from each other    */
/* ================================================================== */

describe('B. "channel-scoped" is a naming convention only — the schemas are identical', () => {
    const PRESENCE_FOUR = [
        'orgiq.newsroom-researcher.presence',
        'orgiq.newsroom-briefs.presence',
        'orgiq.search.presence',
        'orgiq.invoke.presence',
    ] as const;

    it('all four presence schemas share one fingerprint — the channel appears only in the event name', () => {
        const fingerprints = new Set(PRESENCE_FOUR.map((n) => computeSchemaFingerprint(declarationFor(n).schema)));
        expect(
            fingerprints.size,
            'the four orgiq presence schemas now differ — someone made them channel-specific for real',
        ).toBe(1);
    });

    it('no orgiq schema constrains `channel` to its own channel name', () => {
        for (const name of ORGIQ_EVENTS) {
            const props = (declarationFor(name).schema as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
            const channel = props['channel'] ?? {};
            expect(Object.keys(channel), `${name} now pins its channel value`).not.toContain('const');
            expect(Object.keys(channel), `${name} now pins its channel value`).not.toContain('enum');
        }
    });

    it('so orgiq.search.presence validates a frame addressed to a different channel', () => {
        const wrongChannel = { ...WIRE.presenceSubscribed, channel: 'newsroom-articles' };
        expect(validate('orgiq.search.presence', wrongChannel).valid).toBe(true);
    });
});

/* ================================================================== */
/* C. Producer attribution                                            */
/* ================================================================== */

describe('C. the declared producer builds none of these frames', () => {
    it('all six attribute production to orgiq-middleware', () => {
        for (const name of ORGIQ_EVENTS) {
            expect(declarationFor(name).producer, `${name} producer changed`).toBe('orgiq-middleware');
        }
    });

    it('orgiq-middleware is named as producer of these six events and nothing else in the catalog', () => {
        const attributed = allDeclarations
            .filter((d) => (Array.isArray(d.producer) ? d.producer : [d.producer]).includes('orgiq-middleware'))
            .map((d) => d.name)
            .sort();
        expect(attributed).toEqual([...ORGIQ_EVENTS].sort());
    });

    it('every ws.* frame they shadow is attributed to websocket-gateway instead', () => {
        const shadowed = [...new Set(SAME_WIRE_TWO_CONTRACTS.map((r) => r.ws))];
        for (const name of shadowed) {
            expect(declarationFor(name).producer, `${name} producer changed`).toBe('websocket-gateway');
        }
    });
});

/* ================================================================== */
/* D. Nothing in this repo consumes them                              */
/* ================================================================== */

describe('D. no bundle, and no source file, references an orgiq.* event name', () => {
    it('no FeatureBundle lists an orgiq.* event', () => {
        const offenders = allBundles.flatMap((b) =>
            b.events.filter((e) => e.name.startsWith('orgiq.')).map((e) => `${b.name}@${b.version}:${e.name}`),
        );
        expect(
            offenders,
            `an orgiq.* event joined a bundle — that moves the bundle fingerprint: ${offenders.join(', ')}`,
        ).toHaveLength(0);
    });

    /**
     * The orgiq-newsroom bundle describes the SAME five channels using only
     * generic `ws.*` names. Its member list is therefore the working
     * contract for OrgIQ's realtime surface, and the six `orgiq.*`
     * declarations sit outside it entirely.
     */
    it('orgiq-newsroom@1.0.0 covers the same surface with ws.* names only', () => {
        const bundle = allBundles.find((b) => b.name === 'orgiq-newsroom');
        expect(bundle, 'the orgiq-newsroom bundle is gone').toBeDefined();
        expect(bundle!.version, 'bundle version moved — re-check the CRD pin consequence').toBe('1.0.0');
        expect(bundle!.events.every((e) => e.name.startsWith('ws.'))).toBe(true);
        // 6 presence + 5 activity + 5 reaction + ws.error
        expect(bundle!.events).toHaveLength(17);
    });

    /**
     * The literal event names appear nowhere in `src/` except the file that
     * declares them and the generated type map derived from it. If this
     * fails, something in-repo started branching on an orgiq.* name and the
     * "nothing consumes them" premise of the pending decision is void.
     */
    it('the only src/ files mentioning an orgiq.* name are the declaration and the generated types', () => {
        const hits: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                if (entry === 'node_modules' || entry === 'dist') continue;
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx)$/.test(entry)) continue;
                if (/orgiq\.(newsroom|search|invoke)[\w-]*\./.test(readFileSync(full, 'utf-8'))) {
                    hits.push(full.slice(ROOT.length + 1));
                }
            }
        };
        walk(join(ROOT, 'src'));
        expect(hits.sort()).toEqual([
            'src/declarations/orgiq-signal.ts',
            'src/generated/event-types.ts',
        ]);
    });
});

/* ================================================================== */
/* E. Fingerprints, pinned                                            */
/* ================================================================== */

/**
 * Consequence (a) of "rewrite the six to match the real frames", made
 * mechanical: any schema edit moves these, which invalidates
 * contracts/registry.snapshot.json, the published AsyncAPI, and any
 * consumer holding a pinned fingerprint. This test is the tripwire —
 * regenerating the snapshot alone will NOT silence it.
 */
const PINNED_FINGERPRINTS: Readonly<Record<string, string>> = {
    'orgiq.invoke.presence': '2baeebe0f53c92a00fdb9c4b24fcade866e149178613967d79f6e10fd4872019',
    'orgiq.newsroom-articles.reactions': '4aba94291a7ca7308f092fa19840cddc7003195d9d57d3bac1232ce9b4a3dda1',
    'orgiq.newsroom-briefs.presence': '2baeebe0f53c92a00fdb9c4b24fcade866e149178613967d79f6e10fd4872019',
    'orgiq.newsroom-researcher.activity': '0e7b3a0bf61e7517214dedb0ae0010484bd28b9bb7384ed010a15a76a68af4f1',
    'orgiq.newsroom-researcher.presence': '2baeebe0f53c92a00fdb9c4b24fcade866e149178613967d79f6e10fd4872019',
    'orgiq.search.presence': '2baeebe0f53c92a00fdb9c4b24fcade866e149178613967d79f6e10fd4872019',
};

describe('E. the fingerprints a rewrite would move', () => {
    it.each(Object.entries(PINNED_FINGERPRINTS))('%s still fingerprints to the value pinned here', (name, fingerprint) => {
        expect(
            computeSchemaFingerprint(declarationFor(name).schema),
            `${name}'s schema changed — every pinned consumer fingerprint and the registry snapshot move with it`,
        ).toBe(fingerprint);
    });

    it('the namespace is exactly these six events', () => {
        const found = allDeclarations.filter((d) => d.name.startsWith('orgiq.')).map((d) => d.name).sort();
        expect(found).toEqual([...ORGIQ_EVENTS].sort());
    });

    it('none of the six is marked deprecated via an alias record', () => {
        // Deprecation in this catalog is a runtime Registry.deprecate() record,
        // not a declaration field — so option (b) leaves these schemas, and
        // therefore the fingerprints above, untouched.
        for (const name of ORGIQ_EVENTS) {
            expect(declarationFor(name).aliases ?? [], `${name} gained an alias record`).toHaveLength(0);
        }
    });
});
