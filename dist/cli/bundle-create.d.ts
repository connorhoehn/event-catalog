#!/usr/bin/env node
export declare const HELP: string;
export interface CreateArgs {
    name: string;
    version: string;
    transport: string;
    events: string[];
}
export type CreateArgsResult = {
    ok: true;
    value: CreateArgs;
} | {
    ok: true;
    help: true;
} | {
    ok: false;
    error: string;
};
/**
 * Full argv parse: rejects unknown flags and value-less value flags, and
 * reports `--help` as a result instead of calling `process.exit` (which
 * made this function untestable and surprising to import).
 */
export declare function parseCreateArgs(argv: string[]): CreateArgsResult;
/**
 * Back-compat shim: returns the parsed args, or null when argv can't be
 * parsed into a bundle name + options.
 */
export declare function parseArgs(argv: string[]): CreateArgs | null;
export interface ValidationError {
    code: 2;
    message: string;
}
/** One `--events` entry, after the optional "?" suffix is stripped. */
export interface EventMember {
    name: string;
    required: boolean;
}
/**
 * Parse raw `--events` tokens into members.
 *
 * A trailing "?" marks the member OPTIONAL; everything else is required.
 *
 * Why required-by-default, rather than making `required` opt-in:
 *
 *   - `EventReference.required` already *means* required when omitted —
 *     `validateBundle` and `ec-bundle-diff` both read `required !== false`.
 *     A scaffold that emitted `required: false` would be writing the
 *     opposite of the type's own default.
 *   - An all-optional bundle asserts nothing. Every member may be absent,
 *     so it validates against a catalog that declares none of them, and a
 *     CRD pinned to it gates on nothing. That failure is silent and
 *     permanent; a too-strict member is loud and fixed in one edit.
 *   - The reason required-by-default hurt was that unknown names got
 *     scaffolded in. With names checked here, the remaining case is a real
 *     event the operator listed on purpose.
 *
 * So the default stays `required: true`, with "?" as the deliberate opt-out.
 */
export declare function parseEventMembers(raw: readonly string[]): EventMember[];
/** Every event name the compiled-in catalog declares. */
export declare function knownEventNames(): string[];
/**
 * Reject `--events` entries that name nothing in the catalog, plus blanks
 * and duplicates.
 *
 * Before this, `ec-bundle-create x --events pipeline.run.started` happily
 * wrote a bundle over an event that does not exist and marked it required.
 * The failure then surfaced two steps later as an `ec-lint-crd` error
 * against the operator's CRD — which was fine. The typo was here.
 */
export declare function validateEventMembers(members: readonly EventMember[], known: readonly string[]): ValidationError | null;
export declare function validateInputs(name: string, version: string, transport: string): ValidationError | null;
/**
 * Convert kebab-case bundle name to camelCase export identifier.
 * Example: "video-reactions" → "videoReactions"
 */
export declare function toCamelCase(name: string): string;
/**
 * Generate the contents of the new bundle file.
 */
export declare function generateBundleTemplate(name: string, version: string, transport: string, events: readonly string[]): string;
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
export declare function bundleCreate(name: string, version: string, transport: string, events: readonly string[], opts?: {
    /** Resolved path to write the bundle file, relative to process.cwd(). */
    bundlesDir?: string;
    /** Resolved path to index.ts, relative to process.cwd(). */
    indexPath?: string;
    /** Allow overriding fs for testing (if absent uses real fs). */
    readFile?: (p: string) => string;
    writeFile?: (p: string, content: string) => void;
    fileExists?: (p: string) => boolean;
    /**
     * Event names `--events` may reference. Defaults to the catalog
     * compiled into this CLI; injectable so tests can supply a fixture
     * set instead of depending on the shipped declaration list.
     */
    knownEvents?: readonly string[];
}): CreateResult;
/** Parse argv, run the create, print the outcome, and return an exit code. */
export declare function main(argv: string[]): number;
//# sourceMappingURL=bundle-create.d.ts.map