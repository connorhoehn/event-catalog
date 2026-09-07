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
// KNOWN GAPS, DELIBERATELY NOT ENFORCED (2026-09-07 audit)
//
// Each of these is a real hygiene defect. None is fixed here, and none has a
// rule below, because closing it would NARROW an existing schema — rejecting
// payloads that validate today — which is a breaking contract change for a
// live producer. They are recorded here so the next person does not have to
// re-derive them. Fixing one is a versioned, coordinated change.
//
//  1. ~136 timestamp strings carry no `format: 'date-time'` — every `at`,
//     `timestamp`, `startedAt`, `openedAt`, `lastEventAt`, `joinedAt`,
//     `expiresAt`, `emittedAt`, `lastSeen`, `lastHeartbeat`. distributed-core's
//     JsonSchemaValidator hands off to ajv when ajv is installed, so a `format`
//     is enforced, not annotative.
//  2. 4 URL strings carry no `format: 'uri'`:
//     transcription:transcript.ready $.transcriptUrl,
//     ws.upload.url-issued $.data.presignedUrl,
//     ws.upload.completed $.data.downloadUrl,
//     ws.call.recording-completed $.data.downloadUrl.
//  3. 20 counters/durations are `number` where `integer` + `minimum: 0` is
//     meant — durationMs, latencyMs, attemptNumber, nextBackoffMs, seq,
//     sequenceNumber, tokensIn/Out, size, summaryChars, speakerCount.
//  4. 36 properties are `type: 'object'` with no `properties` at all — the
//     shape lives only in a prose description. Worst offenders are the ones a
//     UI renders directly: pipeline:judge:scored $.result,
//     pipeline:image:vision:analyzed $.result, ws.cursor.update $.cursor,
//     ws.presence.update $.presence, ws.pipeline.event $.payload.
//  5. 7 nested objects declare `properties` but no `required`, so every field
//     is optional by omission rather than by decision: $.usage on
//     pipeline:judge:scored + pipeline:image:vision:analyzed, and $.data on
//     ws.call.{invite,accepted,declined,cancelled,ended}.
//  6. 2 arrays have no `items` schema: transcription:job.queued $.tracks and
//     transcription:transcript.ready $.languages.
//  7. Bare strings that are closed value sets elsewhere in the registry:
//     `slot.status` is an enum on pipeline:raft:run:terminated but a free
//     string on the other four raft events; `status` on client.presence.set
//     and ws.presence.joined $.client names the PresenceStatus values in prose
//     only; `mode` on the two pipeline:step:context.patched* events;
//     `$.data.status` on ws.upload.scanned.
//  8. 189 of 194 root schemas are `additionalProperties: true`. Several are
//     genuinely closed contracts (the ag-ui protocol events, call:caption:line)
//     and should be `false`, but closing them rejects any extra field a
//     producer sends today.
//  9. Naming: see the three allowlists below — 13 events whose names break
//     their namespace's convention. Renaming an event is the most breaking
//     change available, so they stand.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { allDeclarations } from '../src/declarations/index.js';
import { allBundles } from '../src/declarations/bundles/index.js';
import { COMMON_FIELDS } from '../src/declarations/field-glossary.js';
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
};

/** Events with a camelCase segment where the namespace otherwise uses lower-kebab. */
const SEGMENT_CASE_EXCEPTIONS: Record<string, string> = {
  'pipeline:run:resumeFromStep': 'Gateway-local stub whose name mirrors the handleResumeFromStep handler; on the wire today.',
  'client.reaction.getAvailable': 'Name mirrors the gateway ReactionService `action` string verbatim — ground truth, not style.',
  'client.activity.getHistory': 'Name mirrors the gateway ActivityService `action` string verbatim — ground truth, not style.',
};

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
      for (const prop of eachProperty(d)) {
        if (!LOWER_CAMEL_FIELD.test(prop.name)) bad.push(`${d.name} $.${prop.path}`);
      }
    }
    expect(bad, `payload fields that are not lowerCamelCase: ${bad.join(', ')}`).toEqual([]);
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

  it('every bundle name is unique', () => {
    const names = allBundles.map((b) => b.name);
    expect(new Set(names).size, `duplicate bundle names in ${names.join(', ')}`).toBe(names.length);
  });
});
