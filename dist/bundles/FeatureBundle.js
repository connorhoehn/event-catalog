"use strict";
// src/bundles/FeatureBundle.ts
//
// FeatureBundle — capability-level grouping of related events.
//
// A bundle is a named, versioned set of event references that together
// constitute a deployable feature (e.g. "chat", "presence"). The
// fingerprint is a content-addressable hash of the bundle's identity
// so CRDs can pin to a specific bundle state and detect drift without
// a live registry round-trip.
//
// API surface (module-level functions):
//   registerFeatureBundle(bundle)  — compute + stamp fingerprint, store
//   getFeatureBundle(name, version?) — lookup; latest when version omitted
//   listFeatureBundles()           — all registered bundles
//   validateBundle(bundle, registry) — event-existence + transport checks
//   findBundleByFingerprint(fp)    — reverse lookup for CRD pinning
//   getCrdSchema(bundleName)       — JSON Schema fragment for K8s CRD spec
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureBundleRegistry = void 0;
exports.computeFingerprint = computeFingerprint;
exports.registerFeatureBundle = registerFeatureBundle;
exports.getFeatureBundle = getFeatureBundle;
exports.listFeatureBundles = listFeatureBundles;
exports.validateBundle = validateBundle;
exports.findBundleByFingerprint = findBundleByFingerprint;
exports.getCrdSchema = getCrdSchema;
const node_crypto_1 = require("node:crypto");
const fingerprint_js_1 = require("../registry/fingerprint.js");
// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------
/**
 * Compute a deterministic fingerprint for a bundle.
 * Only name, version, and the sorted event reference list feed the hash;
 * description and deprecated are excluded so documentation edits don't
 * invalidate CRD pins.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to 12 chars for
 * display; the registry always stores and returns the full hash.
 */
function computeFingerprint(bundle) {
    const sortedEvents = [...bundle.events].sort((a, b) => a.name.localeCompare(b.name));
    const payload = { name: bundle.name, version: bundle.version, events: sortedEvents };
    return (0, node_crypto_1.createHash)('sha256').update((0, fingerprint_js_1.stableStringify)(payload)).digest('hex');
}
// ---------------------------------------------------------------------------
// In-process registry (module singleton)
// ---------------------------------------------------------------------------
// Map<name, FeatureBundle[]> — multiple versions may be registered.
const _store = new Map();
/**
 * Add a bundle to the in-process registry. Computes and stamps the
 * fingerprint automatically; the caller's `fingerprint` field is ignored
 * (computed fresh each time).
 *
 * Throws if a bundle with the same name+version is already registered
 * with a different event set (fingerprint mismatch → likely a bug).
 */
function registerFeatureBundle(bundle) {
    const fingerprint = computeFingerprint(bundle);
    const full = { ...bundle, fingerprint };
    const existing = _store.get(bundle.name) ?? [];
    const same = existing.find((b) => b.version === bundle.version);
    if (same) {
        if (same.fingerprint !== fingerprint) {
            throw new Error(`FeatureBundleRegistry: bundle "${bundle.name}" v${bundle.version} already registered with a different event set. ` +
                `Existing fingerprint: ${same.fingerprint.slice(0, 12)}, new: ${fingerprint.slice(0, 12)}`);
        }
        // Idempotent re-registration with the same content — no-op.
        return same;
    }
    existing.push(full);
    _store.set(bundle.name, existing);
    return full;
}
/**
 * Look up a bundle. When version is omitted returns the highest semver
 * among all registered versions for that name.
 */
function getFeatureBundle(name, version) {
    const versions = _store.get(name);
    if (!versions || versions.length === 0)
        return undefined;
    if (version !== undefined) {
        return versions.find((b) => b.version === version);
    }
    // Return latest: simple lexicographic semver sort (sufficient for x.y.z).
    return versions.slice().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
}
/** Returns all registered bundles, sorted by name then version. */
function listFeatureBundles() {
    const all = [];
    for (const versions of _store.values()) {
        all.push(...versions);
    }
    return all.sort((a, b) => {
        const nameOrd = a.name.localeCompare(b.name);
        if (nameOrd !== 0)
            return nameOrd;
        return a.version.localeCompare(b.version, undefined, { numeric: true });
    });
}
/**
 * Validate that:
 *   1. Every required EventReference.name exists in the supplied registry.
 *   2. When EventReference.version is pinned, the registry entry's version matches.
 *   3. The declared transport is consistent with the registered events' transports
 *      (where the registry has transport information).
 *
 * Returns a structured result so callers can surface errors gracefully
 * at boot rather than crashing.
 */
function validateBundle(bundle, registry) {
    const errors = [];
    for (const ref of bundle.events) {
        const entry = registry.get(ref.name);
        if (!entry) {
            if (ref.required !== false) {
                // required: true or required: undefined (default required) both fail
                errors.push(`Required event "${ref.name}" is not registered in the catalog.`);
            }
            // optional missing events are silently skipped
            continue;
        }
        if (ref.version !== undefined && entry.version !== ref.version) {
            errors.push(`Event "${ref.name}" version mismatch: bundle pins v${ref.version} but registry has v${entry.version}.`);
        }
    }
    // Transport coherence check: infer aggregate transport from registered events.
    const registeredTransports = new Set();
    for (const ref of bundle.events) {
        const entry = registry.get(ref.name);
        if (entry && entry.transport) {
            registeredTransports.add(entry.transport);
        }
    }
    if (registeredTransports.size > 0) {
        let inferredTransport;
        if (registeredTransports.has('signal') && registeredTransports.has('durable')) {
            inferredTransport = 'both';
        }
        else if (registeredTransports.has('durable')) {
            inferredTransport = 'durable';
        }
        else {
            inferredTransport = 'signal';
        }
        if (bundle.transport !== inferredTransport) {
            errors.push(`Bundle transport "${bundle.transport}" does not match inferred transport "${inferredTransport}" from registered events.`);
        }
    }
    return { valid: errors.length === 0, errors };
}
/**
 * Reverse lookup: find a bundle by its fingerprint.
 * Used by CRD controllers that embed fingerprints and need to resolve
 * back to the full bundle descriptor.
 */
function findBundleByFingerprint(fingerprint) {
    for (const versions of _store.values()) {
        const match = versions.find((b) => b.fingerprint === fingerprint);
        if (match)
            return match;
    }
    return undefined;
}
/**
 * Generate a minimal JSON Schema fragment suitable for embedding in a
 * Kubernetes CRD's `spec.versions[].schema.openAPIV3Schema`. The schema
 * covers the `bundle` field of the CRD spec with required name, version,
 * and fingerprint fields.
 *
 * Returns undefined when the named bundle is not registered.
 */
function getCrdSchema(bundleName) {
    const bundle = getFeatureBundle(bundleName);
    if (!bundle)
        return undefined;
    return {
        type: 'object',
        required: ['name', 'version', 'fingerprint'],
        properties: {
            name: { type: 'string', enum: [bundleName] },
            version: { type: 'string' },
            fingerprint: { type: 'string', minLength: 64 },
        },
    };
}
// ---------------------------------------------------------------------------
// FeatureBundleRegistry class (object-oriented alternative surface)
// ---------------------------------------------------------------------------
/**
 * Object-oriented wrapper around the module-level bundle store.
 * Useful for dependency injection in tests or when an isolated registry
 * is needed (e.g. the test suite instantiates one per test).
 */
class FeatureBundleRegistry {
    _store = new Map();
    register(bundle) {
        const fingerprint = computeFingerprint(bundle);
        const full = { ...bundle, fingerprint };
        const existing = this._store.get(bundle.name) ?? [];
        const same = existing.find((b) => b.version === bundle.version);
        if (same) {
            if (same.fingerprint !== fingerprint) {
                throw new Error(`FeatureBundleRegistry: bundle "${bundle.name}" v${bundle.version} already registered with a different event set.`);
            }
            return same;
        }
        existing.push(full);
        this._store.set(bundle.name, existing);
        return full;
    }
    get(name, version) {
        const versions = this._store.get(name);
        if (!versions || versions.length === 0)
            return undefined;
        if (version !== undefined) {
            return versions.find((b) => b.version === version);
        }
        return versions.slice().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
    }
    list() {
        const all = [];
        for (const versions of this._store.values()) {
            all.push(...versions);
        }
        return all.sort((a, b) => {
            const nameOrd = a.name.localeCompare(b.name);
            if (nameOrd !== 0)
                return nameOrd;
            return a.version.localeCompare(b.version, undefined, { numeric: true });
        });
    }
    validate(bundle, registry) {
        return validateBundle(bundle, registry);
    }
    findByFingerprint(fingerprint) {
        for (const versions of this._store.values()) {
            const match = versions.find((b) => b.fingerprint === fingerprint);
            if (match)
                return match;
        }
        return undefined;
    }
}
exports.FeatureBundleRegistry = FeatureBundleRegistry;
//# sourceMappingURL=FeatureBundle.js.map