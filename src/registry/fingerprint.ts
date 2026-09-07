// src/registry/fingerprint.ts
//
// Phase E6 — deterministic schema fingerprints (formerly roadmap item
// E5.5, promoted from deferred per the 2026-05-15 vision refresh).
//
// A fingerprint is a content-addressable identifier for a declared
// schema's *shape*: identical shape → identical fingerprint, regardless
// of key ordering in the source declaration. Consumers cache + compare
// fingerprints to detect drift without a registry round-trip.
//
// The two pieces:
//
//   stableStringify(obj)        — deterministic JSON serialization with
//                                 sorted object keys. Zero dependencies.
//   computeSchemaFingerprint()  — sha256(stableStringify(schema)) as
//                                 lowercase 64-char hex.

import { createHash } from 'node:crypto';
import { MAX_SCHEMA_DEPTH, schemaDepthExceededMessage } from './limits';

/**
 * Serialize a JSON-compatible value deterministically so the byte output
 * is identical regardless of key insertion order. Arrays preserve order
 * (they're position-significant); object keys are sorted.
 *
 * Throws on circular references — schemas should never carry cycles, so
 * the throw is a guardrail against a corrupted input rather than a
 * supported branch.
 *
 * Throws on nesting past {@link MAX_SCHEMA_DEPTH}. The walk is recursive,
 * and nesting is the input dimension the server's 1 MiB body cap does not
 * bound: `{"not":X}` is 8 bytes a level, so an in-budget POST /api/events
 * body reaches ~131 000 levels while V8's stack gives out at ~2 300. The
 * explicit limit turns "RangeError, a stack unwind, and a message naming
 * nothing" into a plain Error the declare path reports as a 400 saying
 * what is wrong.
 *
 * The serialized object is built with a null prototype. `{}` inherits
 * `Object.prototype`, whose `__proto__` accessor swallows the assignment
 * instead of creating an own property: before this, a schema carrying a
 * `__proto__` key at any depth had that key silently dropped from the
 * output, so `{properties:{__proto__:{...},ok:{...}}}` and
 * `{properties:{ok:{...}}}` hashed to the same fingerprint. Fingerprints
 * are the drift-detection primitive — a collision there is a schema
 * change that `event-catalog drift` and pinned consumer manifests both
 * report as "no change".
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (depth > MAX_SCHEMA_DEPTH) {
      throw new Error(schemaDepthExceededMessage('stableStringify'));
    }
    if (seen.has(v as object)) {
      throw new Error('stableStringify: circular reference encountered');
    }
    seen.add(v as object);
    if (Array.isArray(v)) {
      return v.map((item) => walk(item, depth + 1));
    }
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => [k, walk((v as Record<string, unknown>)[k], depth + 1)] as const);
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [k, vv] of entries) out[k] = vv;
    return out;
  };
  return JSON.stringify(walk(value, 1));
}

/**
 * Compute a sha256 fingerprint of an EventDeclaration's schema. The
 * fingerprint is byte-stable across re-serializations: a schema declared
 * with `{type:'object',required:['a','b']}` produces the same fingerprint
 * regardless of whether `required` is listed before `type` or after.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to ~12 chars for
 * display; the catalog always stores and returns the full hash.
 */
export function computeSchemaFingerprint(schema: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(schema)).digest('hex');
}
