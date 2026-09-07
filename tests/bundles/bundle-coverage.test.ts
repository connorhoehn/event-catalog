// tests/bundles/bundle-coverage.test.ts
//
// The bundle-layer audit, as a test.
//
// The registry grew from 194 to 225 events across several sweeps without
// anyone checking whether the bundles kept up; by the time it was checked,
// 148 of 225 events belonged to no bundle and one shipped bundle failed
// validateBundle against the shipped registry. These tests exist so that
// cannot happen silently again:
//
//   1. no bundle may reference an event the registry does not declare
//      (a fiction makes ec-lint-crd validate against nothing)
//   2. every shipped bundle must validate against the real registry
//   3. every declared event must either be in a bundle or be on the
//      documented unbundled list below — a NEW event that is neither
//      fails this file and forces the bundle question at declaration time
//   4. bundle fingerprints must be a function of the member set ALONE

import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { allDeclarations } from '../../src/declarations/index.js';
import { allBundles } from '../../src/declarations/bundles/index.js';
import {
  computeFingerprint,
  validateBundle,
  type FeatureBundle,
} from '../../src/bundles/FeatureBundle.js';

function realRegistry(): Registry {
  const registry = new Registry();
  for (const decl of allDeclarations) registry.declare(decl);
  return registry;
}

const declaredNames = new Set(allDeclarations.map((d) => d.name));
const bundledNames = new Set(allBundles.flatMap((b) => b.events.map((e) => e.name)));

// ---------------------------------------------------------------------------
// 1. Accuracy — no bundle references a non-existent event
// ---------------------------------------------------------------------------

describe('bundle accuracy — every member event is really declared', () => {
  it.each(allBundles.map((b) => [b.name, b] as const))(
    '%s references only declared events',
    (_name, bundle) => {
      const fictions = bundle.events
        .map((e) => e.name)
        .filter((n) => !declaredNames.has(n));
      expect(fictions).toEqual([]);
    },
  );

  it('no bundle marks a non-existent event as required', () => {
    // A required member that nothing declares fails a CRD lint for the wrong
    // reason: the operator's CRD is fine, the bundle is lying.
    const offenders: string[] = [];
    for (const bundle of allBundles) {
      for (const ref of bundle.events) {
        if (ref.required !== false && !declaredNames.has(ref.name)) {
          offenders.push(`${bundle.name}@${bundle.version} requires "${ref.name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no bundle pins an event version the registry does not have', () => {
    const registry = realRegistry();
    const offenders: string[] = [];
    for (const bundle of allBundles) {
      for (const ref of bundle.events) {
        if (ref.version === undefined) continue;
        const entry = registry.get(ref.name);
        if (entry && entry.version !== ref.version) {
          offenders.push(
            `${bundle.name} pins ${ref.name}@v${ref.version}, registry has v${entry.version}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Every shipped bundle validates against the real registry
// ---------------------------------------------------------------------------

describe('bundle validity against the real catalog', () => {
  it.each(allBundles.map((b) => [`${b.name}@${b.version}`, b] as const))(
    '%s validates cleanly',
    (_id, bundle) => {
      // Regression: agentic-pipeline-durable@1.0.0 shipped INVALID because
      // validateBundle demanded transport equality, and its three approval
      // events are declared transport:'both'. Narrowing to one bus is legal.
      expect(validateBundle(bundle, realRegistry()).errors).toEqual([]);
    },
  );

  it('bundle names are unique per version', () => {
    const seen = new Set<string>();
    for (const b of allBundles) {
      const key = `${b.name}@${b.version}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('exactly one bundle is deprecated, and it names a live replacement', () => {
    const deprecated = allBundles.filter((b) => b.deprecated !== undefined);
    expect(deprecated.map((b) => `${b.name}@${b.version}`)).toEqual([
      'agentic-pipeline@1.0.0',
    ]);
    const replacement = deprecated[0]!.deprecated!.replacement;
    expect(replacement).toBe('agentic-pipeline-signal@1.0.0');
    const [name, version] = replacement!.split('@');
    expect(allBundles.some((b) => b.name === name && b.version === version)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Coverage census — the documented unbundled set
// ---------------------------------------------------------------------------

/**
 * Events that deliberately belong to no bundle, with the reason. Every entry
 * here is a decision someone made; nothing lands here by accident.
 *
 * Four reasons appear:
 *
 *   (a) INBOUND HALVES — `client.*` are the client→server contract frames
 *       for features whose server→client halves are already bundled (chat,
 *       presence, cursor, reactions, crdt, fileupload, videohangout).
 *       Folding them into those bundles is correct but changes their
 *       fingerprints, so it is a 2.0.0 decision for the operator, not a
 *       silent edit. Same for the `ws.*` stragglers below.
 *
 *   (b) CHANNEL-SCOPED DUPLICATES — `orgiq.*` carry per-channel metadata for
 *       frames the orgiq-newsroom bundle already covers generically.
 *
 *   (c) PIPELINE INTERNALS — judge / image-vision / llm / raft / step-attempt
 *       / context-patch families are sub-capabilities of the agentic pipeline
 *       rather than separately adoptable deployment features. They would
 *       extend agentic-pipeline-signal@2.0.0.
 *
 *   (d) ALIASES — the deprecated pipeline run-resume spellings.
 */
const INTENTIONALLY_UNBUNDLED: readonly string[] = [
  // (a) durable mirrors of bundled signal features — activity@2.0.0 / reactions@2.0.0
  'activity.recorded',
  'call:reaction.recorded',
  // (a) inbound client→server contract frames
  'client.activity.getHistory',
  'client.activity.subscribe',
  'client.activity.unsubscribe',
  'client.chat.history',
  'client.chat.join',
  'client.chat.leave',
  'client.chat.send',
  'client.crdt.awareness',
  'client.crdt.subscribe',
  'client.crdt.unsubscribe',
  'client.crdt.update',
  'client.fileupload.cancel',
  'client.fileupload.complete',
  'client.fileupload.request-upload',
  'client.presence.get',
  'client.presence.heartbeat',
  'client.presence.set',
  'client.presence.subscribe',
  'client.presence.unsubscribe',
  'client.reaction.getAvailable',
  'client.reaction.send',
  'client.reaction.subscribe',
  'client.reaction.unsubscribe',
  'client.subscribe.subscribe',
  'client.subscribe.unsubscribe',
  'client.videohangout.end',
  'client.videohangout.join',
  'client.videohangout.leave',
  'client.videohangout.start',
  'client.videohangout.toggle-audio',
  'client.videohangout.toggle-video',
  // (b) channel-scoped duplicates of orgiq-newsroom's generic members
  'orgiq.invoke.presence',
  'orgiq.newsroom-articles.reactions',
  'orgiq.newsroom-briefs.presence',
  'orgiq.newsroom-researcher.activity',
  'orgiq.newsroom-researcher.presence',
  'orgiq.search.presence',
  // (c) pipeline internals — agentic-pipeline-signal@2.0.0 / -durable@2.0.0
  'pipeline.run.checkpoint',
  'pipeline:image:vision:analyzed',
  'pipeline:image:vision:failed',
  'pipeline:image:vision:started',
  'pipeline:image:vision:token',
  'pipeline:judge:budget-exceeded',
  'pipeline:judge:failed',
  'pipeline:judge:scored',
  'pipeline:judge:started',
  'pipeline:llm:prompt',
  'pipeline:llm:response',
  'pipeline:llm:stream:opened',
  'pipeline:llm:token',
  'pipeline:raft:run:checkpointed',
  'pipeline:raft:run:started',
  'pipeline:raft:run:synthesized',
  'pipeline:raft:run:terminated',
  'pipeline:raft:run:updated',
  'pipeline:step:agent:tool',
  'pipeline:step:attempt:failed',
  'pipeline:step:attempt:started',
  'pipeline:step:context.patch-reverted',
  'pipeline:step:context.patched',
  'pipeline:step:context.patched-unvalidated',
  // (d) deprecated run-resume alias spellings
  'pipeline:run:resumeFromStep',
  'pipeline:run:resumed-from-step',
  // (a) ws.* stragglers of already-bundled families
  'ws.capability.updated',
  'ws.crdt.awareness',
  'ws.feature-flag.updated',
  'ws.fileupload.cancelled',
  'ws.fileupload.progress',
  'ws.fileupload.scanning',
  'ws.pipeline.ack',
  'ws.pipeline.event',
  'ws.pipeline.history',
  'ws.pipeline.snapshot',
  'ws.pipeline.subscribed',
  'ws.pipeline.unsubscribed',
  'ws.presence.joined',
  'ws.presence.left',
  'ws.reaction.available',
  'ws.reaction.unsubscribed',
  'ws.videohangout.media',
  'ws.videohangout.participant',
];

describe('bundle coverage census', () => {
  it('every declared event is bundled or on the documented unbundled list', () => {
    const allowed = new Set(INTENTIONALLY_UNBUNDLED);
    const undecided = [...declaredNames]
      .filter((n) => !bundledNames.has(n) && !allowed.has(n))
      .sort();

    // If this fails you added events without deciding where they belong.
    // Put them in a bundle, or add them to INTENTIONALLY_UNBUNDLED with a
    // reason. Do NOT delete the assertion.
    expect(undecided).toEqual([]);
  });

  it('the unbundled list has no stale entries', () => {
    const stale = INTENTIONALLY_UNBUNDLED.filter(
      (n) => !declaredNames.has(n) || bundledNames.has(n),
    );
    expect(stale).toEqual([]);
  });

  it('the majority of declared events are covered by a bundle', () => {
    // 148/225 unbundled was the pre-audit state. This is a floor, not a
    // target: raising coverage is fine, silently regressing past it is not.
    const covered = [...declaredNames].filter((n) => bundledNames.has(n)).length;
    expect(covered).toBeGreaterThanOrEqual(declaredNames.size / 2);
  });
});

// ---------------------------------------------------------------------------
// 4. Fingerprints are a function of the member set alone
// ---------------------------------------------------------------------------

describe('bundle fingerprint semantics', () => {
  const base: Omit<FeatureBundle, 'fingerprint'> = {
    name: 'probe',
    version: '1.0.0',
    transport: 'signal',
    events: [{ name: 'ws.chat.message', required: true }, { name: 'ws.error', required: false }],
  };

  it('is insensitive to description edits', () => {
    // Sweeps that add `description`/`format` annotations to event SCHEMAS
    // move every schema fingerprint. They must not move bundle fingerprints,
    // or every such sweep breaks operators' pinned CRDs for a comment change.
    const a = computeFingerprint({ ...base, description: 'one' } as FeatureBundle);
    const b = computeFingerprint({ ...base, description: 'two' } as FeatureBundle);
    expect(a).toBe(b);
  });

  it('is insensitive to deprecation metadata', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({
      ...base,
      deprecated: { since: 'v9.9.9', replacement: 'other@1.0.0' },
    } as FeatureBundle);
    expect(a).toBe(b);
  });

  it('is insensitive to the declared transport', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, transport: 'durable' });
    expect(a).toBe(b);
  });

  it('is insensitive to member ordering', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, events: [...base.events].reverse() });
    expect(a).toBe(b);
  });

  it('IS sensitive to adding a member', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({
      ...base,
      events: [...base.events, { name: 'ws.chat.sent', required: true }],
    });
    expect(a).not.toBe(b);
  });

  it('IS sensitive to flipping a member from optional to required', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({
      ...base,
      events: [{ name: 'ws.chat.message', required: true }, { name: 'ws.error', required: true }],
    });
    expect(a).not.toBe(b);
  });

  it('does NOT track member schema fingerprints — a documented gap', () => {
    // A member event's schema can change in a breaking way and the bundle
    // fingerprint will not move, because computeFingerprint hashes only
    // {name, version, events[]}. That is deliberate (annotation sweeps must
    // not break CRD pins) but it means a bundle pin is a pin on the event
    // SET, not on the event CONTRACTS. Pin EventReference.version to get
    // schema-level drift detection.
    const withPin = computeFingerprint({
      ...base,
      events: [{ name: 'ws.chat.message', required: true, version: 2 }, base.events[1]!],
    });
    expect(withPin).not.toBe(computeFingerprint(base));
  });

  it('every shipped bundle carries a full 64-char hex fingerprint matching its members', () => {
    for (const b of allBundles) {
      expect(b.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(b.fingerprint).toBe(computeFingerprint(b));
    }
  });

  it('all shipped bundle fingerprints are distinct', () => {
    const fps = allBundles.map((b) => b.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Fingerprint lockfile for the pre-audit bundles
// ---------------------------------------------------------------------------

describe('pre-existing bundle fingerprints are unchanged', () => {
  // Operators pin these in CRDs. The audit that added ag-ui-stream, sfu-*,
  // call-captions and notifications deliberately touched no existing member
  // list; these values prove it. Changing one of these is a MAJOR bump.
  const LOCKED: Record<string, string> = {
    chat: 'cae711784c55',
    presence: '41027a4c1a75',
    cursor: '7a6507b0a25a',
    reactions: 'd8bf4b052668',
    activity: '3160761f23fa',
    'agentic-pipeline': '8a04066a3df2',
    'agentic-pipeline-signal': '27447d2fa6ae',
    'agentic-pipeline-durable': 'c33197332ed2',
    'crdt-document': '9513bde19f40',
    'video-hangout': '2bce55d61fe2',
    'file-upload': 'd8d4dcd53aec',
    'orgiq-newsroom': '52b6dfd9152d',
  };

  it.each(Object.entries(LOCKED))('%s still fingerprints as %s', (name, prefix) => {
    const bundle = allBundles.find((b) => b.name === name);
    expect(bundle).toBeDefined();
    expect(bundle!.fingerprint.slice(0, 12)).toBe(prefix);
  });
});
