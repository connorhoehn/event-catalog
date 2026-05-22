// tests/bundles/chat-bundle.test.ts
//
// Validates the chat and presence FeatureBundle declarations against
// the real event catalog to catch event name drift.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { gatewaySignalDeclarations } from '../../src/declarations/gateway-signal.js';
import { validateBundle } from '../../src/bundles/FeatureBundle.js';
import { chatBundle } from '../../src/declarations/bundles/chat.js';
import { presenceBundle } from '../../src/declarations/bundles/presence.js';
import { allBundles } from '../../src/declarations/bundles/index.js';

let registry: Registry;

beforeAll(() => {
  registry = new Registry();
  for (const decl of gatewaySignalDeclarations) {
    registry.declare(decl);
  }
});

// ---------------------------------------------------------------------------
// chatBundle
// ---------------------------------------------------------------------------

describe('chatBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(chatBundle.fingerprint).toBeTruthy();
    expect(chatBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { chatBundle: reloaded } = await import('../../src/declarations/bundles/chat.js');
    expect(reloaded.fingerprint).toBe(chatBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(chatBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = chatBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(chatBundle.transport).toBe('signal');
  });

  it('has a non-empty description', () => {
    expect(chatBundle.description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// presenceBundle
// ---------------------------------------------------------------------------

describe('presenceBundle declaration', () => {
  it('has a non-empty fingerprint', () => {
    expect(presenceBundle.fingerprint).toBeTruthy();
    expect(presenceBundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint is stable across module re-imports', async () => {
    const { presenceBundle: reloaded } = await import('../../src/declarations/bundles/presence.js');
    expect(reloaded.fingerprint).toBe(presenceBundle.fingerprint);
  });

  it('validates successfully against the real event catalog', () => {
    const result = validateBundle(presenceBundle, registry);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('all required events are present in the catalog', () => {
    const missing = presenceBundle.events
      .filter((e) => e.required !== false)
      .filter((e) => !registry.get(e.name));
    expect(missing).toHaveLength(0);
  });

  it('has transport set to "signal"', () => {
    expect(presenceBundle.transport).toBe('signal');
  });
});

// ---------------------------------------------------------------------------
// allBundles aggregate
// ---------------------------------------------------------------------------

describe('allBundles aggregate', () => {
  it('contains both sample bundles', () => {
    const names = allBundles.map((b) => b.name);
    expect(names).toContain('chat');
    expect(names).toContain('presence');
  });

  it('each bundle has a unique fingerprint', () => {
    const fps = allBundles.map((b) => b.fingerprint);
    const unique = new Set(fps);
    expect(unique.size).toBe(allBundles.length);
  });

  it('each bundle fingerprint is a 64-char hex string', () => {
    for (const bundle of allBundles) {
      expect(bundle.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
