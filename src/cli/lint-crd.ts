#!/usr/bin/env node
// src/cli/lint-crd.ts
//
// ec-lint-crd <path-to-yaml-file-or-dir> [--fix-fingerprints]
//
// Walks YAML files, extracts CRDs with `spec.eventBundle`, validates:
//   1. The bundle exists in the catalog
//   2. If a fingerprint is pinned (e.g., "chat@1.0.0#abc123"), it matches
//   3. Optional: --fix-fingerprints rewrites the YAML with current fingerprint
//
// Exit 0 = all valid, 1 = errors found, 2 = warnings only / usage error

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Bundle registry bootstrap (module-singleton via side-effect import)
// ---------------------------------------------------------------------------

import { getFeatureBundle } from '../bundles/FeatureBundle.js';
import '../declarations/bundles/index.js'; // registers all bundles as side-effect

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A CRD document parsed from YAML with the fields we care about. */
interface ParsedCrd {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  eventBundle?: string;
  /** 1-based line number where `spec.eventBundle` appears, for output. */
  bundleLine?: number;
  /** 1-based line number where the document starts. */
  docStartLine: number;
  /** Source file path. */
  file: string;
}

/** Per-CRD lint result. */
interface CrdResult {
  crd: ParsedCrd;
  /** true = has at least one ERROR */
  hasError: boolean;
  /** true = has at least one WARN (deprecated) */
  hasWarn: boolean;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Minimal YAML parser for K8s CRD scalar fields
// ---------------------------------------------------------------------------
//
// We only need top-level scalars + spec.eventBundle. K8s YAML is simple
// enough that a line-by-line approach is sufficient and avoids external deps.

type YamlDoc = Record<string, unknown> & { _spec?: Record<string, unknown> };

/**
 * Parse one YAML document (string) and extract the fields we care about.
 * Returns undefined when the document has no meaningful content.
 */
function parseYamlDoc(text: string, fileStartLine: number): ParsedCrd | undefined {
  const lines = text.split('\n');
  const doc: YamlDoc = {};
  let inSpec = false;
  let bundleLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect spec block by indentation change
    if (raw.match(/^spec\s*:/)) {
      inSpec = true;
      doc['_spec'] = {};
      continue;
    }

    // If we're in spec, look for 2-space-indented keys
    if (inSpec) {
      const specKeyMatch = raw.match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)?/);
      if (specKeyMatch) {
        const key = specKeyMatch[1]!;
        const val = specKeyMatch[2] !== undefined ? specKeyMatch[2].trim() : '';
        // Strip inline YAML comments and surrounding quotes
        const cleanVal = val.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
        if (doc['_spec']) {
          (doc['_spec'] as Record<string, string>)[key] = cleanVal;
        }
        if (key === 'eventBundle') {
          bundleLine = fileStartLine + i;
        }
        continue;
      }
      // A line without leading 2-space indent exits spec (nested objects etc.)
      if (!raw.startsWith('  ') && raw.match(/^[a-zA-Z]/)) {
        inSpec = false;
      }
    }

    // Top-level key: value lines
    const topMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)?/);
    if (topMatch) {
      const key = topMatch[1]!;
      const val = topMatch[2] !== undefined ? topMatch[2].trim() : '';
      const cleanVal = val.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
      doc[key] = cleanVal;
    }
  }

  const apiVersion = typeof doc['apiVersion'] === 'string' ? doc['apiVersion'] : '';
  const kind = typeof doc['kind'] === 'string' ? doc['kind'] : '';

  // Extract metadata.name: walk the raw lines for "  name:" inside a metadata block
  let metaName = '';
  let metaNamespace = '';
  {
    let inMeta = false;
    for (const rawLine of lines) {
      if (rawLine.match(/^metadata\s*:/)) { inMeta = true; continue; }
      if (inMeta) {
        const m = rawLine.match(/^  name:\s*(.+)/);
        if (m) { metaName = m[1]!.replace(/^['"]|['"]$/g, '').trim(); }
        const ns = rawLine.match(/^  namespace:\s*(.+)/);
        if (ns) { metaNamespace = ns[1]!.replace(/^['"]|['"]$/g, '').trim(); }
        if (rawLine.match(/^[a-zA-Z]/) && !rawLine.match(/^  /)) { inMeta = false; }
      }
    }
  }

  const spec = doc['_spec'] as Record<string, string> | undefined;
  const eventBundle = spec?.['eventBundle'] ?? (doc['eventBundle'] as string | undefined);

  if (!apiVersion && !kind) return undefined;

  return {
    apiVersion,
    kind,
    name: metaName || '<unnamed>',
    namespace: metaNamespace || undefined,
    eventBundle: eventBundle || undefined,
    bundleLine: bundleLine ?? undefined,
    docStartLine: fileStartLine,
    file: '', // filled by caller
  };
}

/**
 * Split a multi-document YAML file on `---` separators and return
 * each document's text plus its 1-based start line.
 */
function splitDocuments(content: string): Array<{ text: string; startLine: number }> {
  const lines = content.split('\n');
  const docs: Array<{ text: string; startLine: number }> = [];
  let start = 0;
  let current: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('---')) {
      if (current.length > 0) {
        docs.push({ text: current.join('\n'), startLine: start + 1 });
      }
      current = [];
      start = i + 1;
    } else {
      current.push(lines[i]!);
    }
  }
  if (current.length > 0) {
    docs.push({ text: current.join('\n'), startLine: start + 1 });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Bundle reference parsing
// ---------------------------------------------------------------------------

/** Parse "name@version" or "name@version#fingerprint". */
function parseBundleRef(ref: string): { name: string; version?: string; fingerprint?: string } | null {
  // Strip surrounding quotes just in case YAML parsing left them
  const clean = ref.replace(/^['"]|['"]$/g, '').trim();
  const atIdx = clean.indexOf('@');
  if (atIdx < 0) {
    return { name: clean };
  }
  const name = clean.slice(0, atIdx);
  const rest = clean.slice(atIdx + 1);
  const hashIdx = rest.indexOf('#');
  if (hashIdx < 0) {
    return { name, version: rest };
  }
  return { name, version: rest.slice(0, hashIdx), fingerprint: rest.slice(hashIdx + 1) };
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function collectYamlFiles(input: string): string[] {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(input);
  } catch {
    return [];
  }
  if (st.isFile()) {
    return extname(input).match(/\.(ya?ml)$/i) ? [input] : [];
  }
  if (st.isDirectory()) {
    const files: string[] = [];
    for (const entry of readdirSync(input, { withFileTypes: true })) {
      const full = join(input, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectYamlFiles(full));
      } else if (extname(entry.name).match(/\.(ya?ml)$/i)) {
        files.push(full);
      }
    }
    return files;
  }
  return [];
}

// ---------------------------------------------------------------------------
// CRD extraction from a single file
// ---------------------------------------------------------------------------

function extractCrds(file: string): ParsedCrd[] {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const docs = splitDocuments(content);
  const crds: ParsedCrd[] = [];

  for (const { text, startLine } of docs) {
    const parsed = parseYamlDoc(text, startLine);
    if (!parsed) continue;

    // Only process platform.connorhoehn.dev/* CRDs
    if (!parsed.apiVersion.includes('platform.connorhoehn.dev')) continue;

    crds.push({ ...parsed, file });
  }

  return crds;
}

// ---------------------------------------------------------------------------
// Lint logic
// ---------------------------------------------------------------------------

function lintOneCrd(crd: ParsedCrd): CrdResult {
  const result: CrdResult = { crd, hasError: false, hasWarn: false, lines: [] };
  const loc = crd.bundleLine ? `${crd.file}:${crd.bundleLine}` : crd.file;
  const header = `CRD: ${crd.kind}/${crd.name} (${loc})`;
  result.lines.push(header);

  if (!crd.eventBundle) {
    result.lines.push('  - no spec.eventBundle field — skipping bundle checks');
    return result;
  }

  const ref = parseBundleRef(crd.eventBundle);
  if (!ref) {
    result.lines.push(`  ✗ eventBundle: "${crd.eventBundle}" — cannot parse reference`);
    result.hasError = true;
    return result;
  }

  const bundle = getFeatureBundle(ref.name, ref.version);

  if (!bundle) {
    const versionSuffix = ref.version ? `@${ref.version}` : '';
    result.lines.push(`  ✗ eventBundle: ${ref.name}${versionSuffix} — BUNDLE NOT FOUND`);
    result.hasError = true;
    return result;
  }

  // Bundle exists
  const versionTag = `${bundle.name}@${bundle.version}`;
  result.lines.push(`  ✓ eventBundle: ${versionTag} exists`);

  // Fingerprint check
  if (ref.fingerprint) {
    const short = ref.fingerprint.length >= 64 ? ref.fingerprint : ref.fingerprint;
    const full = bundle.fingerprint;
    // Allow prefix matching (e.g. 12-char truncated fingerprint)
    const matches = full.startsWith(short) || short.startsWith(full);
    if (matches) {
      result.lines.push(`  ✓ fingerprint matches (${short.slice(0, 12)})`);
    } else {
      result.lines.push(
        `  ✗ fingerprint MISMATCH: CRD pins ${short.slice(0, 12)}… but catalog has ${full.slice(0, 12)}…`,
      );
      result.lines.push(`    current fingerprint: ${full}`);
      result.hasError = true;
    }
  } else {
    result.lines.push(`  · fingerprint not pinned (use ${bundle.name}@${bundle.version}#${bundle.fingerprint.slice(0, 12)} to pin)`);
  }

  // Deprecation check
  if (bundle.deprecated) {
    const since = bundle.deprecated.since;
    const replacement = bundle.deprecated.replacement ? ` — use ${bundle.deprecated.replacement} instead` : '';
    result.lines.push(`  ! eventBundle: ${versionTag} — version is deprecated since ${since}${replacement}`);
    result.hasWarn = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fix fingerprints mode
// ---------------------------------------------------------------------------

function fixFingerprints(file: string, crds: ParsedCrd[]): boolean {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  let modified = false;
  for (const crd of crds) {
    if (!crd.eventBundle) continue;
    const ref = parseBundleRef(crd.eventBundle);
    if (!ref) continue;
    const bundle = getFeatureBundle(ref.name, ref.version);
    if (!bundle) continue;
    if (!ref.fingerprint || bundle.fingerprint.startsWith(ref.fingerprint)) continue;

    // Replace the eventBundle value in place
    const oldRef = crd.eventBundle;
    const newRef = `${ref.name}@${bundle.version}#${bundle.fingerprint}`;
    content = content.replaceAll(oldRef, newRef);
    modified = true;
  }

  if (modified) {
    writeFileSync(file, content, 'utf8');
  }
  return modified;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function lintCrd(args: string[]): Promise<number> {
  const fixMode = args.includes('--fix-fingerprints');
  const helpMode = args.includes('--help') || args.includes('-h');

  const HELP = `
ec-lint-crd — validate Kubernetes CRD YAML files against the event-catalog bundle registry

USAGE
  ec-lint-crd <path-to-yaml-file-or-dir> [--fix-fingerprints]
  ec-lint-crd --help

ARGUMENTS
  <path>              YAML file or directory to scan (recursive)
  --fix-fingerprints  Rewrite stale fingerprints in-place with current catalog values
  --help, -h          Show this help

EXIT CODES
  0   All checked CRDs are valid
  1   At least one CRD has an error (bundle not found, fingerprint mismatch)
  2   Usage error or warnings only (deprecated bundles)

EXAMPLES
  ec-lint-crd crds/
  ec-lint-crd deploy/chatroom.yaml
  ec-lint-crd crds/ --fix-fingerprints

CI INTEGRATION (GitHub Actions)
  - name: Validate CRD bundles
    run: npx ec-lint-crd crds/
`.trim();

  if (helpMode) {
    console.log(HELP);
    return 0;
  }

  const paths = args.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error('ec-lint-crd: no path provided');
    console.error('usage: ec-lint-crd <path> [--fix-fingerprints]');
    return 2;
  }

  const allFiles: string[] = [];
  for (const p of paths) {
    const found = collectYamlFiles(p);
    if (found.length === 0) {
      // If path was a specific file but not yaml, warn
      let st: ReturnType<typeof statSync> | undefined;
      try { st = statSync(p); } catch { /* file not found */ }
      if (!st) {
        console.error(`ec-lint-crd: path not found: ${p}`);
        return 2;
      }
    }
    allFiles.push(...found);
  }

  if (allFiles.length === 0) {
    console.error('ec-lint-crd: no YAML files found in the given path(s)');
    return 2;
  }

  let totalCrds = 0;
  let totalErrors = 0;
  let totalWarns = 0;
  let totalSkipped = 0;
  let first = true;

  for (const file of allFiles) {
    const crds = extractCrds(file);

    if (crds.length === 0) {
      // Not a platform CRD file — skip silently
      continue;
    }

    if (fixMode) {
      const fixed = fixFingerprints(file, crds);
      if (fixed) {
        console.log(`[fixed] ${file}`);
      }
      // Re-read CRDs after fix for reporting
      const reCrds = extractCrds(file);
      for (const crd of reCrds) {
        if (!first) console.log('');
        first = false;
        if (!crd.eventBundle) { totalSkipped++; continue; }
        const result = lintOneCrd(crd);
        for (const line of result.lines) console.log(line);
        totalCrds++;
        if (result.hasError) totalErrors++;
        if (result.hasWarn) totalWarns++;
      }
    } else {
      for (const crd of crds) {
        if (!first) console.log('');
        first = false;
        if (!crd.eventBundle) { totalSkipped++; continue; }
        const result = lintOneCrd(crd);
        for (const line of result.lines) console.log(line);
        totalCrds++;
        if (result.hasError) totalErrors++;
        if (result.hasWarn) totalWarns++;
      }
    }
  }

  if (totalCrds === 0 && totalSkipped === 0) {
    console.log('ec-lint-crd: no platform.connorhoehn.dev CRDs with eventBundle found');
    return 0;
  }

  console.log('');
  console.log(
    `Summary: ${totalCrds} checked, ${totalErrors} error(s), ${totalWarns} warning(s)` +
      (totalSkipped > 0 ? `, ${totalSkipped} skipped (no eventBundle)` : ''),
  );

  if (totalErrors > 0) return 1;
  if (totalWarns > 0) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Standalone entry point (when invoked as ec-lint-crd directly)
// ---------------------------------------------------------------------------

// Detect if run directly (not imported as a module). Works in both CJS and ESM.
const _argv1 = process.argv[1] ?? '';
if (_argv1.endsWith('lint-crd.js') || _argv1.endsWith('lint-crd.ts') || _argv1.endsWith('ec-lint-crd')) {
  const args = process.argv.slice(2);
  void lintCrd(args).then((code) => process.exit(code));
}
