// tests/openapi-sync.test.ts
//
// Guards openapi/event-catalog.yaml against drifting from src/server/routes.ts.
// Runs the existing openapi-check.ts script and fails the test suite if the
// spec is out of sync. Without this, the only safeguard was a manual
// `npm run openapi:check` call that's easy to forget.
//
// If this test fails: run `npm run openapi:check` to see the exact diff,
// then update openapi/event-catalog.yaml to match the code.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts', 'openapi-check.ts');

describe('openapi/event-catalog.yaml — route coverage', () => {
    it('spec has no undocumented routes (code routes absent from spec)', () => {
        let stdout = '';
        try {
            stdout = execFileSync('npx', ['tsx', SCRIPT], {
                cwd: ROOT,
                encoding: 'utf8',
                timeout: 30_000,
            });
        } catch (err: unknown) {
            const e = err as { stdout?: string; stderr?: string; status?: number };
            const output = [e.stdout, e.stderr].filter(Boolean).join('\n');
            throw new Error(
                `OpenAPI spec is out of sync with routes.ts.\n` +
                `Run \`npm run openapi:check\` for details, then update openapi/event-catalog.yaml.\n\n` +
                output,
            );
        }
        // Script exited 0 — confirm the success message is present
        expect(stdout).toContain('in sync');
    });
});
