#!/usr/bin/env node
import { type FeatureBundle } from '../bundles/FeatureBundle.js';
import '../declarations/bundles/index.js';
export interface BundleDiff {
    bundleName: string;
    v1: string;
    v2: string;
    addedRequired: string[];
    addedOptional: string[];
    removed: string[];
    /**
     * Subset of `removed` that was optional in v1. Optional because callers
     * (and older tests) construct BundleDiff literals by hand; when absent
     * every removed event renders unannotated.
     */
    removedOptional?: string[];
    requiredToOptional: string[];
    optionalToRequired: string[];
    /**
     * Members whose pinned schema revision (`EventReference.version`) moved.
     * `undefined` on either side means "unpinned, tracks the registry".
     * Optional so hand-built BundleDiff literals stay valid.
     */
    versionChanged?: Array<{
        name: string;
        from: number | undefined;
        to: number | undefined;
    }>;
    /**
     * Aggregate bus claim moved. Present only when it changed. This is NOT
     * covered by the fingerprint — computeFingerprint hashes name, version
     * and members only — so nothing else in the pipeline would catch it.
     */
    transportChanged?: {
        from: string;
        to: string;
    };
    /** Deprecation added, removed, or edited between the two versions. */
    deprecationChanged?: {
        from: FeatureBundle['deprecated'];
        to: FeatureBundle['deprecated'];
        kind: 'added' | 'removed' | 'changed';
    };
    fingerprintV1: string;
    fingerprintV2: string;
    suggestedBump: 'none' | 'patch' | 'minor' | 'major';
    suggestedBumpReason: string;
}
/**
 * Compare two registered bundle versions and return a structured diff.
 * Returns null if either bundle/version is not found.
 */
export declare function diffBundles(bundleName: string, v1: string, v2: string): BundleDiff | null;
/**
 * True when anything about the two versions differs — member set, member
 * required-ness, member schema pins, the aggregate transport claim, or the
 * deprecation block. Drives `--exit-code` so CI can branch on "differs"
 * without scraping stdout.
 *
 * Transport and deprecation used to be excluded, which meant a bundle whose
 * only change was signal→durable printed "No changes." AND "Suggested
 * semver bump: major", and exited 0 under --exit-code.
 */
export declare function hasChanges(diff: BundleDiff): boolean;
/** Default per-section cap before `--full`. Keeps a 29-member diff readable. */
export declare const DEFAULT_MAX_PER_SECTION = 10;
export interface FormatDiffOptions {
    /** List every entry rather than capping each section. */
    full?: boolean;
    /** Entries shown per section when not `full`. */
    maxPerSection?: number;
}
export declare function formatDiff(diff: BundleDiff, opts?: FormatDiffOptions): string;
/** Ran successfully and found differences. Distinct from 1 (failed to run). */
export declare const EXIT_DIFFERENCES = 3;
export declare function bundleDiff(args: string[]): Promise<number>;
//# sourceMappingURL=bundle-diff.d.ts.map