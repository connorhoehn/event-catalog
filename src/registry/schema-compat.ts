// src/registry/schema-compat.ts
//
// The schema-evolution gate. `Registry.declare()` and POST /events run every
// schema change through here; strict mode turns a violation into a thrown
// error, so this file is the thing that actually makes "we refuse breaking
// changes" true.
//
// ── What "breaking" means here ────────────────────────────────────────────
//
// Breakage is judged against the validator that actually runs at publish
// time: `JsonSchemaValidator` from distributed-core. `ajv` is NOT a
// dependency of this repo, so the hand-rolled fallback is what executes, and
// it honours exactly these keywords:
//
//   type, enum, properties, required, pattern, items,
//   additionalProperties, minimum, maximum, minLength, maxLength,
//   minItems, maxItems
//
// Everything else (`format`, `exclusiveMinimum`, `multipleOf`, `oneOf`,
// `anyOf`, `allOf`, `not`, `$ref`, `const`, `uniqueItems`, `propertyNames`,
// `patternProperties`, tuple-form `items`) is inert at publish time, so a
// compat rule about it would reject deploys over a constraint nothing
// enforces. We deliberately do not write those rules.
//
// The walk is RECURSIVE: `properties`, `items` and schema-form
// `additionalProperties` are descended, because the validator descends them
// too. A `required` added three levels deep rejects old payloads exactly as
// hard as one added at the root.
//
// ── The one asymmetry worth knowing ───────────────────────────────────────
//
// Adding a NEW property is never reported, in either direction, even though
// a schema with `additionalProperties` open technically accepted any value
// at that key before. Adding an optional field is the canonical safe
// evolution and every registry in the industry treats it as such; flagging
// it would make the gate unusable.

import { stableStringify } from './fingerprint';

export interface CompatResult {
  compatible: boolean;
  violations: string[];
}

type JsonSchema = Record<string, unknown>;

/** Guard against pathological / self-referential schema documents. */
const MAX_DEPTH = 16;

/**
 * A single place where the `to` schema accepts strictly fewer values than
 * the `from` schema. Rendered into a backward- or forward-flavoured message
 * by `render()`, which knows that a narrowing found while walking
 * (old → new) reads as "narrowed" and one found while walking (new → old)
 * reads as "widened".
 */
interface Narrowing {
  kind:
    | 'type'
    | 'enum'
    | 'required'
    | 'property-removed'
    | 'additional-properties'
    | 'pattern'
    | 'bound';
  /** Dotted path to the sub-schema, '' for the root. */
  path: string;
  /** Human-readable description of the `from` side. */
  from: string;
  /** Human-readable description of the `to` side. */
  to: string;
  /** For `required` / `property-removed`: the field name. */
  field?: string;
  /** For `bound`: which keyword moved. */
  keyword?: string;
  /** True when the field did not exist in `from.properties` at all. */
  brandNew?: boolean;
}

// ─── small helpers ────────────────────────────────────────────────────────

function asSchema(v: unknown): JsonSchema | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as JsonSchema;
}

function getProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const p = schema.properties;
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return {};
  return p as Record<string, JsonSchema>;
}

function getRequired(schema: JsonSchema): string[] {
  return Array.isArray(schema.required) ? (schema.required as string[]) : [];
}

function getType(schema: JsonSchema): string | string[] {
  const t = schema.type;
  if (typeof t === 'string' || Array.isArray(t)) return t;
  return 'any';
}

function normalizeType(t: string | string[]): string[] {
  if (Array.isArray(t)) return [...(t as string[])].sort();
  return [t];
}

/**
 * Does `wider` accept every JSON value `narrower` accepts, type-wise?
 *
 * `'any'` is the absence of a `type` keyword — it subsumes everything and is
 * subsumed by nothing. `integer` is a strict subset of `number` in the
 * fallback validator (`matchesType('number', 3)` is true), so widening
 * integer → number is safe and must not be reported.
 */
function typeSubsumes(wider: string[], narrower: string[]): boolean {
  if (wider.includes('any')) return true;
  if (narrower.includes('any')) return false;
  return narrower.every(
    (t) => wider.includes(t) || (t === 'integer' && wider.includes('number')),
  );
}

function renderTypes(t: string[]): string {
  return t.join(',');
}

function joinPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`;
}

/** Path used in messages — the root schema itself has no field name. */
function label(path: string): string {
  return path === '' ? '<root>' : path;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** `additionalProperties` as a three-state: open / closed / constrained. */
function apState(schema: JsonSchema): 'open' | 'closed' | 'schema' {
  const ap = schema.additionalProperties;
  if (ap === false) return 'closed';
  if (asSchema(ap)) return 'schema';
  return 'open';
}

// ─── the walk ─────────────────────────────────────────────────────────────

/**
 * Collect every place where `to` accepts strictly fewer values than `from`,
 * descending into nested objects, array items and schema-form
 * `additionalProperties`.
 *
 * Directionality lives entirely in the caller: walking (old → new) finds
 * backward-incompatible tightening; walking (new → old) finds the same
 * tightening in the old schema, which is exactly forward-incompatible
 * loosening in the new one.
 */
function collectNarrowings(
  from: JsonSchema,
  to: JsonSchema,
  path: string,
  depth: number,
  out: Narrowing[],
): void {
  if (depth > MAX_DEPTH) return;

  // ── type ────────────────────────────────────────────────────────────────
  const fromTypes = normalizeType(getType(from));
  const toTypes = normalizeType(getType(to));
  if (!typeSubsumes(toTypes, fromTypes)) {
    out.push({
      kind: 'type',
      path,
      from: renderTypes(fromTypes),
      to: renderTypes(toTypes),
    });
  }

  // ── enum ────────────────────────────────────────────────────────────────
  // The validator enforces `enum` by deep-equality, so dropping a member (or
  // introducing an enum where there was none) rejects payloads that used to
  // pass.
  const fromEnum = Array.isArray(from.enum) ? (from.enum as unknown[]) : undefined;
  const toEnum = Array.isArray(to.enum) ? (to.enum as unknown[]) : undefined;
  if (toEnum) {
    if (!fromEnum) {
      out.push({
        kind: 'enum',
        path,
        from: 'unconstrained',
        to: `[${toEnum.map((v) => JSON.stringify(v)).join(', ')}]`,
      });
    } else {
      // Membership, not a pairwise scan. This was
      // `fromEnum.filter(v => !toEnum.some(w => deepEqual(v, w)))` —
      // O(|from| × |to|) deep comparisons over two arrays that come
      // straight out of a declared schema, so a 1 MiB body carrying a
      // ~250k-member enum turned one `declare` into ~10¹⁰ comparisons.
      // `stableStringify` sorts object keys, which is exactly the
      // equality `deepEqual` implements (order-insensitive on objects,
      // order-sensitive on arrays), so the answer is unchanged.
      const toMembers = new Set(toEnum.map((w) => stableStringify(w)));
      const dropped = fromEnum.some((v) => !toMembers.has(stableStringify(v)));
      if (dropped) {
        out.push({
          kind: 'enum',
          path,
          from: `[${fromEnum.map((v) => JSON.stringify(v)).join(', ')}]`,
          to: `[${toEnum.map((v) => JSON.stringify(v)).join(', ')}]`,
        });
      }
    }
  }

  // ── pattern ─────────────────────────────────────────────────────────────
  // Regex containment is undecidable in general, so any change to `pattern`
  // that isn't a no-op counts as a tightening. Adding one to an
  // unconstrained string is unambiguously a tightening.
  const fromPattern = typeof from.pattern === 'string' ? from.pattern : undefined;
  const toPattern = typeof to.pattern === 'string' ? to.pattern : undefined;
  if (toPattern !== undefined && toPattern !== fromPattern) {
    out.push({
      kind: 'pattern',
      path,
      from: fromPattern === undefined ? 'unconstrained' : fromPattern,
      to: toPattern,
    });
  }

  // ── numeric / length / size bounds ──────────────────────────────────────
  // Lower bounds tighten by going up; upper bounds tighten by coming down.
  // Introducing a bound where there was none always tightens.
  for (const kw of ['minimum', 'minLength', 'minItems'] as const) {
    const f = num(from[kw]);
    const t = num(to[kw]);
    if (t !== undefined && (f === undefined || t > f)) {
      out.push({
        kind: 'bound',
        path,
        keyword: kw,
        from: f === undefined ? 'unconstrained' : String(f),
        to: String(t),
      });
    }
  }
  for (const kw of ['maximum', 'maxLength', 'maxItems'] as const) {
    const f = num(from[kw]);
    const t = num(to[kw]);
    if (t !== undefined && (f === undefined || t < f)) {
      out.push({
        kind: 'bound',
        path,
        keyword: kw,
        from: f === undefined ? 'unconstrained' : String(f),
        to: String(t),
      });
    }
  }

  // ── additionalProperties ────────────────────────────────────────────────
  // open → closed rejects every payload that carried an extra key. open →
  // schema constrains those keys. closed → anything is a loosening.
  const fromAp = apState(from);
  const toAp = apState(to);
  if (fromAp !== 'closed' && toAp === 'closed') {
    out.push({ kind: 'additional-properties', path, from: 'true', to: 'false' });
  } else if (fromAp === 'open' && toAp === 'schema') {
    out.push({
      kind: 'additional-properties',
      path,
      from: 'true',
      to: 'constrained by a schema',
    });
  } else if (fromAp === 'schema' && toAp === 'schema') {
    const f = asSchema(from.additionalProperties);
    const t = asSchema(to.additionalProperties);
    if (f && t) {
      collectNarrowings(f, t, joinPath(path, '*'), depth + 1, out);
    }
  }

  // ── required ────────────────────────────────────────────────────────────
  const fromRequired = new Set(getRequired(from));
  const fromProps = getProperties(from);
  const toProps = getProperties(to);
  for (const field of getRequired(to)) {
    if (fromRequired.has(field)) continue;
    out.push({
      kind: 'required',
      path,
      field,
      from: 'optional',
      to: 'required',
      brandNew: !(field in fromProps),
    });
  }

  // ── properties ──────────────────────────────────────────────────────────
  for (const [name, fromSub] of Object.entries(fromProps)) {
    const toSub = toProps[name];
    if (toSub === undefined) {
      // Only meaningful in the backward direction; `render` drops it in the
      // forward one, where it just means "a property was added".
      out.push({ kind: 'property-removed', path, field: name, from: 'present', to: 'absent' });
      continue;
    }
    const f = asSchema(fromSub);
    const t = asSchema(toSub);
    if (f && t) collectNarrowings(f, t, joinPath(path, name), depth + 1, out);
  }
  // A property present only in `to` is an addition — never reported. See the
  // header note.

  // ── items ───────────────────────────────────────────────────────────────
  // Object-form only. Tuple-form `items` (an array of schemas) is ignored by
  // the fallback validator entirely, so a rule about it would be theatre.
  const fromItems = asSchema(from.items);
  const toItems = asSchema(to.items);
  if (toItems) {
    collectNarrowings(fromItems ?? {}, toItems, `${path}[]`, depth + 1, out);
  }
}

// ─── rendering ────────────────────────────────────────────────────────────

function renderBackward(n: Narrowing): string | null {
  const where = label(n.path);
  switch (n.kind) {
    case 'type':
      return `Field "${where}" type narrowed from [${n.from}] to [${n.to}]`;
    case 'enum':
      return `Field "${where}" enum narrowed from ${n.from} to ${n.to} — old messages may carry a dropped value`;
    case 'pattern':
      return `Field "${where}" pattern tightened from ${n.from} to ${n.to} — old messages may not match`;
    case 'bound':
      return `Field "${where}" ${n.keyword} tightened from ${n.from} to ${n.to} — old messages may fall outside it`;
    case 'additional-properties':
      return `Field "${where}" additionalProperties tightened from ${n.from} to ${n.to} — old messages carrying extra keys will be rejected`;
    case 'required': {
      const field = joinPath(n.path, n.field ?? '');
      return n.brandNew
        ? `Required field "${field}" was added — old messages won't include it`
        : `Field "${field}" became required — old messages may not include it`;
    }
    case 'property-removed':
      return `Field "${joinPath(n.path, n.field ?? '')}" was removed — consumers may depend on it`;
    default:
      return null;
  }
}

/**
 * Forward violations are found by walking (new → old), so a `Narrowing`
 * here describes the OLD schema being stricter — i.e. the new schema
 * loosened. `from` is the new side, `to` is the old side; the messages read
 * old-first to match how an operator thinks about the change.
 */
function renderForward(n: Narrowing): string | null {
  const where = label(n.path);
  switch (n.kind) {
    case 'type':
      return `Field "${where}" type widened from [${n.to}] to [${n.from}] — old consumers may not handle new types`;
    case 'enum':
      return `Field "${where}" enum widened from ${n.to} to ${n.from} — old consumers may not handle new values`;
    case 'pattern':
      return `Field "${where}" pattern relaxed from ${n.to} to ${n.from} — old consumers may reject new messages`;
    case 'bound':
      return `Field "${where}" ${n.keyword} relaxed from ${n.to} to ${n.from} — old consumers may reject new messages`;
    case 'additional-properties':
      return `Field "${where}" additionalProperties relaxed from ${n.to} to ${n.from} — old consumers may reject the extra keys`;
    case 'required':
      return `Field "${joinPath(n.path, n.field ?? '')}" is no longer required — old consumers expect it to always be present`;
    case 'property-removed':
      // Walking (new → old), this is "the new schema added a property".
      // Additive and safe for old consumers — never a forward violation.
      return null;
    default:
      return null;
  }
}

/**
 * Recursively find fields that are required in `newSchema` and were not
 * present in `oldSchema` at all. Forward-incompatible on its own terms: an
 * old consumer has no code path for a field it has never seen.
 */
function collectBrandNewRequired(
  oldSchema: JsonSchema,
  newSchema: JsonSchema,
  path: string,
  depth: number,
  out: string[],
): void {
  if (depth > MAX_DEPTH) return;

  const oldProps = getProperties(oldSchema);
  const oldRequired = new Set(getRequired(oldSchema));
  for (const field of getRequired(newSchema)) {
    if (!oldRequired.has(field) && !(field in oldProps)) {
      out.push(
        `Required field "${joinPath(path, field)}" was added — old consumers won't understand it`,
      );
    }
  }

  const newProps = getProperties(newSchema);
  for (const [name, oldSub] of Object.entries(oldProps)) {
    const newSub = newProps[name];
    const o = asSchema(oldSub);
    const n = asSchema(newSub);
    if (o && n) collectBrandNewRequired(o, n, joinPath(path, name), depth + 1, out);
  }

  const oldItems = asSchema(oldSchema.items);
  const newItems = asSchema(newSchema.items);
  if (oldItems && newItems) {
    collectBrandNewRequired(oldItems, newItems, `${path}[]`, depth + 1, out);
  }
}

// ─── public API ───────────────────────────────────────────────────────────

/**
 * An empty schema (`{}`) is the absence of a contract, not a permissive one.
 * Bulk-registration entries and early declarations legitimately carry no
 * schema, and adopting one later is how a producer opts into the catalog —
 * that must not be gated as "type narrowed from [any] to [object]".
 * `Registry.declare()` already skips the check when the *incoming* schema is
 * empty; this is the same courtesy for the stored side.
 */
function isEmpty(schema: JsonSchema | undefined | null): boolean {
  return !schema || Object.keys(schema).length === 0;
}

/**
 * Backward compatibility: can a message produced under `oldSchema` still be
 * validated by `newSchema`? Any tightening anywhere in the tree is a
 * violation.
 */
export function checkBackwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult {
  if (isEmpty(oldSchema) || isEmpty(newSchema)) return { compatible: true, violations: [] };

  const found: Narrowing[] = [];
  collectNarrowings(oldSchema ?? {}, newSchema ?? {}, '', 0, found);

  const violations: string[] = [];
  for (const n of found) {
    const msg = renderBackward(n);
    if (msg) violations.push(msg);
  }
  return { compatible: violations.length === 0, violations };
}

/**
 * Forward compatibility: can a message produced under `newSchema` still be
 * validated by `oldSchema` — i.e. will a consumer still running the old
 * contract cope? Found by walking the same tightening detector in reverse.
 */
export function checkForwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult {
  if (isEmpty(oldSchema) || isEmpty(newSchema)) return { compatible: true, violations: [] };

  const found: Narrowing[] = [];
  collectNarrowings(newSchema ?? {}, oldSchema ?? {}, '', 0, found);

  const violations: string[] = [];
  for (const n of found) {
    const msg = renderForward(n);
    if (msg) violations.push(msg);
  }
  collectBrandNewRequired(oldSchema ?? {}, newSchema ?? {}, '', 0, violations);

  return { compatible: violations.length === 0, violations };
}
