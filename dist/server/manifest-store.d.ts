import type { RedisClientType } from 'redis';
export interface ManifestEvent {
    /** Canonical event name (post-alias-resolution by the consumer). */
    name: string;
    /** sha256 fingerprint the consumer last verified against. */
    fingerprint: string;
}
export interface ManifestEntry {
    consumerName: string;
    events: ManifestEvent[];
    /** ISO 8601 — when the manifest was last written. */
    updatedAt: string;
}
export interface ManifestDriftReport {
    consumerName: string;
    updatedAt: string;
    /** One row per pinned event. */
    events: Array<{
        name: string;
        pinnedFingerprint: string;
        currentFingerprint: string | null;
        status: 'fresh' | 'stale' | 'unknown';
    }>;
    /** Convenience counters. */
    summary: {
        fresh: number;
        stale: number;
        unknown: number;
    };
}
export interface ManifestStore {
    put(entry: {
        consumerName: string;
        events: ManifestEvent[];
    }): Promise<ManifestEntry>;
    get(consumerName: string): Promise<ManifestEntry | null>;
    list(): Promise<ManifestEntry[]>;
    remove(consumerName: string): Promise<boolean>;
    /**
     * Compare every pinned manifest against the current registry's
     * fingerprints (passed in by the route — keeps this module
     * registry-agnostic for testability).
     */
    driftReport(currentFingerprints: Map<string, string>): Promise<ManifestDriftReport[]>;
}
export declare class RedisManifestStore implements ManifestStore {
    private readonly redis;
    constructor(redis: RedisClientType);
    put(entry: {
        consumerName: string;
        events: ManifestEvent[];
    }): Promise<ManifestEntry>;
    get(consumerName: string): Promise<ManifestEntry | null>;
    list(): Promise<ManifestEntry[]>;
    remove(consumerName: string): Promise<boolean>;
    driftReport(currentFingerprints: Map<string, string>): Promise<ManifestDriftReport[]>;
}
/**
 * Pure helper exported for testability. Pure function over a manifest
 * + a fingerprint map; no I/O.
 */
export declare function buildDriftReport(manifest: ManifestEntry, currentFingerprints: Map<string, string>): ManifestDriftReport;
//# sourceMappingURL=manifest-store.d.ts.map