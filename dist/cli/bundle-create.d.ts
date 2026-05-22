#!/usr/bin/env node
export declare function parseArgs(argv: string[]): {
    name: string;
    version: string;
    transport: string;
    events: string[];
} | null;
export interface ValidationError {
    code: 2;
    message: string;
}
export declare function validateInputs(name: string, version: string, transport: string): ValidationError | null;
/**
 * Convert kebab-case bundle name to camelCase export identifier.
 * Example: "video-reactions" → "videoReactions"
 */
export declare function toCamelCase(name: string): string;
/**
 * Generate the contents of the new bundle file.
 */
export declare function generateBundleTemplate(name: string, version: string, transport: string, events: string[]): string;
/**
 * Insert the export re-export line, the import line, and the allBundles
 * entry into src/declarations/bundles/index.ts.
 *
 * Returns the updated file content, or null if any anchor is not found.
 */
export declare function updateIndexContent(indexContent: string, name: string): string | null;
export interface CreateResult {
    /** Exit code */
    code: 0 | 1 | 2;
    message: string;
}
export declare function bundleCreate(name: string, version: string, transport: string, events: string[], opts?: {
    /** Resolved path to write the bundle file, relative to process.cwd(). */
    bundlesDir?: string;
    /** Resolved path to index.ts, relative to process.cwd(). */
    indexPath?: string;
    /** Allow overriding fs for testing (if absent uses real fs). */
    readFile?: (p: string) => string;
    writeFile?: (p: string, content: string) => void;
    fileExists?: (p: string) => boolean;
}): CreateResult;
//# sourceMappingURL=bundle-create.d.ts.map