// tests/openapi-sync.test.ts
//
// Guards openapi/event-catalog.yaml against drifting from the handlers in
// src/server/routes/*.ts. Runs scripts/openapi-check.ts and fails the suite
// if the spec no longer describes the API the server implements. Without
// this, the only safeguard was a manual `npm run openapi:check` call that's
// easy to forget.
//
// The script checks four things (see its header for the trade-offs):
//   1. routes      — documented ⇔ registered, both directions
//   2. statuses    — every documented status is reachable from the handler
//   3. parameters  — documented ⇔ read by the handler, both directions
//   4. refs        — every $ref resolves
//
// If this test fails: run `npm run openapi:check` to see the exact diff.
// The CODE is the source of truth — fix openapi/event-catalog.yaml, not
// the handler.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = resolve(ROOT, 'scripts', 'openapi-check.ts');

function runCheck(): string {
    try {
        return execFileSync('npx', ['tsx', SCRIPT], {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 60_000,
        });
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string };
        const output = [e.stdout, e.stderr].filter(Boolean).join('\n');
        throw new Error(
            `openapi/event-catalog.yaml no longer matches the handlers.\n`
            + `Run \`npm run openapi:check\` for details, then fix the spec.\n\n`
            + output,
        );
    }
}

describe('openapi/event-catalog.yaml', () => {
    const stdout = runCheck();

    it('documents exactly the routes the server registers', () => {
        expect(stdout).toContain('in sync');
    });

    it('passes the status-code, parameter and $ref checks', () => {
        // The script only prints this line when every check passed; a
        // failure exits non-zero and is rethrown by runCheck above.
        expect(stdout).toContain('routes ✓  status codes ✓  parameters ✓  component refs ✓');
    });
});
