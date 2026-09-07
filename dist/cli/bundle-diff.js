#!/usr/bin/env node
"use strict";
// src/cli/bundle-diff.ts
//
// ec-bundle-diff <name>@<v1> <name>@<v2>
// Compares two versions of the same bundle and reports event set changes.
//
// Output:
//   Bundle: chat
//   Versions: 1.0.0 → 2.0.0
//
//   Added (required):
//     + ws.chat.message.threaded
//
//   Added (optional):
//     + ws.chat.typing
//
//   Removed:
//     - ws.chat.message.legacy
//
//   Required-to-optional:
//     ~ ws.chat.member.left (was required, now optional)
//
//   Optional-to-required:
//     ~ ws.chat.member.joined (was optional, now required) — BREAKING
//
//   Fingerprint: abc123 → def456
//   Suggested semver bump: major (required event removed + opt→req transition)
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXIT_DIFFERENCES = void 0;
exports.diffBundles = diffBundles;
exports.hasChanges = hasChanges;
exports.formatDiff = formatDiff;
exports.bundleDiff = bundleDiff;
const FeatureBundle_js_1 = require("../bundles/FeatureBundle.js");
require("../declarations/bundles/index.js"); // registers all bundles as side-effect
const _args_js_1 = require("./_args.js");
// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
/** Parse "name@version" reference. Returns null if format is invalid. */
function parseBundleRef(ref) {
    const clean = ref.trim();
    const atIdx = clean.indexOf('@');
    if (atIdx < 0 || atIdx === 0 || atIdx === clean.length - 1)
        return null;
    const name = clean.slice(0, atIdx);
    // Strip any fingerprint suffix
    const rest = clean.slice(atIdx + 1);
    const version = rest.indexOf('#') >= 0 ? rest.slice(0, rest.indexOf('#')) : rest;
    if (!version)
        return null;
    return { name, version };
}
// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------
/**
 * Compare two registered bundle versions and return a structured diff.
 * Returns null if either bundle/version is not found.
 */
function diffBundles(bundleName, v1, v2) {
    const b1 = (0, FeatureBundle_js_1.getFeatureBundle)(bundleName, v1);
    const b2 = (0, FeatureBundle_js_1.getFeatureBundle)(bundleName, v2);
    if (!b1 || !b2)
        return null;
    const eventsV1 = new Map(b1.events.map((e) => [e.name, e]));
    const eventsV2 = new Map(b2.events.map((e) => [e.name, e]));
    const addedRequired = [];
    const addedOptional = [];
    const removed = [];
    const removedOptional = [];
    const requiredToOptional = [];
    const optionalToRequired = [];
    // Events in v2 but not in v1 → added
    for (const [name, ref2] of eventsV2) {
        if (!eventsV1.has(name)) {
            // required: undefined defaults to required (true)
            if (ref2.required === false) {
                addedOptional.push(name);
            }
            else {
                addedRequired.push(name);
            }
        }
    }
    // Events in v1 but not in v2 → removed
    for (const [name, ref1] of eventsV1) {
        if (!eventsV2.has(name)) {
            removed.push(name);
            if (ref1.required === false)
                removedOptional.push(name);
        }
    }
    // Events in both → check required/optional transitions
    for (const [name, ref1] of eventsV1) {
        const ref2 = eventsV2.get(name);
        if (!ref2)
            continue; // already counted as removed
        const wasRequired = ref1.required !== false;
        const isRequired = ref2.required !== false;
        if (wasRequired && !isRequired) {
            requiredToOptional.push(name);
        }
        else if (!wasRequired && isRequired) {
            optionalToRequired.push(name);
        }
    }
    // Determine suggested semver bump
    let suggestedBump = 'none';
    const reasons = [];
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
        if (suggestedBump !== 'major')
            suggestedBump = 'major';
        reasons.push('opt→req transition');
    }
    if (b1.transport !== b2.transport) {
        if (suggestedBump !== 'major')
            suggestedBump = 'major';
        reasons.push('transport mode changed');
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
    }
    // Patch triggers (only if no major/minor already)
    if (suggestedBump === 'none') {
        if (addedOptional.length > 0) {
            suggestedBump = 'patch';
            reasons.push('optional event added');
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
 * True when the two versions differ in their event set. Drives `--exit-code`
 * so CI can branch on "differs" without scraping stdout.
 */
function hasChanges(diff) {
    return (diff.addedRequired.length > 0 ||
        diff.addedOptional.length > 0 ||
        diff.removed.length > 0 ||
        diff.requiredToOptional.length > 0 ||
        diff.optionalToRequired.length > 0);
}
function formatDiff(diff) {
    const lines = [];
    lines.push(`Bundle: ${diff.bundleName}`);
    lines.push(`Versions: ${diff.v1} → ${diff.v2}`);
    if (!hasChanges(diff)) {
        lines.push('');
        lines.push('No changes.');
    }
    else {
        if (diff.addedRequired.length > 0) {
            lines.push('');
            lines.push('Added (required):');
            for (const name of diff.addedRequired) {
                lines.push(`  + ${name}`);
            }
        }
        if (diff.addedOptional.length > 0) {
            lines.push('');
            lines.push('Added (optional):');
            for (const name of diff.addedOptional) {
                lines.push(`  + ${name}`);
            }
        }
        if (diff.removed.length > 0) {
            lines.push('');
            lines.push('Removed:');
            for (const name of diff.removed) {
                const wasOptional = diff.removedOptional?.includes(name) ?? false;
                lines.push(`  - ${name}${wasOptional ? ' (was optional)' : ''}`);
            }
        }
        if (diff.requiredToOptional.length > 0) {
            lines.push('');
            lines.push('Required-to-optional:');
            for (const name of diff.requiredToOptional) {
                lines.push(`  ~ ${name} (was required, now optional)`);
            }
        }
        if (diff.optionalToRequired.length > 0) {
            lines.push('');
            lines.push('Optional-to-required:');
            for (const name of diff.optionalToRequired) {
                lines.push(`  ~ ${name} (was optional, now required) — BREAKING`);
            }
        }
    }
    lines.push('');
    lines.push(`Fingerprint: ${diff.fingerprintV1.slice(0, 12)} → ${diff.fingerprintV2.slice(0, 12)}`);
    if (diff.suggestedBump === 'none') {
        lines.push('Suggested semver bump: none (identical event sets)');
    }
    else {
        const reason = diff.suggestedBumpReason ? ` (${diff.suggestedBumpReason})` : '';
        lines.push(`Suggested semver bump: ${diff.suggestedBump}${reason}`);
    }
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const BIN = 'ec-bundle-diff';
const USAGE = 'ec-bundle-diff <name>@<v1> <name>@<v2> [--exit-code]';
const SPEC = { boolean: ['exit-code'] };
/** Ran successfully and found differences. Distinct from 1 (failed to run). */
exports.EXIT_DIFFERENCES = 3;
/** Render "known versions of <name>" for a not-found error. */
function knownVersionsHint(name) {
    const versions = (0, FeatureBundle_js_1.listFeatureBundles)()
        .filter((b) => b.name === name)
        .map((b) => b.version);
    if (versions.length === 0) {
        const names = [...new Set((0, FeatureBundle_js_1.listFeatureBundles)().map((b) => b.name))].sort();
        return `no bundle named "${name}" is registered (known bundles: ${names.join(', ')})`;
    }
    return `known versions of "${name}": ${versions.join(', ')}`;
}
async function bundleDiff(args) {
    const HELP = `
ec-bundle-diff — compare two versions of a FeatureBundle and report event set changes

USAGE
  ec-bundle-diff <name>@<v1> <name>@<v2> [--exit-code]
  ec-bundle-diff --help

ARGUMENTS
  <name>@<v1>    First bundle reference (e.g. chat@1.0.0)
  <name>@<v2>    Second bundle reference (e.g. chat@2.0.0)

OPTIONS
  --exit-code    Exit 3 when the two versions differ (like \`git diff --exit-code\`,
                 but 3 rather than 1 so "they differ" stays distinguishable from
                 "the diff failed to run"). Without it a successful diff always
                 exits 0, whatever it found.
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
    const parsed = (0, _args_js_1.parseFlags)(args, SPEC);
    if (!parsed.ok)
        return (0, _args_js_1.usageError)(BIN, parsed.error, USAGE);
    if (parsed.args.help) {
        console.log(HELP);
        return 0;
    }
    const positional = parsed.args.positional;
    if (positional.length < 2) {
        return (0, _args_js_1.usageError)(BIN, 'two bundle references required', USAGE);
    }
    if (positional.length > 2) {
        return (0, _args_js_1.usageError)(BIN, `unexpected extra argument "${positional[2]}" — diff compares exactly two references`, USAGE);
    }
    const ref1 = parseBundleRef(positional[0]);
    const ref2 = parseBundleRef(positional[1]);
    if (!ref1) {
        return (0, _args_js_1.usageError)(BIN, `invalid bundle reference "${positional[0]}" — expected <name>@<version>`, USAGE);
    }
    if (!ref2) {
        return (0, _args_js_1.usageError)(BIN, `invalid bundle reference "${positional[1]}" — expected <name>@<version>`, USAGE);
    }
    if (ref1.name !== ref2.name) {
        return (0, _args_js_1.usageError)(BIN, `bundle names must match ("${ref1.name}" vs "${ref2.name}") — use the same bundle name for both arguments`, USAGE);
    }
    const diff = diffBundles(ref1.name, ref1.version, ref2.version);
    if (!diff) {
        // Determine which side is missing for a better error message
        if (!(0, FeatureBundle_js_1.getFeatureBundle)(ref1.name, ref1.version)) {
            console.error(`${BIN}: bundle not found: ${ref1.name}@${ref1.version}`);
        }
        if (!(0, FeatureBundle_js_1.getFeatureBundle)(ref2.name, ref2.version)) {
            console.error(`${BIN}: bundle not found: ${ref2.name}@${ref2.version}`);
        }
        console.error(`${BIN}: ${knownVersionsHint(ref1.name)}`);
        console.error(`run \`${BIN} --help\` for usage`);
        return 1;
    }
    console.log(formatDiff(diff));
    // Only opt in to a non-zero "differs" code: existing callers pipe this into
    // grep and expect 0 from a successful run.
    if (parsed.args.flags.has('exit-code') && hasChanges(diff)) {
        return exports.EXIT_DIFFERENCES;
    }
    return 0;
}
// ---------------------------------------------------------------------------
// Standalone entry point (when invoked as ec-bundle-diff directly)
// ---------------------------------------------------------------------------
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('bundle-diff.js') ||
    _argv1.endsWith('bundle-diff.ts') ||
    _argv1.endsWith('ec-bundle-diff')) {
    (0, _args_js_1.runCli)(BIN, () => bundleDiff(process.argv.slice(2)));
}
//# sourceMappingURL=bundle-diff.js.map