#!/usr/bin/env node
"use strict";
// src/cli/bundle-create.ts
//
// ec-bundle-create <name> [--version 1.0.0] [--transport signal|durable|both] [--events e1,e2,e3]
//
// Creates src/declarations/bundles/<name>.ts from a template, then inserts
// the export + import + allBundles entry into src/declarations/bundles/index.ts.
//
// Exit codes:
//   0  Success
//   1  Bundle file already exists / index update failure
//   2  Usage error (missing name, bad name, bad transport)
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP = void 0;
exports.parseCreateArgs = parseCreateArgs;
exports.parseArgs = parseArgs;
exports.parseEventMembers = parseEventMembers;
exports.knownEventNames = knownEventNames;
exports.validateEventMembers = validateEventMembers;
exports.validateInputs = validateInputs;
exports.toCamelCase = toCamelCase;
exports.generateBundleTemplate = generateBundleTemplate;
exports.updateIndexContent = updateIndexContent;
exports.bundleCreate = bundleCreate;
exports.main = main;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const suggest_js_1 = require("../bundles/suggest.js");
const index_js_1 = require("../declarations/index.js");
const _args_js_1 = require("./_args.js");
// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const BIN = 'ec-bundle-create';
const USAGE = 'ec-bundle-create <name> [--version 1.0.0] [--transport signal|durable|both] [--events e1,e2]';
const SPEC = { value: ['version', 'transport', 'events'] };
exports.HELP = `
ec-bundle-create — scaffold a new FeatureBundle file from a template

USAGE
  ec-bundle-create <name> [options]

ARGUMENTS
  <name>                Bundle name (kebab-case, e.g. "video-reactions")

OPTIONS
  --version <semver>    Initial version (default: 1.0.0)
  --transport <mode>    signal | durable | both  (default: signal)
  --events <list>       Comma-separated event names to pre-populate. Every
                        name must already be declared in the catalog — an
                        unknown name is an error, not a scaffolded fiction.
                        Suffix a name with "?" to make that member OPTIONAL;
                        without the suffix it is required.
  --help, -h            Show this help

EXIT CODES
  0   Bundle created and index updated
  1   Bundle file already exists
  2   Usage error (bad name/version/transport, or an undeclared event)

EXAMPLES
  ec-bundle-create video-reactions
  ec-bundle-create live-poll --transport durable --version 2.0.0
  ec-bundle-create screenshare --events ws.screen.started,ws.screen.stopped
  ec-bundle-create captions --events call:caption:line,call:caption:final?
`.trim();
/**
 * Full argv parse: rejects unknown flags and value-less value flags, and
 * reports `--help` as a result instead of calling `process.exit` (which
 * made this function untestable and surprising to import).
 */
function parseCreateArgs(argv) {
    const parsed = (0, _args_js_1.parseFlags)(argv, SPEC);
    if (!parsed.ok)
        return { ok: false, error: parsed.error };
    if (parsed.args.help)
        return { ok: true, help: true };
    const { positional, values } = parsed.args;
    const name = positional[0];
    if (!name) {
        return { ok: false, error: 'bundle name is required' };
    }
    if (positional.length > 1) {
        return { ok: false, error: `unexpected extra argument "${positional[1]}" — create takes one bundle name` };
    }
    const eventsArg = values['events'];
    return {
        ok: true,
        value: {
            name,
            version: values['version'] ?? '1.0.0',
            transport: values['transport'] ?? 'signal',
            events: eventsArg ? eventsArg.split(',').map((e) => e.trim()).filter(Boolean) : [],
        },
    };
}
/**
 * Back-compat shim: returns the parsed args, or null when argv can't be
 * parsed into a bundle name + options.
 */
function parseArgs(argv) {
    const r = parseCreateArgs(argv);
    return r.ok && 'value' in r ? r.value : null;
}
// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const VALID_NAME_RE = /^[a-z][a-z0-9-]*$/;
const VALID_TRANSPORT = new Set(['signal', 'durable', 'both']);
const VALID_SEMVER_RE = /^\d+\.\d+\.\d+$/;
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
function parseEventMembers(raw) {
    return raw.map((token) => {
        const trimmed = token.trim();
        const optional = trimmed.endsWith('?');
        return {
            name: (optional ? trimmed.slice(0, -1) : trimmed).trim(),
            required: !optional,
        };
    });
}
/** Every event name the compiled-in catalog declares. */
function knownEventNames() {
    return index_js_1.allDeclarations.map((d) => d.name);
}
/**
 * Reject `--events` entries that name nothing in the catalog, plus blanks
 * and duplicates.
 *
 * Before this, `ec-bundle-create x --events pipeline.run.started` happily
 * wrote a bundle over an event that does not exist and marked it required.
 * The failure then surfaced two steps later as an `ec-lint-crd` error
 * against the operator's CRD — which was fine. The typo was here.
 */
function validateEventMembers(members, known) {
    const blanks = members.filter((m) => m.name === '').length;
    if (blanks > 0) {
        return {
            code: 2,
            message: `${BIN}: --events contains ${blanks} empty entry/entries — ` +
                `check for a trailing comma or a stray "?"`,
        };
    }
    const seen = new Set();
    const duplicates = [];
    for (const m of members) {
        if (seen.has(m.name))
            duplicates.push(m.name);
        seen.add(m.name);
    }
    if (duplicates.length > 0) {
        return {
            code: 2,
            message: `${BIN}: duplicate event(s) in --events: ${[...new Set(duplicates)].join(', ')} — ` +
                `a bundle member listed twice changes the fingerprint without changing the contract`,
        };
    }
    const knownSet = new Set(known);
    const unknown = members.filter((m) => !knownSet.has(m.name));
    if (unknown.length === 0)
        return null;
    const lines = unknown.map((m) => `  ${m.name}${(0, suggest_js_1.didYouMean)(m.name, known)}`);
    return {
        code: 2,
        message: [
            `${BIN}: ${unknown.length} of ${members.length} --events ` +
                `${unknown.length === 1 ? 'is' : 'are'} not declared in the catalog:`,
            ...lines,
            '',
            `Declare the event in src/declarations/ first, or fix the name. ` +
                `(${known.length} events are declared.)`,
        ].join('\n'),
    };
}
function validateInputs(name, version, transport) {
    if (!VALID_NAME_RE.test(name)) {
        return {
            code: 2,
            message: `ec-bundle-create: invalid bundle name "${name}" — must be lowercase kebab-case ` +
                `(letters, digits, hyphens; must start with a letter; no spaces or .ts extension)`,
        };
    }
    if (!VALID_SEMVER_RE.test(version)) {
        return {
            code: 2,
            message: `ec-bundle-create: invalid version "${version}" — expected semver format x.y.z`,
        };
    }
    if (!VALID_TRANSPORT.has(transport)) {
        return {
            code: 2,
            message: `ec-bundle-create: invalid transport "${transport}" — must be signal, durable, or both`,
        };
    }
    return null;
}
// ---------------------------------------------------------------------------
// Name derivation
// ---------------------------------------------------------------------------
/**
 * Convert kebab-case bundle name to camelCase export identifier.
 * Example: "video-reactions" → "videoReactions"
 */
function toCamelCase(name) {
    return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}
// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------
/**
 * Generate the contents of the new bundle file.
 */
function generateBundleTemplate(name, version, transport, events) {
    const camelName = toCamelCase(name);
    const exportName = `${camelName}Bundle`;
    const members = parseEventMembers(events);
    const eventsBlock = members.length > 0
        ? members
            .map((m) => `    { name: '${m.name}', required: ${m.required} },`)
            .join('\n')
        : '    // TODO: add event references here';
    return `// src/declarations/bundles/${name}.ts
//
// "${name}" FeatureBundle — auto-scaffolded by ec-bundle-create.
// Update the description and event list to match your feature.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: '${name}',
  version: '${version}',
  transport: '${transport}',
  description: 'Auto-scaffolded by ec-bundle-create. Update this description.',
  events: [
${eventsBlock}
  ],
};

export const ${exportName}: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
`;
}
// ---------------------------------------------------------------------------
// index.ts update
// ---------------------------------------------------------------------------
/**
 * Insert the export re-export line, the import line, and the allBundles
 * entry into src/declarations/bundles/index.ts.
 *
 * Returns the updated file content, or null if any anchor is not found.
 */
function updateIndexContent(indexContent, name) {
    const camelName = toCamelCase(name);
    const exportName = `${camelName}Bundle`;
    const modulePath = `./${name}.js`;
    // 1. Append the named re-export after the last existing `export { ... }` line.
    const exportLine = `export { ${exportName} } from '${modulePath}';`;
    const lastExportMatch = [...indexContent.matchAll(/^export \{[^}]+\} from '[^']+';/gm)];
    if (lastExportMatch.length === 0)
        return null;
    const lastExport = lastExportMatch[lastExportMatch.length - 1];
    const insertAfterExport = lastExport.index + lastExport[0].length;
    let updated = indexContent.slice(0, insertAfterExport) +
        '\n' +
        exportLine +
        indexContent.slice(insertAfterExport);
    // 2. Append the import statement after the last existing `import { ... }` line.
    const importLine = `import { ${exportName} } from '${modulePath}';`;
    const lastImportMatch = [...updated.matchAll(/^import \{[^}]+\} from '[^']+';/gm)];
    if (lastImportMatch.length === 0)
        return null;
    const lastImport = lastImportMatch[lastImportMatch.length - 1];
    const insertAfterImport = lastImport.index + lastImport[0].length;
    updated =
        updated.slice(0, insertAfterImport) +
            '\n' +
            importLine +
            updated.slice(insertAfterImport);
    // 3. Append the entry to allBundles array — find the `] as const;` closing line.
    const closingMatch = /^] as const;/m.exec(updated);
    if (!closingMatch)
        return null;
    const closingIdx = closingMatch.index;
    // Insert before the closing `] as const;`
    updated =
        updated.slice(0, closingIdx) +
            `  ${exportName},\n` +
            updated.slice(closingIdx);
    return updated;
}
function bundleCreate(name, version, transport, events, opts = {}) {
    const bundlesDir = opts.bundlesDir ?? 'src/declarations/bundles';
    const indexPath = opts.indexPath ?? (0, node_path_1.join)(bundlesDir, 'index.ts');
    const readFile = opts.readFile ?? ((p) => (0, node_fs_1.readFileSync)(p, 'utf8'));
    const writeFile = opts.writeFile ?? node_fs_1.writeFileSync;
    const fileExists = opts.fileExists ?? node_fs_1.existsSync;
    const validationError = validateInputs(name, version, transport);
    if (validationError) {
        return { code: validationError.code, message: validationError.message };
    }
    // Check the members BEFORE touching the filesystem. A bundle over a typo
    // is worse than no bundle: it fails ec-lint-crd pointing at the CRD.
    const members = parseEventMembers(events);
    const eventError = validateEventMembers(members, opts.knownEvents ?? knownEventNames());
    if (eventError) {
        return { code: eventError.code, message: eventError.message };
    }
    const filepath = (0, node_path_1.join)(bundlesDir, `${name}.ts`);
    if (fileExists(filepath)) {
        return {
            code: 1,
            message: `${BIN}: bundle file already exists: ${filepath}`,
        };
    }
    // Read + rewrite index.ts BEFORE writing the bundle file, so a failure
    // here doesn't leave an orphaned, unreferenced bundle on disk.
    let indexContent;
    try {
        indexContent = readFile(indexPath);
    }
    catch (err) {
        return {
            code: 1,
            message: `${BIN}: could not read index file ${indexPath}: ${(0, _args_js_1.formatError)(err, false)}`,
        };
    }
    const updatedIndex = updateIndexContent(indexContent, name);
    if (updatedIndex === null) {
        return {
            code: 1,
            message: `${BIN}: could not update ${indexPath} — unexpected file structure. ` +
                `Add the export, import, and allBundles entry manually.`,
        };
    }
    const template = generateBundleTemplate(name, version, transport, events);
    try {
        writeFile(filepath, template);
    }
    catch (err) {
        return {
            code: 1,
            message: `${BIN}: could not write ${filepath}: ${(0, _args_js_1.formatError)(err, false)}`,
        };
    }
    try {
        writeFile(indexPath, updatedIndex);
    }
    catch (err) {
        return {
            code: 1,
            message: `${BIN}: wrote ${filepath} but could not update ${indexPath}: ${(0, _args_js_1.formatError)(err, false)}`,
        };
    }
    const camelName = toCamelCase(name);
    const exportName = `${camelName}Bundle`;
    return {
        code: 0,
        message: [
            `Created  ${filepath}`,
            `Updated  ${indexPath}`,
            `Export   ${exportName}`,
            ``,
            `Next steps:`,
            `  1. Edit ${filepath} — fill in description + event list`,
            `  2. Run: npm test`,
            `  3. Commit + bump version + tag`,
        ].join('\n'),
    };
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
/** Parse argv, run the create, print the outcome, and return an exit code. */
function main(argv) {
    const parsed = parseCreateArgs(argv);
    if (!parsed.ok) {
        return (0, _args_js_1.usageError)(BIN, parsed.error, USAGE);
    }
    if ('help' in parsed) {
        console.log(exports.HELP);
        return 0;
    }
    const { name, version, transport, events } = parsed.value;
    const result = bundleCreate(name, version, transport, events);
    if (result.code === 0) {
        console.log(result.message);
    }
    else {
        console.error(result.message);
        if (result.code === 2)
            console.error(`run \`${BIN} --help\` for usage`);
    }
    return result.code;
}
// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('bundle-create.js') ||
    _argv1.endsWith('bundle-create.ts') ||
    _argv1.endsWith('ec-bundle-create')) {
    (0, _args_js_1.runCli)(BIN, async () => main(process.argv.slice(2)));
}
//# sourceMappingURL=bundle-create.js.map