// tests/config-compression.test.ts
//
// The `$EVENT_CATALOG_COMPRESSION*` knobs, through the same validated
// boot gate every other setting goes through. Compression is ON by
// default, which makes it a behavior change for every consumer — so the
// default itself is asserted here, and so is the one-variable revert.

import { describe, it, expect } from 'vitest';
import { resolveServerConfig, describeConfig } from '../src/cli/config.js';
import {
  DEFAULT_COMPRESSION_LEVEL,
  DEFAULT_COMPRESSION_THRESHOLD,
  DEFAULT_ENCODINGS,
} from '../src/server/compression.js';

const REDIS = 'redis://localhost:6379';

function env(extra: Record<string, string | undefined> = {}) {
  return { REDIS_URL: REDIS, ...extra };
}

function ok(result: ReturnType<typeof resolveServerConfig>) {
  if (!result.ok) throw new Error(`expected ok, got:\n${result.errors.join('\n')}`);
  return result;
}

function errors(result: ReturnType<typeof resolveServerConfig>): string[] {
  if (result.ok) throw new Error('expected failure, got a resolved config');
  return result.errors;
}

describe('compression config', () => {
  it('is ON by default, at the 1 KiB floor and zlib level 6', () => {
    const { config } = ok(resolveServerConfig(env()));
    expect(config.compression).toEqual({
      enabled: true,
      threshold: DEFAULT_COMPRESSION_THRESHOLD,
      level: DEFAULT_COMPRESSION_LEVEL,
      encodings: DEFAULT_ENCODINGS,
    });
  });

  it('EVENT_CATALOG_COMPRESSION=off is the whole revert', () => {
    for (const off of ['off', 'false', '0', 'no']) {
      const { config } = ok(resolveServerConfig(env({ EVENT_CATALOG_COMPRESSION: off })));
      expect(config.compression.enabled, off).toBe(false);
    }
    for (const on of ['on', 'true', '1', 'yes']) {
      const { config } = ok(resolveServerConfig(env({ EVENT_CATALOG_COMPRESSION: on })));
      expect(config.compression.enabled, on).toBe(true);
    }
  });

  it('rejects a compression flag it cannot read instead of guessing', () => {
    const errs = errors(resolveServerConfig(env({ EVENT_CATALOG_COMPRESSION: 'sure' })));
    expect(errs.some(e => e.includes('EVENT_CATALOG_COMPRESSION'))).toBe(true);
  });

  it('accepts a custom threshold and level', () => {
    const { config } = ok(resolveServerConfig(env({
      EVENT_CATALOG_COMPRESSION_THRESHOLD: '4096',
      EVENT_CATALOG_COMPRESSION_LEVEL: '1',
    })));
    expect(config.compression.threshold).toBe(4096);
    expect(config.compression.level).toBe(1);
  });

  it('warns about a threshold so low that gzip makes responses bigger', () => {
    const { warnings } = ok(resolveServerConfig(env({
      EVENT_CATALOG_COMPRESSION_THRESHOLD: '32',
    })));
    expect(warnings.some(w => w.includes('LARGER'))).toBe(true);
  });

  it('rejects a negative or non-integer threshold', () => {
    for (const bad of ['-1', '1.5', 'abc', '1e3']) {
      const errs = errors(resolveServerConfig(env({
        EVENT_CATALOG_COMPRESSION_THRESHOLD: bad,
      })));
      expect(errs.some(e => e.includes('COMPRESSION_THRESHOLD')), bad).toBe(true);
    }
  });

  it('rejects a zlib level outside 1-9', () => {
    for (const bad of ['0', '10', '-3', 'six']) {
      const errs = errors(resolveServerConfig(env({
        EVENT_CATALOG_COMPRESSION_LEVEL: bad,
      })));
      expect(errs.some(e => e.includes('COMPRESSION_LEVEL')), bad).toBe(true);
    }
  });

  it('reports every compression problem in one pass', () => {
    const errs = errors(resolveServerConfig(env({
      EVENT_CATALOG_COMPRESSION: 'perhaps',
      EVENT_CATALOG_COMPRESSION_THRESHOLD: '-5',
      EVENT_CATALOG_COMPRESSION_LEVEL: '99',
    })));
    expect(errs).toHaveLength(3);
  });

  it('shows up in the startup banner, both ways', () => {
    const on = describeConfig(ok(resolveServerConfig(env())).config);
    expect(on.some(l => l.includes('response compression') && l.includes('gzip'))).toBe(true);

    const off = describeConfig(
      ok(resolveServerConfig(env({ EVENT_CATALOG_COMPRESSION: 'off' }))).config,
    );
    expect(off.some(l => l.includes('response compression') && l.includes('disabled'))).toBe(true);
  });
});
