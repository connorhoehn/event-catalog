// src/cli/_args.ts
//
// Shared, dependency-free argument parsing + error rendering for every
// binary this package ships (`event-catalog`, `ec-lint-crd`,
// `ec-bundle-diff`, `ec-bundle-create`) and every `event-catalog`
// subcommand.
//
// Design rules this file encodes, so each command doesn't re-derive them:
//
//   * An unknown flag is an error (exit 2), never a silent no-op. A
//     typo'd `--catalog-ur=` used to make a command fall through to
//     "required flag missing" or, worse, run against a default.
//   * A value flag accepts both `--name=value` and `--name value`, and
//     errors when the value is missing rather than swallowing the next
//     flag as its value.
//   * `--help` / `-h` are always recognised, on every binary and every
//     subcommand, and always exit 0.
//   * Filesystem and JSON failures render as one actionable line, never
//     as a raw Node stack trace.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

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

export type ParseResult =
  | { readonly ok: true; readonly args: ParsedArgs }
  | { readonly ok: false; readonly error: string };

function knownFlagList(spec: FlagSpec): string {
  const all = [...(spec.value ?? []), ...(spec.boolean ?? [])].sort();
  if (all.length === 0) return '--help';
  return [...all.map((f) => `--${f}`), '--help'].join(', ');
}

/**
 * Parse argv against a flag spec. Never throws; returns a rendered error
 * message for the caller to print alongside its usage line.
 */
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParseResult {
  const valueFlags = new Set(spec.value ?? []);
  const boolFlags = new Set(spec.boolean ?? []);

  const positional: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '--') {
      for (const rest of argv.slice(i + 1)) positional.push(rest);
      break;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (!name) {
        return { ok: false, error: `malformed flag "${arg}"` };
      }
      if (valueFlags.has(name)) {
        if (eq >= 0) {
          values[name] = arg.slice(eq + 1);
          continue;
        }
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('-') && next.length > 1)) {
          return { ok: false, error: `--${name} requires a value (use --${name}=<value>)` };
        }
        values[name] = next;
        i += 1;
        continue;
      }
      if (boolFlags.has(name)) {
        if (eq >= 0) {
          return { ok: false, error: `--${name} is a switch and does not take a value` };
        }
        flags.add(name);
        continue;
      }
      return {
        ok: false,
        error: `unknown flag "--${name}" (known flags: ${knownFlagList(spec)})`,
      };
    }

    if (arg.length > 1 && arg.startsWith('-')) {
      return { ok: false, error: `unknown flag "${arg}" (known flags: ${knownFlagList(spec)})` };
    }

    positional.push(arg);
  }

  return { ok: true, args: { positional, values, flags, help } };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Print `<bin>: <message>` plus a pointer at `--help`. Returns exit code 2. */
export function usageError(bin: string, message: string, usageLine?: string): number {
  console.error(`${bin}: ${message}`);
  if (usageLine) console.error(`usage: ${usageLine}`);
  console.error(`run \`${bin} --help\` for usage`);
  return 2;
}

/**
 * Render any thrown value as a single actionable line. Node's errno
 * errors get a human phrase instead of `Error: ENOENT: no such file or
 * directory, open '...'`.
 */
export function formatError(err: unknown, withPath = true): string {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException;
    const where = withPath && e.path ? `: ${e.path}` : '';
    switch (e.code) {
      case 'ENOENT': return `no such file or directory${where}`;
      case 'EACCES': return `permission denied${where}`;
      case 'EISDIR': return `is a directory, expected a file${where}`;
      case 'ENOTDIR': return `not a directory${where}`;
      case 'ECONNREFUSED': return `connection refused — is the catalog server running?`;
      default: return e.message;
    }
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// File / JSON helpers
// ---------------------------------------------------------------------------

export type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Read + JSON.parse a file, rendering both failure modes as one line. */
export function readJsonFile(path: string, label = 'file'): Loaded<unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, error: `cannot read ${label} "${path}": ${formatError(err, false)}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, error: `${label} "${path}" is not valid JSON: ${(err as Error).message}` };
  }
}

/**
 * Read a fingerprint manifest — a flat `{ "event.name": "sha256" }` map.
 * Rejects arrays, scalars and non-string values up front so downstream
 * `Object.keys(...)` never walks a string's indices.
 */
export function readFingerprintMap(path: string, label = 'snapshot'): Loaded<Record<string, string>> {
  const loaded = readJsonFile(path, label);
  if (!loaded.ok) return loaded;
  const value = loaded.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      error: `${label} "${path}" must be a JSON object of {"event.name": "fingerprint"}`,
    };
  }
  const out: Record<string, string> = {};
  for (const [name, fp] of Object.entries(value as Record<string, unknown>)) {
    if (typeof fp !== 'string') {
      return {
        ok: false,
        error: `${label} "${path}": fingerprint for "${name}" is not a string`,
      };
    }
    out[name] = fp;
  }
  return { ok: true, value: out };
}

/** `await res.json()` without the unhandled rejection when the body isn't JSON. */
export async function readJsonResponse(res: Response, url: string): Promise<Loaded<unknown>> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, error: `could not read response from ${url}: ${formatError(err)}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: `${url} did not return JSON (got ${text.slice(0, 80).replace(/\s+/g, ' ').trim() || 'an empty body'})`,
    };
  }
}

// ---------------------------------------------------------------------------
// Entry-point wrapper
// ---------------------------------------------------------------------------

/**
 * Run a bin's main function, mapping its resolved number to the process
 * exit code and any rejection to a one-line message + exit 1.
 *
 * Sets `process.exitCode` rather than calling `process.exit()` so that
 * piped stdout (`event-catalog snapshot ... > file`) flushes fully before
 * the process leaves.
 */
export function runCli(bin: string, run: () => Promise<number>): void {
  void run().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`${bin}: ${formatError(err)}`);
      process.exitCode = 1;
    },
  );
}
