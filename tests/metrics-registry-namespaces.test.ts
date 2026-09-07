// tests/metrics-registry-namespaces.test.ts
//
// The service keeps two metric registries: `MetricsCollector` behind the
// JSON admin API and `PromMetrics` behind the `/metrics` scrape. Both
// register a metric called `publish_total`, and they label it
// differently — `{event}` versus `{event, transport, mode}`. They are
// separate registry instances so nothing collides at runtime, but a
// single Prometheus metric family whose series disagree on label names
// is invalid exposition: a scraper drops the whole family, not just the
// odd series. These tests pin the namespaces apart so merging the two
// registries, or ever rendering the JSON one, stays safe.

import { describe, it, expect } from 'vitest';
import { formatPrometheus } from 'distributed-core';
import { MetricsCollector, COLLECTOR_METRIC_NAMESPACE } from '../src/server/metrics.js';
import { PromMetrics, PROM_METRIC_NAMESPACE } from '../src/server/prom-metrics.js';

/** A collector with one handle of every kind it can create. */
function exercisedCollector(): MetricsCollector {
  const collector = new MetricsCollector(60);
  collector.recordPublish('order.placed');
  collector.recordError('order.placed');
  collector.setSubscriberCount('order.placed', 2);
  collector.updateDurableStats('order.placed', {
    queueDepth: 1, messagesInFlight: 1, oldestMessageAge: 1,
  });
  return collector;
}

/** A prom surface with one handle of every kind it can create. */
function exercisedProm(): PromMetrics {
  const prom = new PromMetrics();
  prom.recordPublish('order.placed', 'signal', 'strict');
  prom.recordFailure('order.placed', 'schema');
  prom.recordSchemaFetch('order.placed');
  prom.recordEvolutionRejection('order.placed', 'warn');
  prom.setDLQEntries('order.placed', 1);
  prom.setDLQOldestAgeSeconds(1);
  prom.setSseStreams(1, 10);
  prom.recordSseRejected();
  prom.setTransportUp('redis', true);
  prom.setTransportProbeLatencySeconds('redis', 0.01);
  prom.setPoisonedEvents(0);
  prom.setRegistrySize(1);
  return prom;
}

describe('metric namespaces', () => {
  it('the two registries use different namespaces', () => {
    expect(COLLECTOR_METRIC_NAMESPACE).not.toBe(PROM_METRIC_NAMESPACE);
  });

  it('no metric family name is shared between the JSON collector and /metrics', () => {
    const collector = exercisedCollector().getRegistry().getMetricNames();
    const prom = exercisedProm().getRegistry().getMetricNames();
    expect(collector.length).toBeGreaterThan(0);
    expect(prom.length).toBeGreaterThan(0);
    expect(collector.filter(name => prom.includes(name))).toEqual([]);
  });

  it('the collector does not shadow the scrape surface publish_total', () => {
    const collector = exercisedCollector().getRegistry().getMetricNames();
    const prom = exercisedProm().getRegistry().getMetricNames();
    expect(prom).toContain(`${PROM_METRIC_NAMESPACE}.publish_total`);
    expect(collector).toContain(`${COLLECTOR_METRIC_NAMESPACE}.publish_total`);
    expect(collector).not.toContain(`${PROM_METRIC_NAMESPACE}.publish_total`);
  });

  it('merging both registries yields one label set per metric family', () => {
    // This is the trap the namespace split defends against: render every
    // sample from both surfaces into one exposition and check that each
    // family agrees on its label keys — the invariant a scraper enforces.
    const samples = [
      ...exercisedCollector().getRegistry().getSnapshot().metrics,
      ...exercisedProm().getRegistry().getSnapshot().metrics,
    ];

    const labelKeysByName = new Map<string, string>();
    for (const sample of samples) {
      const keys = Object.keys(sample.labels).sort().join(',');
      const seen = labelKeysByName.get(sample.name);
      if (seen === undefined) labelKeysByName.set(sample.name, keys);
      else expect(`${sample.name}{${keys}}`).toBe(`${sample.name}{${seen}}`);
    }

    // Both publish counters survive as distinct, well-formed families.
    const text = formatPrometheus({ timestamp: Date.now(), nodeId: 'merged', metrics: samples });
    expect(text).toContain('event_catalog_publish_total{');
    expect(text).toContain('event_catalog_stats_publish_total{');
  });
});
