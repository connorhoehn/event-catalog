export interface FlagSpec {
    /** Flags that take a value: `--name=v` or `--name v`. */
    readonly value?: readonly string[];
    /** Flags that are on/off switches. `--help` is always accepted. */
    readonly boolean?: readonly string[];
}
export interface ParsedArgs {
    /** Non-flag arguments, in order. Everything after a bare `--` is positional. */
    readonly positional: string[];
    /** Value flags that were supplied, keyed without the leading `--`. */
    readonly values: Readonly<Record<string, string>>;
    /** Boolean flags that were supplied, keyed without the leading `--`. */
    readonly flags: ReadonlySet<string>;
    /** True when `--help` or `-h` appeared anywhere in argv. */
    readonly help: boolean;
}
export type ParseResult = {
    readonly ok: true;
    readonly args: ParsedArgs;
} | {
    readonly ok: false;
    readonly error: string;
};
/**
 * Parse argv against a flag spec. Never throws; returns a rendered error
 * message for the caller to print alongside its usage line.
 */
export declare function parseFlags(argv: readonly string[], spec: FlagSpec): ParseResult;
/** Print `<bin>: <message>` plus a pointer at `--help`. Returns exit code 2. */
export declare function usageError(bin: string, message: string, usageLine?: string): number;
/**
 * Render any thrown value as a single actionable line. Node's errno
 * errors get a human phrase instead of `Error: ENOENT: no such file or
 * directory, open '...'`.
 */
export declare function formatError(err: unknown, withPath?: boolean): string;
export type Loaded<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: string;
};
/** Read + JSON.parse a file, rendering both failure modes as one line. */
export declare function readJsonFile(path: string, label?: string): Loaded<unknown>;
/**
 * Read a fingerprint manifest — a flat `{ "event.name": "sha256" }` map.
 * Rejects arrays, scalars and non-string values up front so downstream
 * `Object.keys(...)` never walks a string's indices.
 */
export declare function readFingerprintMap(path: string, label?: string): Loaded<Record<string, string>>;
/** `await res.json()` without the unhandled rejection when the body isn't JSON. */
export declare function readJsonResponse(res: Response, url: string): Promise<Loaded<unknown>>;
/**
 * Run a bin's main function, mapping its resolved number to the process
 * exit code and any rejection to a one-line message + exit 1.
 *
 * Sets `process.exitCode` rather than calling `process.exit()` so that
 * piped stdout (`event-catalog snapshot ... > file`) flushes fully before
 * the process leaves.
 */
export declare function runCli(bin: string, run: () => Promise<number>): void;
//# sourceMappingURL=_args.d.ts.map