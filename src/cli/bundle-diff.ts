#!/usr/bin/env node
// src/cli/bundle-diff.ts
//
// ec-bundle-diff <name>@<v1> <name>@<v2>
// Compares two versions of the same bundle and reports event set changes.
//
// Output:
//   Bundle: chat
//   Versions: 1.0.0 → 2.0.0
//   Summary: +1 required, +1 optional, -1 removed, 1 req→opt, 1 opt→req
//
//   Added (required) (1):
//     + ws.chat.message.threaded
//
//   Added (optional) (1):
//     + ws.chat.typing
//
//   Removed (1):
//     - ws.chat.message.legacy
//
//   Required-to-optional (1):
//     ~ ws.chat.member.left (was required, now optional)
//
//   Optional-to-required (1):
//     ~ ws.chat.member.joined (was optional, now required) — BREAKING
//
//   Fingerprint: abc123 → def456
//   Suggested semver bump: major (required event removed + opt→req transition)
//
// Also reported, and reported nowhere else: a change to the bundle's
// aggregate `transport`, its `deprecated` block, and any member's
// `EventReference.version` schema pin. The first two are outside
// computeFingerprint, so a fingerprint-pinned CRD cannot see them.
//
// Sections cap at DEFAULT_MAX_PER_SECTION entries and report how many they
// hid; `--full` lists everything. A 29-member bundle otherwise prints a
// wall of text nobody reads, which is its own way of hiding a change.

import {
  getFeatureBundle,
  listFeatureBundles,
  type EventReference,
  type FeatureBundle,
} from '../bundles/FeatureBundle.js';
import '../declarations/bundles/index.js'; // registers all bundles as side-effect
import { parseFlags, runCli, usageError } from './_args.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  versionChanged?: Array<{ name: string; from: number | undefined; to: number | undefined }>;
  /**
   * Aggregate bus claim moved. Present only when it changed. This is NOT
   * covered by the fingerprint — computeFingerprint hashes name, version
   * and members only — so nothing else in the pipeline would catch it.
   */
  transportChanged?: { from: string; to: string };
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

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse "name@version" reference. Returns null if format is invalid. */
function parseBundleRef(ref: string): { name: string; version: string } | null {
  const clean = ref.trim();
  const atIdx = clean.indexOf('@');
  if (atIdx < 0 || atIdx === 0 || atIdx === clean.length - 1) return null;
  const name = clean.slice(0, atIdx);
  // Strip any fingerprint suffix
  const rest = clean.slice(atIdx + 1);
  const version = rest.indexOf('#') >= 0 ? rest.slice(0, rest.indexOf('#')) : rest;
  if (!version) return null;
  return { name, version };
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

/** Classify a deprecation block moving between two bundle versions. */
function diffDeprecation(
  from: FeatureBundle['deprecated'],
  to: FeatureBundle['deprecated'],
): BundleDiff['deprecationChanged'] {
  if (!from && !to) return undefined;
  if (!from && to) return { from, to, kind: 'added' };
  if (from && !to) return { from, to, kind: 'removed' };
  if (from && to && (from.since !== to.since || from.replacement !== to.replacement)) {
    return { from, to, kind: 'changed' };
  }
  return undefined;
}

/**
 * Compare two registered bundle versions and return a structured diff.
 * Returns null if either bundle/version is not found.
 */
export function diffBundles(
  bundleName: string,
  v1: string,
  v2: string,
): BundleDiff | null {
  const b1 = getFeatureBundle(bundleName, v1);
  const b2 = getFeatureBundle(bundleName, v2);

  if (!b1 || !b2) return null;

  const eventsV1 = new Map<string, EventReference>(b1.events.map((e) => [e.name, e]));
  const eventsV2 = new Map<string, EventReference>(b2.events.map((e) => [e.name, e]));

  const addedRequired: string[] = [];
  const addedOptional: string[] = [];
  const removed: string[] = [];
  const removedOptional: string[] = [];
  const requiredToOptional: string[] = [];
  const optionalToRequired: string[] = [];

  // Events in v2 but not in v1 → added
  for (const [name, ref2] of eventsV2) {
    if (!eventsV1.has(name)) {
      // required: undefined defaults to required (true)
      if (ref2.required === false) {
        addedOptional.push(name);
      } else {
        addedRequired.push(name);
      }
    }
  }

  // Events in v1 but not in v2 → removed
  for (const [name, ref1] of eventsV1) {
    if (!eventsV2.has(name)) {
      removed.push(name);
      if (ref1.required === false) removedOptional.push(name);
    }
  }

  // Events in both → check required/optional transitions and version pins
  const versionChanged: Array<{ name: string; from: number | undefined; to: number | undefined }> = [];
  for (const [name, ref1] of eventsV1) {
    const ref2 = eventsV2.get(name);
    if (!ref2) continue; // already counted as removed

    const wasRequired = ref1.required !== false;
    const isRequired = ref2.required !== false;

    if (wasRequired && !isRequired) {
      requiredToOptional.push(name);
    } else if (!wasRequired && isRequired) {
      optionalToRequired.push(name);
    }

    if (ref1.version !== ref2.version) {
      versionChanged.push({ name, from: ref1.version, to: ref2.version });
    }
  }

  // Bundle-level changes. Neither feeds computeFingerprint, so if the diff
  // doesn't report them nothing does.
  const transportChanged =
    b1.transport !== b2.transport ? { from: b1.transport, to: b2.transport } : undefined;

  const deprecationChanged = diffDeprecation(b1.deprecated, b2.deprecated);

  // Determine suggested semver bump
  let suggestedBump: BundleDiff['suggestedBump'] = 'none';
  const reasons: string[] = [];

  // Major triggers.
  // Removing a REQUIRED event breaks consumers → major. Removing an event that
  // was already optional is a contract narrowing, not a break → minor, handled
  // below. Reporting every removal as "required event removed" was simply
  // false when the event had `required: false`.
  const removedRequired = removed.filter((n) => !removedOptional.includes(n));
  if (removedRequired.length > 0) {
    suggestedBump = 'major';
    reasons.push('required event removed');
  }
  if (optionalToRequired.length > 0) {
    if (suggestedBump !== 'major') suggestedBump = 'major';
    reasons.push('opt→req transition');
  }
  if (transportChanged) {
    if (suggestedBump !== 'major') suggestedBump = 'major';
    reasons.push('transport mode changed');
  }
  // A pin moving to a different revision, or a member gaining a pin it did
  // not have, narrows what the bundle accepts → breaking for anyone on the
  // old revision. Dropping a pin only widens it, so that stays minor.
  const pinTightened = versionChanged.some((v) => v.to !== undefined);
  if (pinTightened) {
    if (suggestedBump !== 'major') suggestedBump = 'major';
    reasons.push('member schema pin changed');
  }

  // Minor triggers (only if not already major)
  if (suggestedBump !== 'major') {
    if (addedRequired.length > 0) {
      suggestedBump = 'minor';
      reasons.push('required event added');
    }
    if (requiredToOptional.length > 0) {
      suggestedBump = 'minor';
      reasons.push('req→optional transition');
    }
    if (removedOptional.length > 0) {
      suggestedBump = 'minor';
      reasons.push('optional event removed');
    }
    if (versionChanged.length > 0) {
      suggestedBump = 'minor';
      reasons.push('member schema pin dropped');
    }
    if (deprecationChanged?.kind === 'added') {
      suggestedBump = 'minor';
      reasons.push('bundle deprecated');
    }
  }

  // Patch triggers (only if no major/minor already)
  if (suggestedBump === 'none') {
    if (addedOptional.length > 0) {
      suggestedBump = 'patch';
      reasons.push('optional event added');
    }
    if (deprecationChanged) {
      suggestedBump = 'patch';
      reasons.push(`deprecation ${deprecationChanged.kind}`);
    }
  }

  const suggestedBumpReason = reasons.join(' + ');

  return {
    bundleName,
    v1,
    v2,
    addedRequired,
    addedOptional,
    removed,
    removedOptional,
    requiredToOptional,
    optionalToRequired,
    versionChanged,
    ...(transportChanged ? { transportChanged } : {}),
    ...(deprecationChanged ? { deprecationChanged } : {}),
    fingerprintV1: b1.fingerprint,
    fingerprintV2: b2.fingerprint,
    suggestedBump,
    suggestedBumpReason,
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

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
export function hasChanges(diff: BundleDiff): boolean {
  return (
    diff.addedRequired.length > 0 ||
    diff.addedOptional.length > 0 ||
    diff.removed.length > 0 ||
    diff.requiredToOptional.length > 0 ||
    diff.optionalToRequired.length > 0 ||
    (diff.versionChanged?.length ?? 0) > 0 ||
    diff.transportChanged !== undefined ||
    diff.deprecationChanged !== undefined
  );
}

/** Default per-section cap before `--full`. Keeps a 29-member diff readable. */
export const DEFAULT_MAX_PER_SECTION = 10;

export interface FormatDiffOptions {
  /** List every entry rather than capping each section. */
  full?: boolean;
  /** Entries shown per section when not `full`. */
  maxPerSection?: number;
}

/** One-line shape-of-the-change header, so a 29-member diff reads at a glance. */
function summaryLine(diff: BundleDiff): string {
  const parts: string[] = [];
  if (diff.addedRequired.length > 0) parts.push(`+${diff.addedRequired.length} required`);
  if (diff.addedOptional.length > 0) parts.push(`+${diff.addedOptional.length} optional`);
  if (diff.removed.length > 0) parts.push(`-${diff.removed.length} removed`);
  if (diff.requiredToOptional.length > 0) parts.push(`${diff.requiredToOptional.length} req→opt`);
  if (diff.optionalToRequired.length > 0) parts.push(`${diff.optionalToRequired.length} opt→req`);
  if (diff.versionChanged && diff.versionChanged.length > 0) {
    parts.push(`${diff.versionChanged.length} pin changed`);
  }
  if (diff.transportChanged) parts.push('transport changed');
  if (diff.deprecationChanged) parts.push(`deprecation ${diff.deprecationChanged.kind}`);
  return `Summary: ${parts.join(', ')}`;
}

export function formatDiff(diff: BundleDiff, opts: FormatDiffOptions = {}): string {
  const cap = opts.full ? Infinity : (opts.maxPerSection ?? DEFAULT_MAX_PER_SECTION);
  const lines: string[] = [];

  /** Render a titled section, capped, with an explicit "N more" footer. */
  const section = (title: string, entries: string[]): void => {
    if (entries.length === 0) return;
    lines.push('');
    lines.push(`${title} (${entries.length}):`);
    for (const entry of entries.slice(0, cap)) lines.push(entry);
    const hidden = entries.length - Math.min(entries.length, cap);
    if (hidden > 0) {
      lines.push(`  … ${hidden} more (re-run with --full to list every entry)`);
    }
  };

  lines.push(`Bundle: ${diff.bundleName}`);
  lines.push(`Versions: ${diff.v1} → ${diff.v2}`);

  if (!hasChanges(diff)) {
    lines.push('');
    lines.push('No changes.');
  } else {
    lines.push(summaryLine(diff));

    if (diff.transportChanged) {
      lines.push('');
      lines.push(
        `Transport: ${diff.transportChanged.from} → ${diff.transportChanged.to} — BREAKING ` +
          `(consumers subscribe to the bus this names; the fingerprint does not cover it)`,
      );
    }

    if (diff.deprecationChanged) {
      const { kind, from, to } = diff.deprecationChanged;
      lines.push('');
      if (kind === 'removed') {
        lines.push(`Deprecation: removed (was since ${from?.since ?? '?'})`);
      } else {
        const replacement = to?.replacement ? `, replacement ${to.replacement}` : '';
        lines.push(`Deprecation: ${kind} — since ${to?.since ?? '?'}${replacement}`);
      }
    }

    section('Added (required)', diff.addedRequired.map((n) => `  + ${n}`));
    section('Added (optional)', diff.addedOptional.map((n) => `  + ${n}`));
    section(
      'Removed',
      diff.removed.map((n) => {
        const wasOptional = diff.removedOptional?.includes(n) ?? false;
        return `  - ${n}${wasOptional ? ' (was optional)' : ''}`;
      }),
    );
    section(
      'Required-to-optional',
      diff.requiredToOptional.map((n) => `  ~ ${n} (was required, now optional)`),
    );
    section(
      'Optional-to-required',
      diff.optionalToRequired.map((n) => `  ~ ${n} (was optional, now required) — BREAKING`),
    );
    section(
      'Schema pin changed',
      (diff.versionChanged ?? []).map(
        (v) =>
          `  ~ ${v.name} (schema revision ${v.from ?? 'unpinned'} → ${v.to ?? 'unpinned'})`,
      ),
    );
  }

  lines.push('');
  lines.push(
    `Fingerprint: ${diff.fingerprintV1.slice(0, 12)} → ${diff.fingerprintV2.slice(0, 12)}`,
  );

  if (diff.suggestedBump === 'none') {
    lines.push('Suggested semver bump: none (identical event sets)');
  } else {
    const reason = diff.suggestedBumpReason ? ` (${diff.suggestedBumpReason})` : '';
    lines.push(`Suggested semver bump: ${diff.suggestedBump}${reason}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BIN = 'ec-bundle-diff';
const USAGE = 'ec-bundle-diff <name>@<v1> <name>@<v2> [--exit-code] [--full]';
const SPEC = { boolean: ['exit-code', 'full'] } as const;

/** Ran successfully and found differences. Distinct from 1 (failed to run). */
export const EXIT_DIFFERENCES = 3;

/** Render "known versions of <name>" for a not-found error. */
function knownVersionsHint(name: string): string {
  const versions = listFeatureBundles()
    .filter((b) => b.name === name)
    .map((b) => b.version);
  if (versions.length === 0) {
    const names = [...new Set(listFeatureBundles().map((b) => b.name))].sort();
    return `no bundle named "${name}" is registered (known bundles: ${names.join(', ')})`;
  }
  return `known versions of "${name}": ${versions.join(', ')}`;
}

export async function bundleDiff(args: string[]): Promise<number> {
  const HELP = `
ec-bundle-diff — compare two versions of a FeatureBundle and report event set changes

USAGE
  ec-bundle-diff <name>@<v1> <name>@<v2> [--exit-code] [--full]
  ec-bundle-diff --help

ARGUMENTS
  <name>@<v1>    First bundle reference (e.g. chat@1.0.0)
  <name>@<v2>    Second bundle reference (e.g. chat@2.0.0)

OPTIONS
  --exit-code    Exit 3 when the two versions differ (like \`git diff --exit-code\`,
                 but 3 rather than 1 so "they differ" stays distinguishable from
                 "the diff failed to run"). Without it a successful diff always
                 exits 0, whatever it found.
  --full         List every entry. By default each section shows at most
                 ${DEFAULT_MAX_PER_SECTION} names and reports how many it hid — a bundle with
                 29 members otherwise prints a wall nobody reads.
  --help, -h     Show this help

EXIT CODES
  0   Diff ran; no differences (or differences, without --exit-code)
  1   Failed to run — one or both bundle versions are not in the catalog
  2   Usage error (wrong arguments, unknown flag, mismatched bundle names)
  3   Diff ran; differences found (only with --exit-code)

NOTES
  Both references must name the SAME bundle: this compares two versions of one
  bundle, not two different bundles. Versions must already be registered in the
  catalog compiled into this CLI.

EXAMPLES
  ec-bundle-diff chat@1.0.0 chat@2.0.0
  ec-bundle-diff presence@1.0.0 presence@1.1.0
  ec-bundle-diff chat@1.0.0 chat@2.0.0 --exit-code   # CI: 3 ⇒ event set changed
`.trim();

  const parsed = parseFlags(args, SPEC);
  if (!parsed.ok) return usageError(BIN, parsed.error, USAGE);
  if (parsed.args.help) {
    console.log(HELP);
    return 0;
  }

  const positional = parsed.args.positional;

  if (positional.length < 2) {
    return usageError(BIN, 'two bundle references required', USAGE);
  }
  if (positional.length > 2) {
    return usageError(BIN, `unexpected extra argument "${positional[2]}" — diff compares exactly two references`, USAGE);
  }

  const ref1 = parseBundleRef(positional[0]!);
  const ref2 = parseBundleRef(positional[1]!);

  if (!ref1) {
    return usageError(BIN, `invalid bundle reference "${positional[0]}" — expected <name>@<version>`, USAGE);
  }
  if (!ref2) {
    return usageError(BIN, `invalid bundle reference "${positional[1]}" — expected <name>@<version>`, USAGE);
  }
  if (ref1.name !== ref2.name) {
    return usageError(
      BIN,
      `bundle names must match ("${ref1.name}" vs "${ref2.name}") — use the same bundle name for both arguments`,
      USAGE,
    );
  }

  const diff = diffBundles(ref1.name, ref1.version, ref2.version);

  if (!diff) {
    // Determine which side is missing for a better error message
    if (!getFeatureBundle(ref1.name, ref1.version)) {
      console.error(`${BIN}: bundle not found: ${ref1.name}@${ref1.version}`);
    }
    if (!getFeatureBundle(ref2.name, ref2.version)) {
      console.error(`${BIN}: bundle not found: ${ref2.name}@${ref2.version}`);
    }
    console.error(`${BIN}: ${knownVersionsHint(ref1.name)}`);
    console.error(`run \`${BIN} --help\` for usage`);
    return 1;
  }

  console.log(formatDiff(diff, { full: parsed.args.flags.has('full') }));

  // Only opt in to a non-zero "differs" code: existing callers pipe this into
  // grep and expect 0 from a successful run.
  if (parsed.args.flags.has('exit-code') && hasChanges(diff)) {
    return EXIT_DIFFERENCES;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Standalone entry point (when invoked as ec-bundle-diff directly)
// ---------------------------------------------------------------------------

const _argv1 = process.argv[1] ?? '';
if (
  _argv1.endsWith('bundle-diff.js') ||
  _argv1.endsWith('bundle-diff.ts') ||
  _argv1.endsWith('ec-bundle-diff')
) {
  runCli(BIN, () => bundleDiff(process.argv.slice(2)));
}
