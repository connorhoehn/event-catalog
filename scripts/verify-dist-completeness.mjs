#!/usr/bin/env node
// Verifies dist/ is consistent with package.json exports map and bin entries.
// Run as part of prepublishOnly or manually as a release gate.
//
// Guards against the class of bug that hit DC v0.36.0 (control-plane/ missing
// from dist tarball): a new subpath added to package.json exports or a new
// CLI script declared in bin but the corresponding dist file not built/committed.
//
// Two checks:
//   1. Every file referenced in the exports map exists on disk.
//   2. Every file referenced in the bin map exists on disk.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const exportsMap = pkg.exports ?? {};
const binMap = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});

const errors = [];

// ---------------------------------------------------------------------------
// Check 1: every file referenced in exports map must exist on disk
// ---------------------------------------------------------------------------
for (const [exportPath, entry] of Object.entries(exportsMap)) {
  // Skip glob patterns — they can't be statically verified.
  if (exportPath.includes('*')) continue;

  const filePaths =
    typeof entry === 'string'
      ? [entry]
      : Object.values(entry).filter((p) => typeof p === 'string');

  for (const p of filePaths) {
    if (p.includes('*')) continue;
    const abs = resolve(repoRoot, p);
    if (!existsSync(abs)) {
      errors.push(`Missing dist file for export '${exportPath}': ${p}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2: every file referenced in bin map must exist on disk
// ---------------------------------------------------------------------------
for (const [binName, binPath] of Object.entries(binMap)) {
  const abs = resolve(repoRoot, binPath);
  if (!existsSync(abs)) {
    errors.push(`Missing dist file for bin '${binName}': ${binPath}`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const exportCount = Object.keys(exportsMap).filter((k) => !k.includes('*')).length;
const binCount = Object.keys(binMap).length;

if (errors.length) {
  console.error('Dist verification FAILED:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log(
  `Dist verification passed: ${exportCount} exports + ${binCount} bin entries — all have backing dist files.`,
);
