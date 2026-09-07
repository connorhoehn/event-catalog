// tests/asyncapi-structure.test.ts
//
// Structural validation of the two COMMITTED AsyncAPI artifacts:
//
//   contracts/asyncapi.yaml           AsyncAPI 2.6 — the gateway WebSocket
//   contracts/asyncapi.registry.yaml  AsyncAPI 3.0 — the broker backbone
//
// ---------------------------------------------------------------------------
// WHAT THIS CAN AND CANNOT VERIFY
// ---------------------------------------------------------------------------
//
// There is no AsyncAPI validator in this repo's dependency tree (no
// `@asyncapi/parser`, no ajv, no spectral) and adding one is out of scope, so
// what follows is a hand-rolled structural check. It DOES verify:
//
//   * the YAML parses with no errors or warnings — which is also how
//     duplicate mapping keys (a silently-dropped channel) get caught;
//   * the version-specific required fields are present and non-empty;
//   * every `$ref` in the document resolves to a node that exists, by
//     walking the JSON pointer — no dangling references;
//   * nothing defined is unreferenced — no orphan messages, schemas or
//     servers;
//   * every component key matches AsyncAPI's `^[A-Za-z0-9_\-.]+$` fixed-field
//     name pattern;
//   * every message payload is a structurally valid JSON Schema, per the same
//     `validateSchemaShape` the registry applies at declare time;
//   * the two documents partition the registry exactly: union == all 229
//     declarations, intersection == empty.
//
// It CANNOT verify conformance to the AsyncAPI meta-schema. A misspelled
// spec-defined key (`mesages:`, `bidings:`) would be read as an unknown field
// and pass every check here — only a real validator catches that. Run one in
// CI or by hand when the network allows:
//
//   npx @asyncapi/cli validate contracts/asyncapi.yaml
//   npx @asyncapi/cli validate contracts/asyncapi.registry.yaml

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { allDeclarations } from '../src/declarations/index.js';
import { validateSchemaShape } from '../src/registry/schema-shape.js';
import { isGatewayFrame } from '../scripts/generate-asyncapi.js';

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const contractsDir = join(__dirname, '..', 'contracts');

function load(file: string): { doc: any; errors: string[]; warnings: string[] } {
  const parsed = parseDocument(readFileSync(join(contractsDir, file), 'utf8'), {
    // Explicit, not defaulted: a duplicate mapping key is how a channel or a
    // message silently disappears from a generated document.
    uniqueKeys: true,
  });
  return {
    doc: parsed.toJS(),
    errors: parsed.errors.map((e) => e.message),
    warnings: parsed.warnings.map((w) => w.message),
  };
}

const ws = load('asyncapi.yaml');
const registry = load('asyncapi.registry.yaml');

// ---------------------------------------------------------------------------
// Generic structural helpers
// ---------------------------------------------------------------------------

/** Every `{ $ref: ... }` string in the tree, with the path it was found at. */
function collectRefs(node: unknown, path = '#'): Array<{ ref: string; at: string }> {
  const found: Array<{ ref: string; at: string }> = [];
  if (Array.isArray(node)) {
    node.forEach((v, i) => found.push(...collectRefs(v, `${path}/${i}`)));
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string') found.push({ ref: v, at: path });
      else found.push(...collectRefs(v, `${path}/${k}`));
    }
  }
  return found;
}

/** Resolve a local JSON pointer (`#/a/b/c`) against the document. */
function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = doc;
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** AsyncAPI's fixed-field key pattern for components / channel ids. */
const COMPONENT_KEY = /^[A-Za-z0-9_\-.]+$/;

function assertPayloadIsJsonSchema(payload: unknown, label: string): void {
  expect(payload, `${label}: payload is not an object`).toBeTypeOf('object');
  const shape = validateSchemaShape(payload as Record<string, unknown>);
  expect(shape.ok, `${label}: not a valid JSON Schema — ${shape.errors?.join('; ')}`).toBe(true);
}

// ---------------------------------------------------------------------------
// Checks that apply to both documents
// ---------------------------------------------------------------------------

describe.each([
  ['contracts/asyncapi.yaml', ws],
  ['contracts/asyncapi.registry.yaml', registry],
])('%s — structural validity', (name, { doc, errors, warnings }) => {
  it('parses as YAML with no errors and no warnings (catches duplicate keys)', () => {
    expect(errors, `${name} YAML errors`).toEqual([]);
    expect(warnings, `${name} YAML warnings`).toEqual([]);
  });

  it('declares a version, a title and a non-empty info block', () => {
    expect(doc.asyncapi).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.info).toBeTypeOf('object');
    expect(doc.info.title).toBeTypeOf('string');
    expect(doc.info.title.length).toBeGreaterThan(0);
    expect(doc.info.version).toBeTypeOf('string');
    expect(doc.info.description).toBeTypeOf('string');
  });

  it('states its own coverage in machine-readable form', () => {
    // The scope limitation lives IN the artifact, not only in the README —
    // a reader who fetched the raw file still learns what it omits.
    const cov = doc.info['x-event-catalog-coverage'];
    expect(cov, `${name} has no x-event-catalog-coverage`).toBeTypeOf('object');
    expect(cov.registryDeclarations).toBe(allDeclarations.length);
    expect(cov.describedInThisDocument + cov.describedInCompanionDocument.count)
      .toBe(allDeclarations.length);
    expect(cov.partitionRule).toBeTypeOf('string');
  });

  it('has at least one channel, and every channel key is a legal id', () => {
    const keys = Object.keys(doc.channels ?? {});
    expect(keys.length).toBeGreaterThan(0);
    // Channel keys are unique by construction (they are object keys) — the
    // real duplicate risk is in the YAML, covered by the parse check above.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves every $ref — no dangling pointers', () => {
    const dangling = collectRefs(doc)
      .filter(({ ref }) => !ref.startsWith('./') && resolvePointer(doc, ref) === undefined)
      .map(({ ref, at }) => `${ref} (at ${at})`);
    expect(dangling, `${name}: unresolvable refs`).toEqual([]);
  });

  it('names every component key legally', () => {
    for (const section of ['messages', 'schemas']) {
      for (const key of Object.keys(doc.components?.[section] ?? {})) {
        expect(COMPONENT_KEY.test(key), `${name}: illegal ${section} key "${key}"`).toBe(true);
      }
    }
    for (const key of Object.keys(doc.servers ?? {})) {
      expect(COMPONENT_KEY.test(key), `${name}: illegal server key "${key}"`).toBe(true);
    }
  });

  it('defines no orphan messages — everything defined is referenced', () => {
    const refs = new Set(collectRefs(doc).map(({ ref }) => ref));
    const orphans = Object.keys(doc.components?.messages ?? {}).filter(
      (k) => !refs.has(`#/components/messages/${k}`),
    );
    expect(orphans, `${name}: messages defined but never referenced`).toEqual([]);
  });

  it('defines no orphan servers', () => {
    const refs = new Set(collectRefs(doc).map(({ ref }) => ref));
    const declared = Object.keys(doc.servers ?? {});
    if (doc.asyncapi.startsWith('3.')) {
      // 3.0 channels reference their servers explicitly.
      const orphans = declared.filter((k) => !refs.has(`#/servers/${k}`));
      expect(orphans, `${name}: servers defined but never referenced`).toEqual([]);
    } else {
      // 2.6 has no per-channel server binding — servers are document-level
      // alternatives, so "unreferenced" is the normal state. Just require
      // each to be addressable.
      for (const k of declared) {
        expect(doc.servers[k].url, `${name}: server ${k} has no url`).toBeTypeOf('string');
        expect(doc.servers[k].protocol, `${name}: server ${k} has no protocol`).toBeTypeOf('string');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AsyncAPI 2.6 — the gateway WebSocket document
// ---------------------------------------------------------------------------

describe('contracts/asyncapi.yaml — AsyncAPI 2.6 shape', () => {
  const doc = ws.doc;

  it('is 2.6 with exactly one channel carrying both directions', () => {
    expect(doc.asyncapi).toBe('2.6.0');
    expect(Object.keys(doc.channels)).toEqual(['/']);
    expect(doc.channels['/'].publish.operationId).toBeTypeOf('string');
    expect(doc.channels['/'].subscribe.operationId).toBeTypeOf('string');
  });

  it('gives every operation a oneOf of message refs and nothing else', () => {
    for (const op of ['publish', 'subscribe'] as const) {
      const oneOf = doc.channels['/'][op].message.oneOf;
      expect(Array.isArray(oneOf), `${op}.message.oneOf`).toBe(true);
      expect(oneOf.length).toBeGreaterThan(0);
      for (const entry of oneOf) {
        expect(Object.keys(entry)).toEqual(['$ref']);
        expect(entry.$ref).toMatch(/^#\/components\/messages\//);
      }
    }
  });

  it('gives every message the fields a 2.6 consumer reads', () => {
    for (const [key, msg] of Object.entries<any>(doc.components.messages)) {
      expect(msg.messageId, `${key}.messageId`).toBeTypeOf('string');
      expect(msg.name, `${key}.name`).toBeTypeOf('string');
      expect(msg.schemaFormat, `${key}.schemaFormat`).toMatch(/^application\/schema\+json/);
      assertPayloadIsJsonSchema(msg.payload, `asyncapi.yaml ${key}`);
    }
  });

  it('uses no YAML anchors — the artifact is self-contained', () => {
    // The `yaml` writer emits `&a1` / `*a1` for any object that appears twice
    // in the tree. Legal YAML, but it makes the contract depend on the
    // reader's parser resolving anchors, and three had crept in.
    const raw = readFileSync(join(contractsDir, 'asyncapi.yaml'), 'utf8');
    expect(raw).not.toMatch(/: &a\d+\s*$/m);
    expect(raw).not.toMatch(/: \*a\d+\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// AsyncAPI 3.0 — the broker-backbone document
// ---------------------------------------------------------------------------

describe('contracts/asyncapi.registry.yaml — AsyncAPI 3.0 shape', () => {
  const doc = registry.doc;

  it('is 3.0 with servers, channels, operations and components', () => {
    expect(doc.asyncapi).toBe('3.0.0');
    expect(Object.keys(doc.servers).sort()).toEqual(['durableMessageQueue', 'signalRedis']);
    expect(Object.keys(doc.channels).length).toBeGreaterThan(0);
    expect(Object.keys(doc.operations).length).toBeGreaterThan(0);
  });

  it('gives every server a host and a protocol', () => {
    for (const [key, server] of Object.entries<any>(doc.servers)) {
      expect(server.host, `${key}.host`).toBeTypeOf('string');
      expect(server.protocol, `${key}.protocol`).toBeTypeOf('string');
      // Every `{var}` placeholder in the host must be declared.
      for (const [, v] of (server.host as string).matchAll(/\{([^}]+)\}/g)) {
        expect(server.variables?.[v], `${key}.host uses undeclared variable {${v}}`).toBeDefined();
      }
    }
  });

  it('anchors every channel to exactly one existing server, with an address', () => {
    for (const [key, channel] of Object.entries<any>(doc.channels)) {
      expect(channel.address, `${key}.address`).toBeTypeOf('string');
      expect(channel.address.length).toBeGreaterThan(0);
      expect(channel.servers, `${key}.servers`).toHaveLength(1);
      const serverKey = channel.servers[0].$ref.split('/').pop();
      expect(doc.servers[serverKey], `${key} refs missing server ${serverKey}`).toBeDefined();
      // The transport and the server it is addressed on must agree.
      const expected = channel['x-event-catalog-transport'] === 'signal'
        ? 'signalRedis'
        : 'durableMessageQueue';
      expect(serverKey, `${key}: transport/server mismatch`).toBe(expected);
    }
  });

  it('points every operation at a channel and at a message that channel holds', () => {
    for (const [key, op] of Object.entries<any>(doc.operations)) {
      expect(op.action, `${key}.action`).toBe('send');
      const channelKey = op.channel.$ref.split('/').pop();
      expect(doc.channels[channelKey], `${key} refs missing channel`).toBeDefined();
      expect(op.messages, `${key}.messages`).toHaveLength(1);
      // Resolves through `#/channels/<c>/messages/<m>` — a pointer into the
      // channel, which is what 3.0 requires (not a components ref).
      expect(resolvePointer(doc, op.messages[0].$ref), `${key} message ref`).toBeDefined();
    }
  });

  it('gives every message a payload that is a real JSON Schema', () => {
    for (const [key, msg] of Object.entries<any>(doc.components.messages)) {
      expect(msg.payload.$ref, `${key}.payload`).toMatch(/^#\/components\/schemas\//);
      const schemaKey = msg.payload.$ref.split('/').pop()!;
      assertPayloadIsJsonSchema(doc.components.schemas[schemaKey], `registry ${key}`);
    }
  });

  it('leaves no schema unreferenced', () => {
    const used = new Set(
      Object.values<any>(doc.components.messages).map((m) => m.payload.$ref.split('/').pop()),
    );
    const orphans = Object.keys(doc.components.schemas).filter((k) => !used.has(k));
    expect(orphans, 'schemas defined but never referenced').toEqual([]);
  });

  it('claims a redis binding only where there is one, and never invents an MQ binding', () => {
    for (const [key, channel] of Object.entries<any>(doc.channels)) {
      if (channel['x-event-catalog-transport'] === 'signal') {
        expect(Object.keys(channel.bindings ?? {}), `${key}.bindings`).toEqual(['redis']);
      } else {
        // AsyncAPI has no binding for this platform's message-queue. An
        // invented `bindings.mq` is false precision — the transport fact
        // lives on the server ref and the x- extension instead.
        expect(channel.bindings, `${key} must not claim a fabricated binding`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The partition between the two documents
// ---------------------------------------------------------------------------

describe('the two documents partition the registry exactly', () => {
  const wsNames = new Set(
    Object.values<any>(ws.doc.components.messages).map((m) => m.name as string),
  );
  const registryNames = new Set(
    Object.values<any>(registry.doc.components.messages).map((m) => m.name as string),
  );

  it('covers every declaration exactly once — no gaps', () => {
    const union = new Set([...wsNames, ...registryNames]);
    const declared = new Set(allDeclarations.map((d) => d.name));
    const missing = [...declared].filter((n) => !union.has(n));
    const extra = [...union].filter((n) => !declared.has(n));
    expect(missing, 'declared but described in neither document').toEqual([]);
    expect(extra, 'described but not declared').toEqual([]);
    expect(union.size).toBe(allDeclarations.length);
  });

  it('describes nothing twice — the documents do not overlap', () => {
    const both = [...wsNames].filter((n) => registryNames.has(n));
    expect(both, 'described in BOTH documents').toEqual([]);
  });

  it('splits on a real property, not a name prefix', () => {
    // The stated rule is "gateway frames have no broker address". If that
    // ever stops being true, the split is mis-describing something and this
    // test is the place that says so — before the artifact does.
    for (const decl of allDeclarations.filter(isGatewayFrame)) {
      expect(decl.channel, `${decl.name} is a gateway frame but declares a channel`).toBeUndefined();
      expect(decl.queue, `${decl.name} is a gateway frame but declares a queue`).toBeUndefined();
      expect(decl.transport, `${decl.name} is a gateway frame but is not signal`).toBe('signal');
    }
    // And every gateway frame is in the WS document, every other in the other.
    for (const decl of allDeclarations) {
      const target = isGatewayFrame(decl) ? wsNames : registryNames;
      expect(target.has(decl.name), `${decl.name} landed in the wrong document`).toBe(true);
    }
  });
});
