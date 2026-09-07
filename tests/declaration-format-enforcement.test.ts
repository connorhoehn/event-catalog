// tests/declaration-format-enforcement.test.ts
//
// Empirical answer to the question that gates every `format` annotation in
// `src/declarations/`: does a `format` keyword in a declared schema actually
// REJECT a payload at publish time, or is it purely documentary?
//
// The 2026-09-07 hygiene audit assumed it was enforcing ("distributed-core's
// JsonSchemaValidator hands off to ajv when ajv is installed, so a `format` is
// enforced, not annotative") and therefore refused to add ~140 `format`
// annotations. This file tests that assumption instead of restating it, by
// driving a payload through the SAME code path a real publish uses:
//
//     EventCatalogClient.publish()
//       -> Registry.validate(name, payload)          (src/registry/index.ts:417)
//         -> JsonSchemaValidator.validate(...)       ({ mode: 'auto' })
//
// The findings, as of distributed-core b6f38f5:
//
//   * `ajv` is not installed — not a dependency of this repo, not a dependency
//     of distributed-core (which documents "The library MUST NOT depend on
//     `ajv` at runtime"), and not present transitively.
//   * With `mode: 'auto'` and no ajv, JsonSchemaValidator uses its hand-rolled
//     fallback, whose keyword coverage is exactly: type, enum, properties,
//     required, pattern, items, additionalProperties, minimum, maximum,
//     minLength, maxLength, minItems, maxItems. `format` is not among them,
//     and neither is `multipleOf`, `exclusiveMinimum`, `const`, `oneOf`,
//     `anyOf`, `allOf`, `not`, or `$ref`.
//   * Therefore `format` is inert on this path: adding it to a live schema
//     cannot reject a payload that validates today.
//
// The tests below assert all of that, so that if someone later installs `ajv`
// (which WOULD change the answer — and, without `ajv-formats` registered,
// would make ajv v8 throw "unknown format" at compile time and fail EVERY
// payload for the affected event, not just malformed ones) this file fails
// loudly and the ~140 annotations get revisited before they bite.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { JsonSchemaValidator } from 'distributed-core/messaging-queue';
import { Registry } from '../src/registry/index.js';
import type { EventDeclaration } from '../src/types/index.js';

const require_ = createRequire(import.meta.url);

/** Resolve a module the way distributed-core's `eval('require')('ajv')` would. */
function isInstalled(spec: string): boolean {
  try {
    require_.resolve(spec);
    return true;
  } catch {
    return false;
  }
}

describe('format enforcement — is `format` a contract or a comment?', () => {
  it('ajv is not installed, so JsonSchemaValidator runs its hand-rolled fallback', () => {
    expect(isInstalled('ajv'), 'ajv resolved — the fallback assumption no longer holds').toBe(false);
    expect(isInstalled('ajv-formats'), 'ajv-formats resolved unexpectedly').toBe(false);
  });

  it('a `format: date-time` violation is NOT reported by the validator directly', () => {
    const validator = new JsonSchemaValidator({ mode: 'auto' });
    const schema = {
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
      required: ['at'],
      additionalProperties: true,
    };
    expect(validator.validate(schema, { at: 'not-a-timestamp-at-all' }).ok).toBe(true);
    expect(validator.validate(schema, { at: '2026-09-07T12:00:00.000Z' }).ok).toBe(true);
    // Still type-checked — `format` narrows nothing, `type` still does.
    expect(validator.validate(schema, { at: 12345 }).ok).toBe(false);
  });

  it('a `format: uri` violation is NOT reported by the validator directly', () => {
    const validator = new JsonSchemaValidator({ mode: 'auto' });
    const schema = {
      type: 'object',
      properties: { downloadUrl: { type: 'string', format: 'uri' } },
      required: [],
      additionalProperties: true,
    };
    expect(validator.validate(schema, { downloadUrl: 'definitely not a url' }).ok).toBe(true);
  });

  it('a `format` violation passes the real Registry.validate() publish path', () => {
    const registry = new Registry();
    const decl: EventDeclaration = {
      name: 'probe:format.date-time',
      namespace: 'probe',
      description: 'Probe declaration used only to test whether `format` is asserted at publish time.',
      producer: 'test',
      transport: 'signal',
      tags: ['test'],
      schema: {
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time', description: 'ISO-8601 timestamp under test.' },
          url: { type: 'string', format: 'uri', description: 'URL under test.' },
        },
        required: ['at'],
        additionalProperties: true,
      },
    } as EventDeclaration;
    registry.declare(decl);

    // The exact shape a producer sends today for a field we would annotate.
    const nonConforming = registry.validate('probe:format.date-time', {
      at: '2026-09-07 12:00:00',        // space separator, not ISO-8601 'T'
      url: 'not a uri',
    });
    expect(nonConforming.valid, JSON.stringify(nonConforming.errors)).toBe(true);

    // Epoch-millis-as-number is rejected, but by `type`, not by `format`.
    expect(registry.validate('probe:format.date-time', { at: 1_757_246_400_000 }).valid).toBe(false);
  });

  it('adding a `format` to an existing schema is a backward-compatible change', () => {
    // The registry's own compat gate is what decides whether a re-declare is
    // accepted. It reasons about `required`, not about string sub-formats, so
    // annotating a field cannot flip an event to incompatible.
    const registry = new Registry();
    const base: EventDeclaration = {
      name: 'probe:format.compat',
      namespace: 'probe',
      description: 'Probe declaration used only to test compat of adding a format annotation.',
      producer: 'test',
      transport: 'signal',
      tags: ['test'],
      compatibilityMode: 'full',
      schema: {
        type: 'object',
        properties: { at: { type: 'string', description: 'ISO-8601 timestamp under test.' } },
        required: ['at'],
        additionalProperties: true,
      },
    } as EventDeclaration;
    registry.declare(base);

    const annotated = registry.declare({
      ...base,
      schema: {
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time', description: 'ISO-8601 timestamp under test.' },
        },
        required: ['at'],
        additionalProperties: true,
      },
    } as EventDeclaration);
    expect(annotated.compatible, (annotated.violations ?? []).join('; ')).toBe(true);
  });
});

describe('keyword coverage of the fallback validator', () => {
  // Documents exactly which keywords the fallback honours, so the hygiene
  // rules know which narrowings are real and which are decorative. A rule
  // that "enforces" an inert keyword is a rule that enforces nothing.
  const validator = new JsonSchemaValidator({ mode: 'auto' });
  const rejects = (schema: object, payload: unknown): boolean =>
    !validator.validate(schema, payload).ok;

  it('honours type, including integer vs number', () => {
    expect(rejects({ type: 'integer' }, 1.5)).toBe(true);
    expect(rejects({ type: 'integer' }, 2)).toBe(false);
    expect(rejects({ type: 'number' }, 1.5)).toBe(false);
  });

  it('honours minimum / maximum / minLength / maxLength / pattern / enum', () => {
    expect(rejects({ type: 'number', minimum: 0 }, -1)).toBe(true);
    expect(rejects({ type: 'number', maximum: 1 }, 2)).toBe(true);
    expect(rejects({ type: 'string', minLength: 2 }, 'a')).toBe(true);
    expect(rejects({ type: 'string', maxLength: 1 }, 'ab')).toBe(true);
    expect(rejects({ type: 'string', pattern: '^a' }, 'b')).toBe(true);
    expect(rejects({ enum: ['a', 'b'] }, 'c')).toBe(true);
  });

  it('honours required, additionalProperties: false, and nested properties', () => {
    expect(rejects({ type: 'object', required: ['a'] }, {})).toBe(true);
    expect(rejects({ type: 'object', properties: { a: {} }, additionalProperties: false }, { b: 1 })).toBe(true);
    expect(rejects({ type: 'object', properties: { a: { type: 'string' } } }, { a: 1 })).toBe(true);
  });

  it('IGNORES format, multipleOf, exclusiveMinimum, const, and the *Of combinators', () => {
    // Each of these SHOULD reject under full JSON Schema. None does here.
    const inert: [string, object, unknown][] = [
      ['format', { type: 'string', format: 'date-time' }, 'nope'],
      ['multipleOf', { type: 'number', multipleOf: 5 }, 3],
      ['exclusiveMinimum', { type: 'number', exclusiveMinimum: 0 }, 0],
      ['const', { const: 'a' }, 'b'],
      ['oneOf', { oneOf: [{ type: 'string' }] }, 1],
      ['anyOf', { anyOf: [{ type: 'string' }] }, 1],
      ['allOf', { allOf: [{ type: 'string' }] }, 1],
      ['not', { not: { type: 'string' } }, 'a'],
    ];
    const enforced = inert.filter(([, schema, payload]) => rejects(schema, payload)).map(([k]) => k);
    expect(
      enforced,
      `keywords that became enforcing — the hygiene audit's assumptions need rechecking: ${enforced.join(', ')}`,
    ).toEqual([]);
  });

  it('does NOT descend into additionalProperties-as-schema for declared properties', () => {
    // Sanity: the fallback only applies the additionalProperties schema to
    // keys NOT in `properties`. Worth pinning because the audit reasons about
    // open-vs-closed roots.
    expect(rejects({ type: 'object', properties: {}, additionalProperties: { type: 'string' } }, { x: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The rest of the known-gaps list, held to the same standard.
//
// `format` turned out to be free. The reflex is to assume the neighbouring
// items are too. They are not, and this block is where that is settled rather
// than argued — each test names a gap from the hygiene file's header and shows
// what the validator would actually do if it were "fixed".
// ---------------------------------------------------------------------------

describe('would the other known gaps narrow a live schema?', () => {
  const validator = new JsonSchemaValidator({ mode: 'auto' });
  const rejects = (schema: object, payload: unknown): boolean =>
    !validator.validate(schema, payload).ok;

  it('gap 3 — number -> integer IS enforced, so retyping counters is breaking', () => {
    // A producer sending 12.5 for durationMs validates today and would stop.
    // Timing fields are the live risk: performance.now() and Date.now() deltas
    // measured with a high-resolution clock are legitimately fractional.
    expect(rejects({ type: 'number' }, 12.5)).toBe(false);
    expect(rejects({ type: 'integer' }, 12.5)).toBe(true);
  });

  it('gap 3 — `minimum: 0` IS enforced, so adding it to a counter is breaking', () => {
    expect(rejects({ type: 'number' }, -1)).toBe(false);
    expect(rejects({ type: 'number', minimum: 0 }, -1)).toBe(true);
  });

  it('gap 4 — adding TYPED `properties` to a bare object IS enforced, so it narrows', () => {
    // The hygiene header reasons that adding `properties` without `required`,
    // with `additionalProperties` left open, is purely documentary. That is
    // false here: the fallback validator descends into every declared property
    // that is PRESENT in the payload and applies its sub-schema. A field the
    // producer sends with a different runtime type starts failing.
    const bare = { type: 'object', description: 'shape lives in prose' };
    const typed = { type: 'object', properties: { score: { type: 'number' } } };
    expect(rejects(bare, { score: 'high' })).toBe(false);
    expect(rejects(typed, { score: 'high' })).toBe(true);
  });

  it('gap 4 — adding DESCRIPTION-ONLY `properties` is inert, and is the safe half of that fix', () => {
    // A sub-schema carrying only a `description` asserts no keyword, so the
    // fallback validates nothing against it. This documents field names in the
    // generated AsyncAPI at zero contract risk — it is the migration's step 1.
    const described = {
      type: 'object',
      properties: { score: { description: 'Overall score assigned by the judge.' } },
    };
    expect(rejects(described, { score: 'high' })).toBe(false);
    expect(rejects(described, { score: 0.4 })).toBe(false);
    expect(rejects(described, {})).toBe(false);
  });

  it('gap 5 — adding `required` to a nested object IS enforced, so it narrows', () => {
    expect(rejects({ type: 'object', properties: { a: {} } }, {})).toBe(false);
    expect(rejects({ type: 'object', properties: { a: {} }, required: ['a'] }, {})).toBe(true);
  });

  it('gap 6 — adding a typed `items` to an untyped array IS enforced, so it narrows', () => {
    expect(rejects({ type: 'array' }, [1, 2])).toBe(false);
    expect(rejects({ type: 'array', items: { type: 'string' } }, [1, 2])).toBe(true);
  });

  it('gap 7 — adding an `enum` to a free string IS enforced, so it narrows', () => {
    expect(rejects({ type: 'string' }, 'anything')).toBe(false);
    expect(rejects({ type: 'string', enum: ['a', 'b'] }, 'anything')).toBe(true);
  });

  it('gap 8 — closing a root with `additionalProperties: false` IS enforced, so it narrows', () => {
    const open = { type: 'object', properties: { a: {} }, additionalProperties: true };
    const closed = { type: 'object', properties: { a: {} }, additionalProperties: false };
    expect(rejects(open, { a: 1, extra: 2 })).toBe(false);
    expect(rejects(closed, { a: 1, extra: 2 })).toBe(true);
  });
});
