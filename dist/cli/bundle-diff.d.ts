#!/usr/bin/env node
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
 * True when the two versions differ in their event set. Drives `--exit-code`
 * so CI can branch on "differs" without scraping stdout.
 */
export declare function hasChanges(diff: BundleDiff): boolean;
export declare function formatDiff(diff: BundleDiff): string;
/** Ran successfully and found differences. Distinct from 1 (failed to run). */
export declare const EXIT_DIFFERENCES = 3;
export declare function bundleDiff(args: string[]): Promise<number>;
//# sourceMappingURL=bundle-diff.d.ts.map