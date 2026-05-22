#!/usr/bin/env node
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

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const HELP = `
ec-bundle-create — scaffold a new FeatureBundle file from a template

USAGE
  ec-bundle-create <name> [options]

ARGUMENTS
  <name>                Bundle name (kebab-case, e.g. "video-reactions")

OPTIONS
  --version <semver>    Initial version (default: 1.0.0)
  --transport <mode>    signal | durable | both  (default: signal)
  --events <list>       Comma-separated event names to pre-populate
  --help, -h            Show this help

EXIT CODES
  0   Bundle created and index updated
  1   Bundle file already exists
  2   Usage error

EXAMPLES
  ec-bundle-create video-reactions
  ec-bundle-create live-poll --transport durable --version 2.0.0
  ec-bundle-create screenshare --events ws.screen.started,ws.screen.stopped
`.trim();

export function parseArgs(argv: string[]): {
  name: string;
  version: string;
  transport: string;
  events: string[];
} | null {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  const name = argv[0];
  if (!name || name.startsWith('--')) {
    return null;
  }

  const version = getArg(argv, '--version') ?? '1.0.0';
  const transport = getArg(argv, '--transport') ?? 'signal';
  const eventsArg = getArg(argv, '--events');
  const events = eventsArg ? eventsArg.split(',').map((e) => e.trim()).filter(Boolean) : [];

  return { name, version, transport, events };
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_NAME_RE = /^[a-z][a-z0-9-]*$/;
const VALID_TRANSPORT = new Set(['signal', 'durable', 'both']);
const VALID_SEMVER_RE = /^\d+\.\d+\.\d+$/;

export interface ValidationError {
  code: 2;
  message: string;
}

export function validateInputs(
  name: string,
  version: string,
  transport: string,
): ValidationError | null {
  if (!VALID_NAME_RE.test(name)) {
    return {
      code: 2,
      message:
        `ec-bundle-create: invalid bundle name "${name}" — must be lowercase kebab-case ` +
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
export function toCamelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

/**
 * Generate the contents of the new bundle file.
 */
export function generateBundleTemplate(
  name: string,
  version: string,
  transport: string,
  events: string[],
): string {
  const camelName = toCamelCase(name);
  const exportName = `${camelName}Bundle`;

  const eventsBlock =
    events.length > 0
      ? events.map((e) => `    { name: '${e}', required: true },`).join('\n')
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
export function updateIndexContent(
  indexContent: string,
  name: string,
): string | null {
  const camelName = toCamelCase(name);
  const exportName = `${camelName}Bundle`;
  const modulePath = `./${name}.js`;

  // 1. Append the named re-export after the last existing `export { ... }` line.
  const exportLine = `export { ${exportName} } from '${modulePath}';`;
  const lastExportMatch = [...indexContent.matchAll(/^export \{[^}]+\} from '[^']+';/gm)];
  if (lastExportMatch.length === 0) return null;
  const lastExport = lastExportMatch[lastExportMatch.length - 1]!;
  const insertAfterExport = lastExport.index! + lastExport[0].length;
  let updated =
    indexContent.slice(0, insertAfterExport) +
    '\n' +
    exportLine +
    indexContent.slice(insertAfterExport);

  // 2. Append the import statement after the last existing `import { ... }` line.
  const importLine = `import { ${exportName} } from '${modulePath}';`;
  const lastImportMatch = [...updated.matchAll(/^import \{[^}]+\} from '[^']+';/gm)];
  if (lastImportMatch.length === 0) return null;
  const lastImport = lastImportMatch[lastImportMatch.length - 1]!;
  const insertAfterImport = lastImport.index! + lastImport[0].length;
  updated =
    updated.slice(0, insertAfterImport) +
    '\n' +
    importLine +
    updated.slice(insertAfterImport);

  // 3. Append the entry to allBundles array — find the `] as const;` closing line.
  const closingMatch = /^] as const;/m.exec(updated);
  if (!closingMatch) return null;
  const closingIdx = closingMatch.index!;
  // Insert before the closing `] as const;`
  updated =
    updated.slice(0, closingIdx) +
    `  ${exportName},\n` +
    updated.slice(closingIdx);

  return updated;
}

// ---------------------------------------------------------------------------
// Core create logic (exported for testing)
// ---------------------------------------------------------------------------

export interface CreateResult {
  /** Exit code */
  code: 0 | 1 | 2;
  message: string;
}

export function bundleCreate(
  name: string,
  version: string,
  transport: string,
  events: string[],
  opts: {
    /** Resolved path to write the bundle file, relative to process.cwd(). */
    bundlesDir?: string;
    /** Resolved path to index.ts, relative to process.cwd(). */
    indexPath?: string;
    /** Allow overriding fs for testing (if absent uses real fs). */
    readFile?: (p: string) => string;
    writeFile?: (p: string, content: string) => void;
    fileExists?: (p: string) => boolean;
  } = {},
): CreateResult {
  const bundlesDir = opts.bundlesDir ?? 'src/declarations/bundles';
  const indexPath = opts.indexPath ?? join(bundlesDir, 'index.ts');
  const readFile = opts.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = opts.writeFile ?? writeFileSync;
  const fileExists = opts.fileExists ?? existsSync;

  const validationError = validateInputs(name, version, transport);
  if (validationError) {
    return { code: validationError.code, message: validationError.message };
  }

  const filepath = join(bundlesDir, `${name}.ts`);

  if (fileExists(filepath)) {
    return {
      code: 1,
      message: `ec-bundle-create: bundle file already exists: ${filepath}`,
    };
  }

  // Write the bundle file
  const template = generateBundleTemplate(name, version, transport, events);
  writeFile(filepath, template);

  // Update index.ts
  let indexContent: string;
  try {
    indexContent = readFile(indexPath);
  } catch {
    return {
      code: 1,
      message: `ec-bundle-create: could not read index file: ${indexPath}`,
    };
  }

  const updatedIndex = updateIndexContent(indexContent, name);
  if (updatedIndex === null) {
    return {
      code: 1,
      message:
        `ec-bundle-create: could not update ${indexPath} — unexpected file structure. ` +
        `Add the export, import, and allBundles entry manually.`,
    };
  }

  writeFile(indexPath, updatedIndex);

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
// Standalone entry point
// ---------------------------------------------------------------------------

const _argv1 = process.argv[1] ?? '';
if (
  _argv1.endsWith('bundle-create.js') ||
  _argv1.endsWith('bundle-create.ts') ||
  _argv1.endsWith('ec-bundle-create')
) {
  const parsed = parseArgs(args);
  if (!parsed) {
    console.error(
      'ec-bundle-create: bundle name is required\n' +
        'usage: ec-bundle-create <name> [--version 1.0.0] [--transport signal|durable|both] [--events e1,e2]',
    );
    process.exit(2);
  }

  const result = bundleCreate(parsed.name, parsed.version, parsed.transport, parsed.events);
  if (result.code === 0) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  process.exit(result.code);
}
