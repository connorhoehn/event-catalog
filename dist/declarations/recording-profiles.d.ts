/**
 * Canonical recording profile identifiers.
 *
 * `custom` is the escape hatch when a channel has flag overrides that
 * don't match any first-class profile. New code should not write
 * `custom`; it exists for the read-time legacy-flag synthesis path
 * and as a safe fallback for unrecognized profiles in older rows.
 */
export declare const RECORDING_PROFILES: readonly ["hangout", "broadcast", "dm", "none", "custom"];
export type RecordingProfile = (typeof RECORDING_PROFILES)[number];
/**
 * Resolved recording configuration. Every field has a concrete value
 * — consumers should never see `undefined` after `resolveRecordingProfile`.
 *
 * `overridable` is metadata, not config: it declares which fields
 * tolerate a per-channel override. Out-of-band overrides for fields
 * not in this list are silently dropped on resolve.
 */
export interface RecordingProfileDef {
    profile: RecordingProfile;
    composePerPeer: boolean;
    transcribe: boolean;
    retentionDays: number;
    destination: 'local' | 's3' | 'gcs' | 'azure';
    maxLegs: number;
    overridable: ReadonlyArray<'composePerPeer' | 'transcribe' | 'retentionDays' | 'destination' | 'maxLegs'>;
}
/**
 * Profile → materialized config table. Edit-and-ship is the extension
 * model — adding a profile is one entry here + bumping the SHA pin in
 * each consumer.
 */
export declare const RECORDING_PROFILE_REGISTRY: Readonly<Record<RecordingProfile, RecordingProfileDef>>;
/**
 * Registry version. Bump when a profile's resolved semantics change
 * (e.g., `hangout.retentionDays` 30 → 60). Recording rows snapshot
 * this value as `profileVersion` at recording-start so in-flight
 * recordings finalize under the version they began with, even after
 * the registry advances.
 */
export declare const RECORDING_PROFILE_REGISTRY_VERSION = 1;
/**
 * Strict type-guard. Use at every cross-repo boundary (HTTP body
 * parser, webhook consumer, MQ envelope reader) before trusting the
 * value as a `RecordingProfile`.
 */
export declare function isRecordingProfile(s: unknown): s is RecordingProfile;
/**
 * Throwing variant for use in API route handlers where an invalid
 * profile string should produce a 400.
 */
export declare class InvalidRecordingProfileError extends Error {
    readonly received: unknown;
    constructor(received: unknown);
}
export declare function validateRecordingProfile(s: unknown): RecordingProfile;
/**
 * Input to `resolveRecordingProfile` — accepts the new canonical
 * `recordingProfile` field AND the legacy flag pair so callers can
 * pass raw channel rows from before the migration.
 */
export interface StoredRecordingConfig {
    recordingProfile?: RecordingProfile | string;
    overrides?: Partial<RecordingProfileDef>;
    composePerPeer?: boolean;
    transcribe?: boolean;
    enabled?: boolean;
}
/**
 * Resolve a stored config (which may carry a profile id, a legacy
 * flag tuple, or both) into a fully materialized `RecordingProfileDef`.
 *
 * Precedence:
 *   1. `stored.recordingProfile` (validated; falls through to legacy
 *      synthesis if the string is unknown)
 *   2. Legacy `composePerPeer` + `transcribe` flags
 *   3. `'none'` as a final defensive default
 *
 * Overrides:
 *   When `stored.overrides` is present, each overridable field in the
 *   base profile is replaced by the override value. Fields not in the
 *   base profile's `overridable` list are silently dropped.
 */
export declare function resolveRecordingProfile(stored: StoredRecordingConfig | null | undefined): RecordingProfileDef;
//# sourceMappingURL=recording-profiles.d.ts.map