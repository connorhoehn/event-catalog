// tests/declaration-hygiene.test.ts
//
// Contract-hygiene invariants for everything in `src/declarations/`.
//
// This repo's whole reason to exist is that it owns the wire contract for
// every cross-service event on the platform. Those declarations were written
// incrementally, by different hands, over many months — so the rules that
// keep them coherent have to live somewhere executable, not in a reviewer's
// memory. That is this file.
//
// The rules below are the ones a NEW declaration must satisfy. Where an
// existing declaration cannot satisfy one — almost always because fixing it
// would rename an event or narrow a schema that a downstream consumer
// (platform-api, websocket-gateway, live-video-streaming, realtime-modules)
// is already publishing against — it is listed in an explicit allowlist with
// a one-line reason. Allowlists are for grandfathered facts, never for
// convenience: if you are adding an entry for something you just wrote, fix
// the declaration instead.

// ---------------------------------------------------------------------------
// KNOWN GAPS (2026-09-07 audit, revised 2026-09-07 after measuring the validator)
//
// The original audit listed nine defects and enforced none of them, on the
// stated ground that closing any would NARROW a live schema. That ground was
// an assumption about the validator, not a measurement of it. It has now been
// measured — see `tests/declaration-format-enforcement.test.ts`, which drives
// payloads through the real publish path (`Registry.validate` ->
// distributed-core `JsonSchemaValidator({ mode: 'auto' })`) and asserts what
// each keyword does.
//
// THE FINDING: `ajv` is not installed, is not a dependency of this repo, and
// distributed-core documents that it "MUST NOT depend on `ajv` at runtime".
// The hand-rolled fallback that actually runs implements exactly:
//     type, enum, properties, required, pattern, items, additionalProperties,
//     minimum, maximum, minLength, maxLength, minItems, maxItems
// `format` is NOT among them. So gaps 1 and 2 were free, and are now CLOSED
// and ENFORCED below. Everything else on the list uses a keyword the fallback
// DOES honour, so the "this would be breaking" reasoning survives for them —
// and is now backed by a test rather than by inference.
//
//  1. CLOSED. 137 timestamp strings now carry `format: 'date-time'` and
//     6 URL strings carry `format: 'uri'`, stamped by `COMMON_FORMATS` in
//     src/declarations/field-glossary.ts by the same additive mechanism that
//     fills descriptions. Enforced by the two rules in `payload fields` below.
//     Residual risk, recorded so it is not a surprise: installing `ajv`
//     WITHOUT `ajv-formats` makes ajv v8 throw "unknown format" at compile
//     time, which `validateWithAjv` converts into a hard failure for EVERY
//     payload of the affected event. The enforcement test asserts ajv is
//     absent so that change is loud.
//  2. CLOSED — folded into 1. The audit's list of 4 URLs missed the two
//     `action.href` fields on ws.notification.new and
//     ws.notification.bulk-update.
//  2b. CLOSED 2026-09-07. Two fields were typed `number` while their
//     description said "ISO-8601 timestamp" — ws.pipeline.event $.emittedAt
//     and ws.presence.joined $.client.lastHeartbeat. The producer settles it:
//     both are epoch milliseconds (pipeline-service.ts assigns `Date.now()`;
//     presence-service.ts does `now - lastHeartbeat` arithmetic), so the PROSE
//     was the defect and was fixed, leaving the non-breaking `type` alone.
//     TIMESTAMP_TYPE_CONTRADICTIONS is now empty and the rule below is fully
//     enforcing, so a third contradiction fails rather than being recorded.
//  3. OPEN, and breaking. 38 discrete counters are `number` where `integer` +
//     `minimum: 0` is meant. `type: 'integer'` and `minimum` are both honoured
//     by the fallback, so retyping rejects a producer sending 12.5 today —
//     and for the *Ms durations that is a live risk, since a high-resolution
//     clock delta is legitimately fractional. Grandfathered in
//     NUMERIC_COUNTER_EXCEPTIONS below, which is a ratchet: a NEW counter must
//     be declared `integer` with `minimum: 0`.
//  4. OPEN, and the audit's stated reasoning for it is WRONG. It claimed that
//     adding `properties` without `required`, with `additionalProperties` left
//     open, would be purely documentary. It is not: the fallback descends into
//     every declared property PRESENT in the payload and applies its
//     sub-schema, so adding `score: { type: 'number' }` rejects a producer
//     sending `score: 'high'`. 28 properties are `type: 'object'` with no
//     `properties`. Two of the audit's "worst offenders" — pipeline:judge:
//     scored $.result and pipeline:image:vision:analyzed $.result — are
//     deliberately loose, with an in-source comment saying the canonical TS
//     type is the source of truth; they are a decision, not a defect.
//     The safe half of this fix is real and unused: a sub-schema carrying only
//     a `description` and no `type` asserts nothing, so naming the fields
//     without typing them documents the shape at zero contract risk. That is
//     step 1 of any migration here; step 2 (adding the types) needs the
//     producer's agreement.
//  5. OPEN, and breaking. 7 nested objects declare `properties` but no
//     `required`: $.usage on pipeline:judge:scored +
//     pipeline:image:vision:analyzed, and $.data on
//     ws.call.{invite,accepted,declined,cancelled,ended}. `required` is
//     honoured, so adding it rejects a payload omitting the field.
//  6. OPEN, and breaking. 2 arrays have no `items` schema:
//     transcription:job.queued $.tracks and
//     transcription:transcript.ready $.languages. A typed `items` is honoured
//     per element.
//  7. OPEN, and breaking. Bare strings that are closed value sets elsewhere:
//     `slot.status` is an enum on pipeline:raft:run:terminated but a free
//     string on the other four raft events; `status` on client.presence.set
//     and ws.presence.joined $.client names the PresenceStatus values in prose
//     only; `mode` on the two pipeline:step:context.patched* events;
//     `$.data.status` on ws.upload.scanned. `enum` is honoured.
//  8. OPEN, and breaking. 189 of 194 root schemas are
//     `additionalProperties: true`. Several are genuinely closed contracts
//     (the ag-ui protocol events, call:caption:line) and should be `false`,
//     but `additionalProperties: false` is honoured and closing them rejects
//     any extra field a producer sends today.
//  9. OPEN. Naming: see the three allowlists below — 13 events whose names
//     break their namespace's convention. Renaming an event is the most
//     breaking change available, so they stand.
//
// The shape of a fix for 3–8 is the same in every case, and none of it can be
// done from inside this repo alone: pick the event, confirm with the producer
// what it actually sends, narrow the schema, bump the declaration, and let the
// registry's compat gate record the evolution. Until then they are documented,
// not enforced — and the ratchets below make sure the count does not grow.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { allDeclarations } from '../src/declarations/index.js';
import { allBundles } from '../src/declarations/bundles/index.js';
import { COMMON_FIELDS, COMMON_FORMATS } from '../src/declarations/field-glossary.js';
import type { EventDeclaration } from '../src/types/index.js';

// ---------------------------------------------------------------------------
// Allowlists — grandfathered violations. Renaming any of these is a BREAKING
// change for a live producer, so they are documented rather than "fixed".
// ---------------------------------------------------------------------------

/** Events whose separator after the namespace differs from their namespace's dominant one. */
const SEPARATOR_EXCEPTIONS: Record<string, string> = {
  'pipeline.approval.requested': 'Canonical DURABLE name; the colon form is declared as its deprecated alias.',
  'pipeline.approval.recorded': 'Canonical DURABLE name; the colon form is declared as its deprecated alias.',
  'pipeline.approval.resolved': 'Canonical DURABLE name; the colon form is declared as its deprecated alias.',
  'pipeline.run.checkpoint': 'Canonical DURABLE name; the colon form is declared as its deprecated alias.',
};

/** Events that mix `:` and `.` inside a single name. */
const MIXED_SEPARATOR_EXCEPTIONS: Record<string, string> = {
  'pipeline:step:context.patched': 'Emitted verbatim by distributed-core PipelineExecutor; renaming breaks the gateway bridge.',
  'pipeline:step:context.patched-unvalidated': 'Emitted verbatim by distributed-core PipelineExecutor; renaming breaks the gateway bridge.',
  'pipeline:step:context.patch-reverted': 'Emitted verbatim by distributed-core PipelineExecutor; renaming breaks the gateway bridge.',
  'transcription:job.queued': 'Backfilled to match the queue name platform-api already publishes to.',
  'transcription:transcript.ready': 'Backfilled to match the name the transcription worker already publishes.',
  'transcription:summary.ready': 'Backfilled to match the name platform-api already publishes.',
  'call:reaction.recorded': 'Backfilled to match the name the gateway already publishes (realtime-examples/src/server.ts:1058) and platform-api already subscribes to.',
};

/**
 * Payload fields whose names belong to a FOREIGN wire protocol, not to this
 * platform — so the lowerCamelCase rule does not apply and cannot be made to.
 *
 * The only members are the three IVS Chat frames the SFU republishes on
 * `chat-bus:<channelArn>`. Their keys are PascalCase (Type, Id, Sender,
 * Content, SendTime …) because ChatHub hands the SAME object to
 * `_publishCluster` and to `_broadcast` (live-video-streaming
 * src/chat/ChatHub.js:161 and :73) — meaning the object on the bus is the
 * object AWS-IVS-compatible chat clients receive on
 * `/api/channels/:arn/chat`. LVS is the IVS replacement target; renaming
 * these keys would break that parity, and declaring them camelCase here
 * would simply be false.
 *
 * This is the one exception the codebase has to "payload fields are
 * lowerCamelCase, platform-wide", and it is scoped by EVENT so that a
 * platform-native event cannot slip a PascalCase field through. Do not add
 * an event here to make your own declaration pass — the rule is right for
 * everything the platform itself defines.
 */
const FOREIGN_WIRE_PROTOCOL_EVENTS: Record<string, string> = {
  'sfu.chat.message': 'IVS Chat wire protocol — the same object goes to IVS-compatible clients verbatim.',
  'sfu.chat.message_deleted': 'IVS Chat wire protocol — the same object goes to IVS-compatible clients verbatim.',
  'sfu.chat.user_disconnected': 'IVS Chat wire protocol — the same object goes to IVS-compatible clients verbatim.',
};

/** Events with a camelCase segment where the namespace otherwise uses lower-kebab. */
const SEGMENT_CASE_EXCEPTIONS: Record<string, string> = {
  'pipeline:run:resumeFromStep': 'Gateway-local stub whose name mirrors the handleResumeFromStep handler; on the wire today.',
  'client.reaction.getAvailable': 'Name mirrors the gateway ReactionService `action` string verbatim — ground truth, not style.',
  'client.activity.getHistory': 'Name mirrors the gateway ActivityService `action` string verbatim — ground truth, not style.',
  'client.chat.addMembers': 'Name mirrors the gateway ChatService `action` string verbatim — ground truth, not style.',
  'client.chat.removeMember': 'Name mirrors the gateway ChatService `action` string verbatim — ground truth, not style.',
  'client.meeting.hand.lowerAll': 'Name mirrors the realtime-modules MeetingService `action` string verbatim — ground truth, not style.',
  'client.meeting.breakout.addRoom': 'Name mirrors the realtime-modules MeetingService `action` string verbatim — ground truth, not style.',
  'client.meeting.breakout.autoAssign': 'Name mirrors the realtime-modules MeetingService `action` string verbatim — ground truth, not style.',
};

/**
 * Known gap 3 — discrete counters declared `number` instead of `integer` with
 * `minimum: 0`. Every entry below predates the rule. Narrowing one is a
 * breaking change (`type: 'integer'` and `minimum` are both enforced by the
 * validator that actually runs — proven in declaration-format-enforcement),
 * so they stand; the rule exists to stop a 39th appearing.
 *
 * Keyed `<event> $.<dotted path>`, array hops elided, matching the failure
 * message format.
 */
const NUMERIC_COUNTER_EXCEPTIONS: ReadonlySet<string> = new Set([
  'pipeline.run.checkpoint $.sequenceNumber',
  'pipeline:step:attempt:started $.attemptNumber',
  'pipeline:step:attempt:failed $.attemptNumber',
  'pipeline:llm:response $.tokensIn',
  'pipeline:llm:response $.tokensOut',
  'pipeline:run:retry $.attempt',
  'pipeline:join:waiting $.received',
  'pipeline:join:waiting $.required',
  'pipeline:raft:run:started $.slot.lastAppliedIndex',
  'pipeline:raft:run:started $.slot.pipelineVersion',
  'pipeline:raft:run:updated $.slot.lastAppliedIndex',
  'pipeline:raft:run:synthesized $.slot.lastAppliedIndex',
  'pipeline:raft:run:checkpointed $.slot.lastAppliedIndex',
  'pipeline:raft:run:terminated $.slot.lastAppliedIndex',
  'pipeline:judge:started $.rubricVersion',
  'pipeline:judge:scored $.usage.inputTokens',
  'pipeline:judge:scored $.usage.outputTokens',
  'pipeline:judge:scored $.usage.cacheReadTokens',
  'pipeline:judge:scored $.usage.cacheCreationTokens',
  'pipeline:judge:failed $.tokensIn',
  'pipeline:judge:failed $.tokensOut',
  'pipeline:image:vision:token $.seq',
  'pipeline:image:vision:analyzed $.usage.inputTokens',
  'pipeline:image:vision:analyzed $.usage.outputTokens',
  'pipeline:image:vision:analyzed $.usage.imageTokens',
  'pipeline:image:vision:failed $.tokensIn',
  'pipeline:image:vision:failed $.tokensOut',
  'call:caption:line $.seq',
  'transcription:transcript.ready $.speakerCount',
  'transcription:summary.ready $.summaryChars',
  'pipeline:step:agent:tool $.callIndex',
  'ws.crdt.snapshot-stored $.size',
  'ws.upload.requested $.data.size',
  'ws.pipeline.history $.fromVersion',
  'ws.pipeline.event $.seq',
  'client.chat.history $.limit',
  'client.activity.getHistory $.limit',
  'client.fileupload.request-upload $.size',
]);

/**
 * Known gap 2b — CLOSED 2026-09-07, list intentionally empty.
 *
 * The two entries that lived here (`ws.pipeline.event $.emittedAt` and
 * `ws.presence.joined $.client.lastHeartbeat`) were typed `number` while their
 * glossary description promised an ISO-8601 string. Producer ground truth in
 * realtime-examples settled it as epoch milliseconds in BOTH cases, so the
 * DESCRIPTIONS were corrected in src/declarations/field-glossary.ts and the
 * `type: 'number'` — the half that would have been breaking to change — stands.
 * See the SCOPE note in that file for the emit-site citations.
 *
 * Keep this empty. An entry here means a `number`/ISO-8601 contradiction was
 * shipped rather than resolved, and the rule below is what forces the choice.
 */
const TIMESTAMP_TYPE_CONTRADICTIONS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TRANSPORTS = new Set(['signal', 'durable', 'both']);

/** Lower-kebab/dot/colon segments: `run:started`, `chat.joined`, `patch-reverted`. */
const LOWER_NAME = /^[a-z0-9]+([.:_-][a-z0-9]+)*$/;
/** AG-UI protocol style: `RUN_STARTED`. */
const SCREAMING_NAME = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
/** Payload field names are lowerCamelCase, platform-wide. */
const LOWER_CAMEL_FIELD = /^[a-z][a-zA-Z0-9]*$/;

/** A description that promises an ISO-8601 instant. */
const PROMISES_ISO_8601 = /ISO-8601/;
/** Field names whose string values are URLs. */
const URL_FIELD = /^(url|uri|href)$|(Url|Uri)$/;

/**
 * Field names that count discrete things. `integer` + `minimum: 0` is the
 * right declaration for every one of them.
 *
 * Deliberately NOT here, because these are genuinely continuous and `number`
 * is correct: `costUsd`, `cacheHitRatio`, `progress`, and the `*Ms` durations
 * (`durationMs`, `latencyMs`, `nextBackoffMs`) — a high-resolution clock delta
 * is fractional. Also excluded: the epoch-millisecond timestamps
 * (`requestedAt`, `decidedAt`, `resolvedAt`), which are instants, not counts.
 */
const DISCRETE_COUNTER_FIELDS: ReadonlySet<string> = new Set([
  'attempt', 'attemptNumber', 'callIndex', 'cacheCreationTokens', 'cacheReadTokens',
  'fromVersion', 'imageTokens', 'inputTokens', 'lastAppliedIndex', 'limit',
  'outputTokens', 'pipelineVersion', 'received', 'required', 'rubricVersion',
  'seq', 'sequenceNumber', 'size', 'speakerCount', 'summaryChars',
  'tokensIn', 'tokensOut',
]);

/** True when a sub-schema's `type` admits a string (`'string'` or `['string','null']`). */
function admitsString(schema: Record<string, unknown>): boolean {
  const t = schema.type;
  if (typeof t === 'string') return t === 'string';
  if (Array.isArray(t)) return t.includes('string');
  return false;
}

/** Shortest description we accept. Long enough to exclude a bare token. */
const MIN_PROPERTY_DESCRIPTION = 12;
const MIN_EVENT_DESCRIPTION = 30;

interface PropertyRef {
  event: string;
  /** Dotted path from the schema root, array hops elided. */
  path: string;
  name: string;
  schema: Record<string, unknown>;
}

/** Every property in a declaration's schema, at every depth. */
function eachProperty(decl: EventDeclaration): PropertyRef[] {
  const out: PropertyRef[] = [];
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    const s = node as Record<string, unknown>;

    const props = s.properties;
    if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
      for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
        if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) continue;
        const childPath = path ? `${path}.${name}` : name;
        out.push({ event: decl.name, path: childPath, name, schema: sub as Record<string, unknown> });
        visit(sub, childPath);
      }
    }

    const items = s.items;
    if (Array.isArray(items)) for (const entry of items) visit(entry, path);
    else if (items !== null && typeof items === 'object') visit(items, path);

    const addl = s.additionalProperties;
    if (addl !== null && typeof addl === 'object' && !Array.isArray(addl)) visit(addl, path);
  };
  visit(decl.schema, '');
  return out;
}

/** Every object sub-schema that declares a `required` array, with its properties. */
function eachRequiredBlock(decl: EventDeclaration): { path: string; required: unknown[]; props: string[] }[] {
  const out: { path: string; required: unknown[]; props: string[] }[] = [];
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    const s = node as Record<string, unknown>;
    const props = s.properties;
    const propNames =
      props !== null && typeof props === 'object' && !Array.isArray(props)
        ? Object.keys(props as Record<string, unknown>)
        : [];
    if (Array.isArray(s.required)) out.push({ path: path || '$', required: s.required, props: propNames });

    if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
      for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
        visit(sub, path ? `${path}.${name}` : name);
      }
    }
    const items = s.items;
    if (Array.isArray(items)) for (const entry of items) visit(entry, path);
    else if (items !== null && typeof items === 'object') visit(items, path);
  };
  visit(decl.schema, '');
  return out;
}

const producersOf = (decl: EventDeclaration): string[] =>
  Array.isArray(decl.producer) ? decl.producer : [decl.producer];

// ---------------------------------------------------------------------------
// Metadata — who owns this event, and does it say what it is?
// ---------------------------------------------------------------------------

describe('declaration metadata', () => {
  it('every event declares a namespace', () => {
    const missing = allDeclarations.filter((d) => !d.namespace?.trim()).map((d) => d.name);
    expect(missing, `events with no namespace: ${missing.join(', ')}`).toEqual([]);
  });

  it('every event carries a description that explains it', () => {
    const bad = allDeclarations
      .filter((d) => (d.description ?? '').trim().length < MIN_EVENT_DESCRIPTION)
      .map((d) => `${d.name} (${(d.description ?? '').length} chars)`);
    expect(bad, `event descriptions shorter than ${MIN_EVENT_DESCRIPTION} chars: ${bad.join('; ')}`).toEqual([]);
  });

  it('every event attributes at least one non-empty producer', () => {
    const bad = allDeclarations
      .filter((d) => {
        const ps = producersOf(d);
        return ps.length === 0 || ps.some((p) => typeof p !== 'string' || p.trim().length === 0);
      })
      .map((d) => d.name);
    expect(bad, `events with missing/blank producer attribution: ${bad.join(', ')}`).toEqual([]);
  });

  it('every event carries at least one tag', () => {
    const bad = allDeclarations.filter((d) => (d.tags ?? []).length === 0).map((d) => d.name);
    expect(bad, `events with no tags: ${bad.join(', ')}`).toEqual([]);
  });

  it('every event declares a valid transport', () => {
    const bad = allDeclarations
      .filter((d) => !VALID_TRANSPORTS.has(d.transport))
      .map((d) => `${d.name}=${d.transport}`);
    expect(bad, `events with an unknown transport: ${bad.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Naming — an event name is part of the contract, so drift in it is drift.
// ---------------------------------------------------------------------------

describe('event naming', () => {
  it('every event name is unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const d of allDeclarations) {
      if (seen.has(d.name)) dupes.push(d.name);
      seen.add(d.name);
    }
    expect(dupes, `duplicate event names: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every event name is prefixed by its own namespace', () => {
    const bad = allDeclarations
      .filter((d) => {
        const ns = d.namespace ?? '';
        return !d.name.startsWith(ns) || !['.', ':'].includes(d.name[ns.length] ?? '');
      })
      .map((d) => `${d.name} (namespace ${d.namespace})`);
    expect(bad, `names not prefixed by "<namespace><. or :>": ${bad.join('; ')}`).toEqual([]);
  });

  it('every name in a namespace uses that namespace\'s dominant separator', () => {
    const bad: string[] = [];
    const byNamespace = new Map<string, EventDeclaration[]>();
    for (const d of allDeclarations) {
      const ns = d.namespace ?? '';
      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      byNamespace.get(ns)!.push(d);
    }
    for (const [ns, decls] of byNamespace) {
      const counts = new Map<string, number>();
      for (const d of decls) {
        const sep = d.name[ns.length] ?? '';
        counts.set(sep, (counts.get(sep) ?? 0) + 1);
      }
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const d of decls) {
        const sep = d.name[ns.length] ?? '';
        if (sep !== dominant && !(d.name in SEPARATOR_EXCEPTIONS)) {
          bad.push(`${d.name} uses "${sep}" where ${ns} dominantly uses "${dominant}"`);
        }
      }
    }
    expect(bad, `separator drift: ${bad.join('; ')}`).toEqual([]);
  });

  it('no event name mixes ":" and "." separators', () => {
    const bad = allDeclarations
      .filter((d) => d.name.includes(':') && d.name.includes('.') && !(d.name in MIXED_SEPARATOR_EXCEPTIONS))
      .map((d) => d.name);
    expect(bad, `names mixing ":" and ".": ${bad.join(', ')}`).toEqual([]);
  });

  it('every name segment is lower-kebab or SCREAMING_SNAKE, consistently within its namespace', () => {
    const bad: string[] = [];
    const classOf = (rest: string): 'lower' | 'screaming' | 'other' =>
      LOWER_NAME.test(rest) ? 'lower' : SCREAMING_NAME.test(rest) ? 'screaming' : 'other';

    const byNamespace = new Map<string, EventDeclaration[]>();
    for (const d of allDeclarations) {
      const ns = d.namespace ?? '';
      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      byNamespace.get(ns)!.push(d);
    }
    for (const [ns, decls] of byNamespace) {
      const classes = decls
        .filter((d) => !(d.name in SEGMENT_CASE_EXCEPTIONS))
        .map((d) => classOf(d.name.slice(ns.length + 1)));
      const dominant = classes.filter((c) => c !== 'other').sort()[0] ?? 'lower';
      for (const d of decls) {
        if (d.name in SEGMENT_CASE_EXCEPTIONS) continue;
        const cls = classOf(d.name.slice(ns.length + 1));
        if (cls !== dominant) bad.push(`${d.name} is "${cls}" where ${ns} is "${dominant}"`);
      }
    }
    expect(bad, `name-casing drift: ${bad.join('; ')}`).toEqual([]);
  });

  it('every allowlisted naming exception is still a real declaration', () => {
    const declared = new Set(allDeclarations.map((d) => d.name));
    const stale = [
      ...Object.keys(SEPARATOR_EXCEPTIONS),
      ...Object.keys(MIXED_SEPARATOR_EXCEPTIONS),
      ...Object.keys(SEGMENT_CASE_EXCEPTIONS),
    ].filter((name) => !declared.has(name));
    expect(stale, `allowlist entries for events that no longer exist — delete them: ${stale.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Deprecation — a superseded name has to say so.
// ---------------------------------------------------------------------------

describe('deprecated aliases', () => {
  it('every alias is flagged deprecated', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const alias of d.aliases ?? []) {
        if (alias.deprecated !== true) bad.push(`${d.name} -> ${alias.name}`);
      }
    }
    expect(bad, `aliases not marked deprecated: ${bad.join(', ')}`).toEqual([]);
  });

  it('no alias shadows a canonical event name', () => {
    const canonical = new Set(allDeclarations.map((d) => d.name));
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const alias of d.aliases ?? []) {
        if (canonical.has(alias.name)) bad.push(`${alias.name} (alias of ${d.name}) is also a canonical event`);
      }
    }
    expect(bad, `alias/canonical collisions: ${bad.join('; ')}`).toEqual([]);
  });

  it('no alias name is claimed by two events', () => {
    const owner = new Map<string, string>();
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const alias of d.aliases ?? []) {
        const prior = owner.get(alias.name);
        if (prior) bad.push(`${alias.name} claimed by both ${prior} and ${d.name}`);
        owner.set(alias.name, d.name);
      }
    }
    expect(bad, `duplicate alias names: ${bad.join('; ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schema shape — the open/closed decision has to be deliberate.
// ---------------------------------------------------------------------------

describe('schema shape', () => {
  it('every root schema is an object with declared properties', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      const s = d.schema as Record<string, unknown>;
      if (s.type !== 'object') {
        bad.push(`${d.name}: root type is ${JSON.stringify(s.type)}, expected "object"`);
        continue;
      }
      const props = s.properties;
      if (props === null || typeof props !== 'object' || Object.keys(props as object).length === 0) {
        bad.push(`${d.name}: root schema declares no properties`);
      }
    }
    expect(bad, `root schema problems: ${bad.join('; ')}`).toEqual([]);
  });

  it('every root schema declares `required` explicitly', () => {
    const bad = allDeclarations
      .filter((d) => !Array.isArray((d.schema as Record<string, unknown>).required))
      .map((d) => d.name);
    expect(bad, `root schemas with no required array (use [] if nothing is required): ${bad.join(', ')}`).toEqual([]);
  });

  it('every root schema declares `additionalProperties` explicitly', () => {
    // Open vs closed is a contract decision, not a default to inherit by
    // accident. `true` is fine — leaving it unsaid is not.
    const bad = allDeclarations
      .filter((d) => (d.schema as Record<string, unknown>).additionalProperties === undefined)
      .map((d) => d.name);
    expect(bad, `root schemas with an implicit additionalProperties: ${bad.join(', ')}`).toEqual([]);
  });

  it('every `required` entry names a declared property', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const block of eachRequiredBlock(d)) {
        for (const name of block.required) {
          if (typeof name !== 'string') {
            bad.push(`${d.name} ${block.path}.required contains a non-string`);
          } else if (!block.props.includes(name)) {
            bad.push(`${d.name} ${block.path}.required names "${name}", which is not in properties`);
          }
        }
      }
    }
    expect(bad, `required/properties mismatches: ${bad.join('; ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Payload fields — the part consumers actually read.
// ---------------------------------------------------------------------------

describe('payload fields', () => {
  it('every property at every depth carries a description', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const prop of eachProperty(d)) {
        const desc = prop.schema.description;
        if (typeof desc !== 'string' || desc.trim().length < MIN_PROPERTY_DESCRIPTION) {
          bad.push(`${d.name} $.${prop.path}`);
        }
      }
    }
    expect(
      bad,
      'properties with no (or a one-token) description. Add the field to '
        + 'src/declarations/field-glossary.ts if the name is reused across events, '
        + `or describe it inline: ${bad.join(', ')}`,
    ).toEqual([]);
  });

  it('every property name is lowerCamelCase', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      if (d.name in FOREIGN_WIRE_PROTOCOL_EVENTS) continue;
      for (const prop of eachProperty(d)) {
        if (!LOWER_CAMEL_FIELD.test(prop.name)) bad.push(`${d.name} $.${prop.path}`);
      }
    }
    expect(bad, `payload fields that are not lowerCamelCase: ${bad.join(', ')}`).toEqual([]);
  });

  it('every foreign-wire-protocol exemption is a real declaration that actually needs it', () => {
    const byName = new Map(allDeclarations.map((d) => [d.name, d]));
    const stale: string[] = [];
    for (const name of Object.keys(FOREIGN_WIRE_PROTOCOL_EVENTS)) {
      const decl = byName.get(name);
      if (!decl) {
        stale.push(`${name} is no longer declared`);
      } else if (eachProperty(decl).every((p) => LOWER_CAMEL_FIELD.test(p.name))) {
        stale.push(`${name} is now fully lowerCamelCase`);
      }
    }
    expect(stale, `exemptions that no longer earn their place — delete them: ${stale.join('; ')}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Formats. A description that says "ISO-8601 timestamp" and a schema that
  // says nothing but `type: 'string'` are two different contracts, and only
  // one of them is machine-readable — the generated AsyncAPI, the OpenAPI
  // spec, and any codegen consumer see the string and nothing else. These two
  // rules keep the schema saying what the prose already says.
  //
  // Safe to enforce because `format` is inert on this repo's validation path;
  // that is measured, not assumed, in declaration-format-enforcement.test.ts.
  // Satisfy them by adding the field to COMMON_FORMATS in
  // src/declarations/field-glossary.ts, not by hand-editing the declaration.
  // -------------------------------------------------------------------------

  it('every string field described as ISO-8601 declares `format: date-time`', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const prop of eachProperty(d)) {
        const desc = typeof prop.schema.description === 'string' ? prop.schema.description : '';
        if (!PROMISES_ISO_8601.test(desc) || !admitsString(prop.schema)) continue;
        if (prop.schema.format !== 'date-time') bad.push(`${d.name} $.${prop.path}`);
      }
    }
    expect(
      bad,
      'string fields whose description promises an ISO-8601 instant but whose schema does not '
        + `say so. Add the name to COMMON_FORMATS in src/declarations/field-glossary.ts: ${bad.join(', ')}`,
    ).toEqual([]);
  });

  it('every URL-named string field declares `format: uri`', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const prop of eachProperty(d)) {
        if (!URL_FIELD.test(prop.name) || !admitsString(prop.schema)) continue;
        if (prop.schema.format !== 'uri') bad.push(`${d.name} $.${prop.path}`);
      }
    }
    expect(
      bad,
      'URL-named string fields with no `format: uri`. Add the name to COMMON_FORMATS in '
        + `src/declarations/field-glossary.ts: ${bad.join(', ')}`,
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Ratchets. Neither of the two below can be closed from inside this repo —
  // both need the producer to confirm what it actually sends — so each carries
  // its grandfathered set and fails only on something NEW.
  // -------------------------------------------------------------------------

  it('no NEW discrete counter is typed `number` instead of `integer` with `minimum: 0`', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const prop of eachProperty(d)) {
        if (!DISCRETE_COUNTER_FIELDS.has(prop.name)) continue;
        const key = `${d.name} $.${prop.path}`;
        if (NUMERIC_COUNTER_EXCEPTIONS.has(key)) continue;
        if (prop.schema.type !== 'integer') bad.push(`${key} is ${JSON.stringify(prop.schema.type)}, expected "integer"`);
        else if (prop.schema.minimum !== 0) bad.push(`${key} is integer but declares no \`minimum: 0\``);
      }
    }
    expect(
      bad,
      'counters that count discrete things must say so — `type: "integer", minimum: 0`. '
        + `Do NOT add to NUMERIC_COUNTER_EXCEPTIONS for something you just wrote: ${bad.join('; ')}`,
    ).toEqual([]);
  });

  it('no NEW field is typed `number` while its description promises an ISO-8601 string', () => {
    const bad: string[] = [];
    for (const d of allDeclarations) {
      for (const prop of eachProperty(d)) {
        const desc = typeof prop.schema.description === 'string' ? prop.schema.description : '';
        if (!PROMISES_ISO_8601.test(desc)) continue;
        if (prop.schema.type !== 'number' && prop.schema.type !== 'integer') continue;
        const key = `${d.name} $.${prop.path}`;
        if (!(key in TIMESTAMP_TYPE_CONTRADICTIONS)) bad.push(key);
      }
    }
    expect(
      bad,
      'the schema says a number and the prose says an ISO-8601 string — one of them lies. '
        + `Say epoch milliseconds in the description, or declare type "string": ${bad.join(', ')}`,
    ).toEqual([]);
  });

  it('every grandfathered numeric/timestamp exception still names a real property', () => {
    const live = new Set<string>();
    for (const d of allDeclarations) for (const p of eachProperty(d)) live.add(`${d.name} $.${p.path}`);
    const stale = [...NUMERIC_COUNTER_EXCEPTIONS, ...Object.keys(TIMESTAMP_TYPE_CONTRADICTIONS)]
      .filter((key) => !live.has(key));
    expect(stale, `exception entries for properties that no longer exist — delete them: ${stale.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The glossary itself — the mechanism that makes the description rule cheap
// to satisfy only works if it stays honest.
// ---------------------------------------------------------------------------

describe('field glossary', () => {
  it('every common-glossary entry describes a field that some event actually declares', () => {
    const declaredNames = new Set<string>();
    for (const d of allDeclarations) for (const p of eachProperty(d)) declaredNames.add(p.name);
    const unused = Object.keys(COMMON_FIELDS).filter((key) => !declaredNames.has(key.split('.').pop()!));
    expect(unused, `glossary entries no event uses — delete them: ${unused.join(', ')}`).toEqual([]);
  });

  it('every common-glossary description is a sentence, not a token', () => {
    const bad = Object.entries(COMMON_FIELDS)
      .filter(([, text]) => text.trim().length < MIN_PROPERTY_DESCRIPTION)
      .map(([key]) => key);
    expect(bad, `glossary entries too short to be useful: ${bad.join(', ')}`).toEqual([]);
  });

  it('every format-glossary entry stamps a field that some event actually declares as a string', () => {
    const stringFields = new Set<string>();
    for (const d of allDeclarations) {
      for (const p of eachProperty(d)) if (admitsString(p.schema)) stringFields.add(p.name);
    }
    const unused = Object.keys(COMMON_FORMATS).filter((key) => !stringFields.has(key.split('.').pop()!));
    expect(unused, `format-glossary entries no event uses as a string — delete them: ${unused.join(', ')}`).toEqual([]);
  });

  it('every format-glossary value is a JSON Schema format this repo actually means', () => {
    // Kept to the two the platform genuinely has. A new format here is a
    // deliberate vocabulary addition, not a drive-by.
    const allowed = new Set(['date-time', 'uri']);
    const bad = Object.entries(COMMON_FORMATS)
      .filter(([, format]) => !allowed.has(format))
      .map(([key, format]) => `${key}=${format}`);
    expect(bad, `unrecognized formats in COMMON_FORMATS: ${bad.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bundles — a bundle that names an undeclared event is a broken contract.
// ---------------------------------------------------------------------------

describe('feature bundles', () => {
  it('every event a bundle requires resolves to a declared event or alias', () => {
    const known = new Set<string>();
    for (const d of allDeclarations) {
      known.add(d.name);
      for (const alias of d.aliases ?? []) known.add(alias.name);
    }
    const bad: string[] = [];
    for (const bundle of allBundles) {
      for (const event of bundle.events) {
        if (!known.has(event.name)) bad.push(`${bundle.name} -> ${event.name}`);
      }
    }
    expect(bad, `bundles referencing undeclared events: ${bad.join(', ')}`).toEqual([]);
  });

  it('every bundle carries a description and a semver version', () => {
    const bad: string[] = [];
    for (const bundle of allBundles) {
      if ((bundle.description ?? '').trim().length < MIN_PROPERTY_DESCRIPTION) {
        bad.push(`${bundle.name}: description`);
      }
      if (!/^\d+\.\d+\.\d+$/.test(bundle.version)) bad.push(`${bundle.name}: version "${bundle.version}"`);
    }
    expect(bad, `bundle metadata problems: ${bad.join('; ')}`).toEqual([]);
  });

  it('every bundle name and version is unique (older pinned versions remain resolvable)', () => {
    const names = allBundles.map((b) => `${b.name}@${b.version}`);
    expect(new Set(names).size, `duplicate bundle names in ${names.join(', ')}`).toBe(names.length);
  });
});
