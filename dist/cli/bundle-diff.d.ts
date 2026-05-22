#!/usr/bin/env node
import '../declarations/bundles/index.js';
export interface BundleDiff {
    bundleName: string;
    v1: string;
    v2: string;
    addedRequired: string[];
    addedOptional: string[];
    removed: string[];
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
export declare function formatDiff(diff: BundleDiff): string;
export declare function bundleDiff(args: string[]): Promise<number>;
//# sourceMappingURL=bundle-diff.d.ts.map