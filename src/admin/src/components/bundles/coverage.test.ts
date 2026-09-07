// The coverage diff — the computation the whole /coverage view is a window on.
//
// Two halves: hand-built cases that pin the rules an operator's decision
// depends on (absent-means-required, deprecated-only cover, dangling members),
// and the real catalog, where the numbers have to add up across 226 events
// and 18 bundles rather than the four a hand-written fixture would have.

import { describe, expect, it } from 'vitest';
import { computeCoverage, lookupEvents, namespaceOf } from './coverage';
import type { EventEntry, FeatureBundleEntry } from '../../api';
import {
  REAL_BUNDLE_COUNT,
  REAL_EVENT_COUNT,
  realBundleMemberNames,
  realBundles,
  realEvents,
} from '../../test/fixtures/registry';

function event(name: string, over: Partial<EventEntry> = {}): EventEntry {
  return {
    name,
    namespace: name.split(/[.:]/)[0]!,
    transport: 'signal',
    producer: 'platform-api',
    schema: {},
    subscribers: [],
    metadata: { createdAt: '', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
    stats: null,
    ...over,
  };
}

function bundle(
  name: string,
  events: FeatureBundleEntry['events'],
  over: Partial<FeatureBundleEntry> = {},
): FeatureBundleEntry {
  return {
    name,
    version: '1.0.0',
    fingerprint: 'f'.repeat(64),
    transport: 'signal',
    events,
    ...over,
  };
}

describe('computeCoverage — the rules a CRD pin depends on', () => {
  it('splits declared events into covered and uncovered', () => {
    const cov = computeCoverage(
      [event('ws.chat.message'), event('ws.chat.sent'), event('ws.typing')],
      [bundle('chat', [{ name: 'ws.chat.message' }, { name: 'ws.chat.sent' }])],
    );
    expect(cov.total).toBe(3);
    expect(cov.covered).toBe(2);
    expect(cov.uncovered).toBe(1);
    expect(cov.percent).toBe(67);
    expect(cov.namespaces[0]!.uncoveredEvents.map((r) => r.name)).toEqual(['ws.typing']);
  });

  it('treats an absent `required` flag as required, the way the server does', () => {
    // validateBundle fails a missing member unless it was declared
    // `required: false`. Rendering the absent case as "optional" would tell
    // an operator the gate is lenient when it is not.
    const cov = computeCoverage(
      [event('ws.error'), event('ws.chat.message')],
      [bundle('chat', [{ name: 'ws.chat.message' }, { name: 'ws.error', required: false }])],
    );
    const byName = Object.fromEntries(cov.rows.map((r) => [r.name, r]));
    expect(byName['ws.chat.message']!.bundles[0]!.required).toBe(true);
    expect(byName['ws.error']!.bundles[0]!.required).toBe(false);
  });

  it('flags an event whose only bundle is deprecated — covered, but not pinnable', () => {
    const cov = computeCoverage(
      [event('pipeline:run:started'), event('pipeline:step:started')],
      [
        bundle('agentic-pipeline', [{ name: 'pipeline:run:started' }], {
          deprecated: { since: 'v0.3.45', replacement: 'agentic-pipeline-signal@1.0.0' },
        }),
        bundle('agentic-pipeline-signal', [{ name: 'pipeline:step:started' }]),
      ],
    );
    expect(cov.uncovered).toBe(0);
    expect(cov.onlyDeprecated).toBe(1);
    const row = cov.rows.find((r) => r.name === 'pipeline:run:started')!;
    expect(row.covered).toBe(true);
    expect(row.onlyDeprecated).toBe(true);
    expect(cov.namespaces[0]!.onlyDeprecated).toBe(1);
  });

  it('does not call an event deprecated-only when a live bundle also holds it', () => {
    const cov = computeCoverage(
      [event('pipeline:run:started')],
      [
        bundle('agentic-pipeline', [{ name: 'pipeline:run:started' }], {
          deprecated: { since: 'v0.3.45' },
        }),
        bundle('agentic-pipeline-signal', [{ name: 'pipeline:run:started' }]),
      ],
    );
    expect(cov.onlyDeprecated).toBe(0);
    expect(cov.rows[0]!.bundles).toHaveLength(2);
  });

  it('reports a bundle member the catalog does not declare', () => {
    const cov = computeCoverage(
      [event('ws.chat.message')],
      [bundle('chat', [{ name: 'ws.chat.message' }, { name: 'ws.chat.ghost' }])],
    );
    expect(cov.dangling).toEqual([
      expect.objectContaining({ name: 'ws.chat.ghost', required: true }),
    ]);
    // A dangling member is not an event, so it must not inflate the totals.
    expect(cov.total).toBe(1);
    expect(cov.covered).toBe(1);
  });

  it('orders namespaces by the size of the gap, not alphabetically', () => {
    const cov = computeCoverage(
      [
        event('a:one'),
        event('z:one'),
        event('z:two'),
        event('z:three'),
        event('m:one'),
        event('m:two'),
      ],
      [bundle('m-bundle', [{ name: 'm:one' }])],
    );
    // Biggest gap first; ties fall back to alphabetical so the order is
    // stable between refreshes rather than following Map insertion.
    expect(cov.namespaces.map((n) => `${n.namespace}:${n.uncovered}`)).toEqual([
      'z:3',
      'a:1',
      'm:1',
    ]);
  });

  it('survives an empty catalog and an empty bundle registry', () => {
    const cov = computeCoverage([], []);
    expect(cov).toMatchObject({ total: 0, covered: 0, uncovered: 0, percent: 0 });
    expect(cov.namespaces).toEqual([]);
  });

  it('counts every declared event exactly once, in exactly one namespace', () => {
    const cov = computeCoverage(realEvents, realBundles);
    expect(cov.covered + cov.uncovered).toBe(cov.total);
    const grouped = cov.namespaces.reduce((sum, n) => sum + n.total, 0);
    expect(grouped).toBe(cov.total);
    const gaps = cov.namespaces.reduce((sum, n) => sum + n.uncovered, 0);
    expect(gaps).toBe(cov.uncovered);
  });
});

describe('namespaceOf', () => {
  it('prefers the namespace the server resolved', () => {
    expect(namespaceOf({ name: 'ws.chat.message', namespace: 'ws' })).toBe('ws');
  });

  it('falls back to the first segment, for either separator', () => {
    expect(namespaceOf({ name: 'pipeline:run:started' })).toBe('pipeline');
    expect(namespaceOf({ name: 'ws.chat.message' })).toBe('ws');
  });

  it('buckets a name with no separator rather than dropping it', () => {
    expect(namespaceOf({ name: 'heartbeat' })).toBe('unnamespaced');
  });
});

describe('lookupEvents', () => {
  const rows = computeCoverage(realEvents, realBundles).rows;

  it('is empty for an empty query — the group view is the default, not everything', () => {
    expect(lookupEvents(rows, '   ')).toEqual([]);
  });

  it('matches case-insensitively on a substring', () => {
    const hits = lookupEvents(rows, 'CHAT');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((r) => r.name.toLowerCase().includes('chat'))).toBe(true);
  });

  it('caps the result set so a one-letter query cannot render the catalog', () => {
    expect(lookupEvents(rows, ':', 50).length).toBeLessThanOrEqual(50);
  });
});

describe('the real catalog — the gap the audit found', () => {
  const cov = computeCoverage(realEvents, realBundles);

  it('is computed over the whole registry, not a handful', () => {
    expect(cov.total).toBe(REAL_EVENT_COUNT);
    expect(cov.total).toBeGreaterThan(200);
    expect(cov.bundleCount).toBe(REAL_BUNDLE_COUNT);
    expect(cov.bundleCount).toBeGreaterThan(10);
  });

  it('finds the events that belong to no bundle', () => {
    // The audit that prompted this view counted 83. The exact number tracks
    // src/declarations, so the assertion is on the shape of the finding: a
    // real, substantial gap spread over several namespaces.
    expect(cov.uncovered).toBeGreaterThan(50);
    expect(cov.uncovered).toBeLessThan(cov.total);
    expect(cov.namespaces.filter((n) => n.uncovered > 0).length).toBeGreaterThan(1);
  });

  it('agrees with the bundle membership the fixture derives independently', () => {
    const declared = new Set(realEvents.map((e) => e.name));
    const coveredNames = realBundleMemberNames.filter((n) => declared.has(n));
    expect(cov.covered).toBe(coveredNames.length);
  });

  it('carries the deprecated bundle through to the events it covers', () => {
    const deprecated = realBundles.filter((b) => b.deprecated);
    expect(deprecated.length).toBeGreaterThan(0);
    const member = deprecated[0]!.events[0]!.name;
    const row = cov.rows.find((r) => r.name === member);
    expect(row?.bundles.some((b) => b.deprecated)).toBe(true);
  });
});
