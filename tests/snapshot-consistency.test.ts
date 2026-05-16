// tests/snapshot-consistency.test.ts
//
// Guards against contracts/registry.snapshot.json drifting from the
// declarations in src/declarations/index.ts. Without this test the only
// safeguard was the prepublishOnly hook (fires only on npm publish).
//
// If this test fails: run `npm run snapshot:regen` and commit the result.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDeclarations } from '../src/declarations/index.js';
import { computeSchemaFingerprint } from '../src/registry/fingerprint.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const snapshotPath = join(ROOT, 'contracts', 'registry.snapshot.json');
const snapshot: Record<string, string> = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

describe('contracts/registry.snapshot.json — consistency with allDeclarations', () => {
    it('every declaration appears in the snapshot', () => {
        const missing = allDeclarations
            .filter((d) => !(d.name in snapshot))
            .map((d) => d.name);
        expect(missing, `declarations missing from snapshot (run npm run snapshot:regen): ${missing.join(', ')}`).toHaveLength(0);
    });

    it('every snapshot entry has the correct fingerprint for the current schema', () => {
        const mismatches: string[] = [];
        for (const decl of allDeclarations) {
            const expected = computeSchemaFingerprint(decl.schema);
            const actual = snapshot[decl.name];
            if (actual !== undefined && actual !== expected) {
                mismatches.push(`${decl.name}: snapshot=${actual.slice(0, 12)} computed=${expected.slice(0, 12)}`);
            }
        }
        expect(mismatches, `fingerprint mismatches (run npm run snapshot:regen): ${mismatches.join('; ')}`).toHaveLength(0);
    });

    it('snapshot has no phantom entries absent from allDeclarations', () => {
        const declared = new Set(allDeclarations.map((d) => d.name));
        const phantoms = Object.keys(snapshot).filter((name) => !declared.has(name));
        expect(phantoms, `snapshot has entries not in allDeclarations (run npm run snapshot:regen): ${phantoms.join(', ')}`).toHaveLength(0);
    });

    it('snapshot event count matches unique event names in allDeclarations', () => {
        const uniqueNames = new Set(allDeclarations.map((d) => d.name));
        expect(Object.keys(snapshot)).toHaveLength(uniqueNames.size);
    });
});
