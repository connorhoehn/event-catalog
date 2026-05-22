// tests/bundles/video-hangout-bundle.test.ts
//
// Validates the video-hangout FeatureBundle declaration against the event catalog.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { videoHangoutBundle } from '../../src/declarations/bundles/video-hangout.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

describe('videoHangoutBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(videoHangoutBundle.fingerprint).toBeTruthy();
    expect(videoHangoutBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { videoHangoutBundle: reloaded } = await import('../../src/declarations/bundles/video-hangout.js');
    expect(reloaded.fingerprint).toBe(videoHangoutBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(videoHangoutBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = videoHangoutBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(videoHangoutBundle.transport).toBe('signal');
  });

  it('has a non-empty events list', () => {
    expect(videoHangoutBundle.events.length).toBeGreaterThan(0);
  });

  it('has a non-empty description', () => {
    expect(videoHangoutBundle.description).toBeTruthy();
  });
});
