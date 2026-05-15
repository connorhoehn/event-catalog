"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableStringify = stableStringify;
exports.computeSchemaFingerprint = computeSchemaFingerprint;
const node_crypto_1 = require("node:crypto");
/**
 * Serialize a JSON-compatible value deterministically so the byte output
 * is identical regardless of key insertion order. Arrays preserve order
 * (they're position-significant); object keys are sorted.
 *
 * Throws on circular references — schemas should never carry cycles, so
 * the throw is a guardrail against a corrupted input rather than a
 * supported branch.
 */
function stableStringify(value) {
    const seen = new WeakSet();
    const walk = (v) => {
        if (v === null || typeof v !== 'object')
            return v;
        if (seen.has(v)) {
            throw new Error('stableStringify: circular reference encountered');
        }
        seen.add(v);
        if (Array.isArray(v)) {
            return v.map(walk);
        }
        const entries = Object.keys(v)
            .sort()
            .map((k) => [k, walk(v[k])]);
        const out = {};
        for (const [k, vv] of entries)
            out[k] = vv;
        return out;
    };
    return JSON.stringify(walk(value));
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
function computeSchemaFingerprint(schema) {
    return (0, node_crypto_1.createHash)('sha256').update(stableStringify(schema)).digest('hex');
}
//# sourceMappingURL=fingerprint.js.map