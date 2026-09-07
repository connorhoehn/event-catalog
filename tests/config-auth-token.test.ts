// tests/config-auth-token.test.ts
//
// $EVENT_CATALOG_AUTH_TOKEN as seen by the boot-config gate.
//
// The variable is the ONLY thing that turns admin-API authentication on,
// so the load-bearing case here is the first one: an environment that
// does not mention it resolves to `authToken: undefined` with no error
// and no warning — the deployment behaves exactly as it did before the
// variable existed. The rest is the refusal to boot on a token nobody
// could use: empty (a broken `${VAR}` interpolation), too short to
// survive a brute-force, or carrying whitespace an HTTP header would
// mangle.

import { describe, it, expect } from 'vitest';
import { resolveServerConfig, describeConfig } from '../src/cli/config.js';
import { MIN_AUTH_TOKEN_LENGTH } from '../src/server/auth.js';

const REDIS = 'redis://localhost:6379';
const GOOD_TOKEN = 'c0ffee0123456789abcdef0123456789';

function baseEnv(extra: Record<string, string | undefined> = {}) {
  return { REDIS_URL: REDIS, ...extra };
}

describe('EVENT_CATALOG_AUTH_TOKEN — unset means off', () => {
  it('resolves to no token, no error and no warning', () => {
    const result = resolveServerConfig(baseEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authToken).toBeUndefined();
    expect(result.warnings.join('\n')).not.toMatch(/auth/i);
  });

  it('reports auth as disabled in the boot banner', () => {
    const result = resolveServerConfig(baseEnv());
    if (!result.ok) throw new Error('expected ok');
    const banner = describeConfig(result.config).join('\n');
    expect(banner).toContain('api auth');
    expect(banner).toContain('disabled');
  });
});

describe('EVENT_CATALOG_AUTH_TOKEN — set and usable', () => {
  it('resolves the token', () => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: GOOD_TOKEN }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authToken).toBe(GOOD_TOKEN);
  });

  it('trims surrounding whitespace — a $(cat secret-file) keeps its newline', () => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: `${GOOD_TOKEN}\n` }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.authToken).toBe(GOOD_TOKEN);
  });

  it('says auth is on in the banner without printing the secret', () => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: GOOD_TOKEN }));
    if (!result.ok) throw new Error('expected ok');
    const banner = describeConfig(result.config).join('\n');
    expect(banner).toMatch(/api auth\s+bearer token/);
    expect(banner).not.toContain(GOOD_TOKEN);
  });
});

describe('EVENT_CATALOG_AUTH_TOKEN — refuses to boot on an unusable value', () => {
  it.each([
    ['empty (a broken ${VAR} interpolation)', ''],
    ['whitespace only', '   '],
    ['too short', 'changeme'],
    ['contains a space', 'two words in here somewhere'],
  ])('rejects %s', (_label, value) => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: value }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('$EVENT_CATALOG_AUTH_TOKEN');
  });

  it('names the minimum length so the operator knows what to do', () => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: 'short' }));
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.join('\n')).toContain(String(MIN_AUTH_TOKEN_LENGTH));
  });

  it('never echoes the rejected value into the log', () => {
    const result = resolveServerConfig(baseEnv({ EVENT_CATALOG_AUTH_TOKEN: 'sekrit' }));
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.join('\n')).not.toContain('sekrit');
  });

  it('is reported alongside every other problem, not instead of them', () => {
    // The module's contract: one restart teaches the operator about all
    // of their mistakes.
    const result = resolveServerConfig({
      REDIS_URL: REDIS,
      PORT: 'not-a-port',
      EVENT_CATALOG_AUTH_TOKEN: 'x',
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toContain('$PORT');
    expect(result.errors.join('\n')).toContain('$EVENT_CATALOG_AUTH_TOKEN');
  });
});
