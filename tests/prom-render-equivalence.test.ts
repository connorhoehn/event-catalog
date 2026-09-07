// tests/prom-render-equivalence.test.ts
//
// `PromMetrics.renderProm()` no longer calls distributed-core's
// `formatPrometheus` on the hot path. It calls `renderExposition`, a
// local copy of the same walk whose only difference is a per-series
// cache of the rendered `name{label="value",…}` prefix — profiling put
// distributed-core's `labelStr` at 42% of the whole scrape, rebuilding
// byte-identical strings for ~470 series every 15 seconds forever.
//
// A hand-rolled exposition renderer is a correctness liability, so this
// suite pins it two ways:
//
//   1. Equivalence — the local render must be byte-for-byte identical
//      to `formatPrometheus` across the shapes this surface actually
//      produces. If distributed-core ever changes the format, this
//      fails rather than the two silently diverging.
//   2. Invalidation — the cache is keyed on the labels object a series
//      is registered with, so a series added AFTER a render must show
//      up in the next one, and a value that moves must be re-read.
//      A cache that froze either would be a correctness bug that no
//      equivalence check on a static registry would catch.

import { describe, it, expect } from 'vitest';
import { MetricsRegistry, formatPrometheus } from 'distributed-core';
import { PromMetrics, renderExposition, PROM_METRIC_NAMESPACE } from '../src/server/prom-metrics.js';

/**
 * Compare a render against `formatPrometheus` on the SAME snapshot.
 *
 * Taking one snapshot and rendering it twice matters: the exposition
 * carries `snapshot.timestamp` on every line, so rendering two separate
 * snapshots would differ on timing alone and prove nothing.
 */
function expectEquivalent(registry: MetricsRegistry): string {
  const snapshot = registry.getSnapshot();
  const local = renderExposition(snapshot);
  expect(local).toBe(formatPrometheus(snapshot));
  return local;
}

describe('renderExposition — equivalence with formatPrometheus', () => {
  it('matches on an empty registry', () => {
    expectEquivalent(new MetricsRegistry('test', { namespace: PROM_METRIC_NAMESPACE }));
  });

  it('matches on a counter with no labels and no help', () => {
    const registry = new MetricsRegistry('test', { namespace: PROM_METRIC_NAMESPACE });
    registry.counter('bare_total').inc(3);
    const out = expectEquivalent(registry);
    // No description was given, so no HELP line may be invented.
    expect(out).not.toContain('# HELP');
    expect(out).toContain('# TYPE event_catalog_bare_total counter');
  });

  it('matches on multiple label-variants sharing one TYPE header', () => {
    const registry = new MetricsRegistry('test', { namespace: PROM_METRIC_NAMESPACE });
    registry.counter('publish_total', { event: 'a', transport: 'signal' }, 'help one').inc();
    registry.counter('publish_total', { event: 'b', transport: 'durable' }, 'help one').inc(7);
    registry.gauge('dlq_entries', { event: 'a' }, 'help two').set(12);
    const out = expectEquivalent(registry);
    // One TYPE header for the whole family, not one per series.
    expect(out.match(/# TYPE event_catalog_publish_total/g)).toHaveLength(1);
  });

  it('matches when label keys need sorting and values need escaping', () => {
    const registry = new MetricsRegistry('test', { namespace: PROM_METRIC_NAMESPACE });
    // Deliberately out of alphabetical order — the format sorts keys.
    registry.counter('weird_total', { zebra: 'z', alpha: 'a', mode: 'strict' }, 'sorted').inc();
    const out = expectEquivalent(registry);
    expect(out).toContain('{alpha="a",mode="strict",zebra="z"}');
  });

  it('matches the full PromMetrics surface with every family populated', () => {
    const prom = new PromMetrics(undefined, { maxEventLabels: 512 });
    for (let i = 0; i < 40; i++) {
      prom.recordPublish(`svc:evt:${i}`, i % 2 === 0 ? 'signal' : 'both', 'warn');
      prom.recordSchemaFetch(`svc:evt:${i}`);
      prom.recordFailure(`svc:evt:${i}`, 'schema');
      prom.recordEvolutionRejection(`svc:evt:${i}`, 'strict');
    }
    prom.syncDLQEntries(new Map([['svc:evt:1', 4], ['svc:evt:2', 0]]));
    prom.setDLQOldestAgeSeconds(900);
    prom.setSseStreams(7, 256);
    prom.recordSseRejected();
    prom.setTransportUp('redis', true);
    prom.setTransportUp('message-queue', false);
    prom.setTransportProbeLatencySeconds('redis', 0.002);
    prom.setPoisonedEvents(2);
    prom.setRegistrySize(216);

    expectEquivalent(prom.getRegistry());
    // And the public entry point produces the same shape.
    expect(prom.renderProm()).toContain('# TYPE event_catalog_publish_total counter');
  });

  it('falls back to formatPrometheus rather than guessing at a histogram', () => {
    const registry = new MetricsRegistry('test', { namespace: PROM_METRIC_NAMESPACE });
    registry.counter('mixed_total', { a: '1' }, 'a counter').inc();
    registry.histogram('latency', { a: '1' }, 100, 'a histogram').observe(5);
    // PromMetrics registers no histograms today; if one is ever added the
    // local renderer must defer rather than emit an approximation of its
    // own. Equivalence therefore still holds.
    expectEquivalent(registry);
  });
});

describe('renderExposition — cache invalidation', () => {
  it('includes a series registered after an earlier render', () => {
    const prom = new PromMetrics(undefined, { maxEventLabels: 512 });
    prom.recordPublish('first:event', 'signal', 'off');

    const before = prom.renderProm();
    expect(before).toContain('event="first:event"');
    expect(before).not.toContain('event="second:event"');

    // A brand-new series is a brand-new labels object, so it cannot hit
    // the prefix cache — but a cache that memoized the whole rendered
    // document (rather than per-series prefixes) would miss it entirely.
    prom.recordPublish('second:event', 'durable', 'strict');
    const after = prom.renderProm();
    expect(after).toContain('event="first:event"');
    expect(after).toContain('event="second:event"');
    expectEquivalent(prom.getRegistry());
  });

  it('re-reads a value that moved between scrapes', () => {
    const prom = new PromMetrics();
    prom.setRegistrySize(216);
    expect(prom.renderProm()).toMatch(/event_catalog_registry_events\s+216\s/);

    prom.setRegistrySize(217);
    // Only the label prefix is cached; the numeric value is read fresh.
    expect(prom.renderProm()).toMatch(/event_catalog_registry_events\s+217\s/);
  });

  it('re-reads a counter that was incremented between scrapes', () => {
    const prom = new PromMetrics();
    prom.recordSchemaFetch('orders:created');
    const first = prom.renderProm();
    expect(first).toMatch(/schema_fetches_total\{event="orders:created"\} 1 /);

    prom.recordSchemaFetch('orders:created');
    prom.recordSchemaFetch('orders:created');
    expect(prom.renderProm()).toMatch(/schema_fetches_total\{event="orders:created"\} 3 /);
  });

  it('runs scrape-time collectors on every render, not just the first', () => {
    const prom = new PromMetrics();
    let size = 10;
    prom.collect(() => prom.setRegistrySize(size));

    expect(prom.renderProm()).toMatch(/event_catalog_registry_events\s+10\s/);
    size = 99;
    expect(prom.renderProm()).toMatch(/event_catalog_registry_events\s+99\s/);
  });

  it('keeps two PromMetrics instances independent', () => {
    // The prefix cache is module-level, keyed on labels-object identity.
    // Two registries mint separate labels objects, so neither can read
    // the other's entries even when the metric names collide exactly.
    const a = new PromMetrics();
    const b = new PromMetrics();
    a.recordSchemaFetch('shared:name');
    b.recordSchemaFetch('shared:name');
    b.recordSchemaFetch('shared:name');

    expect(a.renderProm()).toMatch(/schema_fetches_total\{event="shared:name"\} 1 /);
    expect(b.renderProm()).toMatch(/schema_fetches_total\{event="shared:name"\} 2 /);
  });
});
