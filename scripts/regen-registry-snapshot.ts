// scripts/regen-registry-snapshot.ts
//
// Regenerate `contracts/registry.snapshot.json` — the authoritative,
// shipped-in-package fingerprint manifest that producer CI diffs against.
//
// Invoked by `npm run snapshot:regen`. Commit the resulting JSON.
// Producers consume it via:
//   event-catalog drift --against=contracts/produced.snapshot.json \
//     --registry-snapshot=node_modules/@connorhoehn/event-catalog/contracts/registry.snapshot.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDeclarations } from '../src/declarations/index.js';
import { computeSchemaFingerprint } from '../src/registry/fingerprint.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'contracts', 'registry.snapshot.json');

const manifest: Record<string, string> = {};
for (const decl of allDeclarations) {
  manifest[decl.name] = computeSchemaFingerprint(decl.schema);
}

// Sort keys for stable diffs.
const sorted: Record<string, string> = {};
for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k]!;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(sorted, null, 2) + '\n');

console.log(`wrote ${outFile} (${Object.keys(sorted).length} events)`);
