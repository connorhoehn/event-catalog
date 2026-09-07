import type { IRegistry } from '../registry/types.js';
export interface EventReference {
    /** Canonical event name, e.g. "ws.chat.message". */
    name: string;
    /**
     * Pin to a specific event schema version. When omitted the bundle
     * accepts the current registered version.
     */
    version?: number;
    /**
     * When true this event MUST be registered before the bundle is
     * considered valid. Optional events may be omitted by a lightweight
     * implementation.
     */
    required?: boolean;
}
export interface FeatureBundle {
    /** Short machine-readable identifier. Used as the CRD kind lower-case. */
    name: string;
    /** Semver string. Bumped when the event set or any required schema changes. */
    version: string;
    /**
     * Content-addressable fingerprint: sha256 of { name, version, events.sorted }.
     * Computed automatically by registerFeatureBundle(); callers should
     * leave this empty ('') in declarations — it is stamped at registration.
     */
    fingerprint: string;
    /** All events that make up this capability. */
    events: EventReference[];
    /**
     * Aggregate transport: 'signal' if all events are signal, 'durable' if
     * all are durable, 'both' if mixed. Declared here for CRD gate checks
     * that run before a live catalog is available.
     */
    transport: 'signal' | 'durable' | 'both';
    description?: string;
    deprecated?: {
        since: string;
        replacement?: string;
    };
}
export interface BundleValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Compute a deterministic fingerprint for a bundle.
 * Only name, version, and the sorted event reference list feed the hash;
 * description and deprecated are excluded so documentation edits don't
 * invalidate CRD pins.
 *
 * Returns lowercase 64-char hex. Consumers may truncate to 12 chars for
 * display; the registry always stores and returns the full hash.
 */
export declare function computeFingerprint(bundle: Pick<FeatureBundle, 'name' | 'version' | 'events'>): string;
/**
 * Add a bundle to the in-process registry. Computes and stamps the
 * fingerprint automatically; the caller's `fingerprint` field is ignored
 * (computed fresh each time).
 *
 * Throws if a bundle with the same name+version is already registered
 * with a different event set (fingerprint mismatch → likely a bug).
 */
export declare function registerFeatureBundle(bundle: Omit<FeatureBundle, 'fingerprint'>): FeatureBundle;
/**
 * Look up a bundle. When version is omitted returns the highest semver
 * among all registered versions for that name.
 */
export declare function getFeatureBundle(name: string, version?: string): FeatureBundle | undefined;
/** Returns all registered bundles, sorted by name then version. */
export declare function listFeatureBundles(): FeatureBundle[];
/**
 * Validate that:
 *   1. Every required EventReference.name exists in the supplied registry.
 *   2. When EventReference.version is pinned, the registry entry's version matches.
 *   3. The declared transport is SATISFIABLE by the registered events'
 *      transports — i.e. every member event is actually deliverable on the
 *      bus the bundle claims. A bundle may legitimately narrow to one bus
 *      over events declared `transport: 'both'`; it may not claim a bus that
 *      one of its events never travels on.
 *
 * Returns a structured result so callers can surface errors gracefully
 * at boot rather than crashing.
 */
export declare function validateBundle(bundle: FeatureBundle, registry: IRegistry): BundleValidationResult;
/**
 * Reverse lookup: find a bundle by its fingerprint.
 * Used by CRD controllers that embed fingerprints and need to resolve
 * back to the full bundle descriptor.
 */
export declare function findBundleByFingerprint(fingerprint: string): FeatureBundle | undefined;
/**
 * Generate a minimal JSON Schema fragment suitable for embedding in a
 * Kubernetes CRD's `spec.versions[].schema.openAPIV3Schema`. The schema
 * covers the `bundle` field of the CRD spec with required name, version,
 * and fingerprint fields.
 *
 * Returns undefined when the named bundle is not registered.
 */
export declare function getCrdSchema(bundleName: string): Record<string, unknown> | undefined;
/**
 * Object-oriented wrapper around the module-level bundle store.
 * Useful for dependency injection in tests or when an isolated registry
 * is needed (e.g. the test suite instantiates one per test).
 */
export declare class FeatureBundleRegistry {
    private readonly _store;
    register(bundle: Omit<FeatureBundle, 'fingerprint'>): FeatureBundle;
    get(name: string, version?: string): FeatureBundle | undefined;
    list(): FeatureBundle[];
    validate(bundle: FeatureBundle, registry: IRegistry): BundleValidationResult;
    findByFingerprint(fingerprint: string): FeatureBundle | undefined;
    /**
     * Mark a specific bundle version as deprecated. Updates the in-place entry
     * and recomputes the fingerprint because deprecation metadata changes the
     * bundle definition (the hash excludes deprecated, so the fingerprint is
     * unchanged — see computeFingerprint). This mutates the stored entry so
     * subsequent gets() return the updated deprecated field.
     *
     * Returns the updated bundle, or undefined if the bundle/version is not found.
     */
    deprecate(name: string, version: string, deprecation: {
        since: string;
        replacement?: string;
    }): FeatureBundle | undefined;
    /** Returns all registered bundles that have a `deprecated` field set. */
    listDeprecated(): FeatureBundle[];
}
//# sourceMappingURL=FeatureBundle.d.ts.map