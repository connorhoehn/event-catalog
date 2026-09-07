// tests/load-server-state.test.ts
//
// What the *server* accumulates after a week under load.
//
// `tests/load-sustained-client.test.ts` is the equivalent proof for
// `src/client/`. This file is its server-side counterpart: the admin
// server is a long-lived process holding a registry, a metrics
// collector, a poison detector and an alert manager, and every one of
// those is keyed by a string that arrives from *outside* the process —
// an event name off `POST /api/events/bulk` (1000 per request, no
// ceiling on requests), a `serviceName` off a subscriber registration,
// or a `metadata.producer` field read straight out of a Redis envelope
// that any publisher on the box can forge.
//
// Structures that ARE bounded get a test that pushes many multiples of
// the cap through them and asserts the ceiling holds. Structures that
// are NOT bounded get a test that pins the leak exactly, marked
// `DEFECT:` — when one is fixed the assertion below it is what has to
// change, which is the point.
//
// Fake timers, no sockets, no sleeps.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { MAX_SUBSCRIBERS_PER_EVENT } from '../src/registry/limits.js';
import { MetricsCollector, DEFAULT_MAX_TRACKED_EVENTS } from '../src/server/metrics.js';
import { PromMetrics, DEFAULT_MAX_EVENT_LABELS } from '../src/server/prom-metrics.js';
import {
  PoisonEventDetector,
  DEFAULT_MAX_TRACKED_FAILURE_EVENTS,
} from '../src/server/poison-detector.js';
import { AlertManager, DEFAULT_MAX_TRACKED_KEYS } from '../src/server/alerting.js';
import { ProducerAttributionStore } from '../src/server/producer-attribution.js';
import { makeRouteResponse } from '../src/server/http-router.js';
import { DEFAULT_COMPRESSION } from '../src/server/compression.js';
import type * as http from 'node:http';

/**
 * Distinct keys pushed through each structure. Several multiples of
 * every server-side cap (512 / 5000) and still under a second in total.
 */
const NOVEL_KEYS = 12_000;

afterEach(() => {
  vi.useRealTimers();
});

// ─── Caps that hold ──────────────────────────────────────────────────────

describe('server bookkeeping stays bounded under novel input', () => {
  it('MetricsCollector refuses handles past its cap and counts the drops', () => {
    const metrics = new MetricsCollector(60);

    for (let i = 0; i < NOVEL_KEYS; i++) metrics.recordPublish(`load.novel.${i}`);

    expect(metrics.knownEventCount()).toBe(DEFAULT_MAX_TRACKED_EVENTS);
    expect(metrics.size()).toBe(DEFAULT_MAX_TRACKED_EVENTS);
    expect(metrics.droppedEventCount).toBe(NOVEL_KEYS - DEFAULT_MAX_TRACKED_EVENTS);
    // The 60-slot rate-history ring is allocated per tracked event, so it
    // has to inherit the same ceiling.
    metrics.tickRateHistory();
    expect(Object.keys(metrics.getHistory()).length).toBe(DEFAULT_MAX_TRACKED_EVENTS);
  });

  it('MetricsCollector counts the cap against names ever seen, not live ones', () => {
    // The churn that defeats a naive `this.events.size` check: reset a
    // name, then present a fresh one. `MetricsRegistry` has no delete, so
    // the handles the reset name minted are still held.
    const metrics = new MetricsCollector(60, 100);
    for (let i = 0; i < 100; i++) metrics.recordPublish(`a.${i}`);
    for (let i = 0; i < 100; i++) metrics.reset(`a.${i}`);

    expect(metrics.size()).toBe(0);
    for (let i = 0; i < 100; i++) metrics.recordPublish(`b.${i}`);

    expect(metrics.knownEventCount()).toBe(100);
    expect(metrics.size()).toBe(0); // every `b.*` was refused
    expect(metrics.droppedEventCount).toBe(100);
  });

  it('PromMetrics collapses event labels past the cardinality cap', () => {
    const prom = new PromMetrics();

    for (let i = 0; i < NOVEL_KEYS; i++) {
      prom.recordPublish(`load.novel.${i}`, 'signal', 'strict');
      prom.recordFailure(`load.novel.${i}`, 'schema');
    }

    expect(prom.eventLabelCount).toBe(DEFAULT_MAX_EVENT_LABELS);

    // The observable proxy an operator actually pays for: series in the
    // scrape body. 12 000 novel names must not mint 12 000 series.
    const body = prom.renderProm();
    const publishSeries = body.split('\n').filter(l => l.startsWith('event_catalog_publish_total{'));
    expect(publishSeries.length).toBeLessThanOrEqual(DEFAULT_MAX_EVENT_LABELS + 1);
    expect(body).toContain('event_catalog_metric_label_overflow_total{label="event"}');
  });

  it('PoisonEventDetector sweeps expired windows before admitting a new key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const detector = new PoisonEventDetector({ windowMs: 60_000, threshold: 50 });

    // A burst of one-off failures across many names: each entry is only
    // ever pruned by a later failure for the SAME name, so the sweep on
    // admission is the only thing keeping this proportional to what is
    // actually failing.
    for (let i = 0; i < NOVEL_KEYS; i++) {
      detector.recordFailure(`load.oneoff.${i}`);
      if (i % 1000 === 0) vi.advanceTimersByTime(30_000);
    }

    expect(detector.trackedEventCount).toBeLessThanOrEqual(DEFAULT_MAX_TRACKED_FAILURE_EVENTS);
    expect(detector.listPoisoned()).toHaveLength(0);
  });

  it('AlertManager evicts per-event cooldown bookkeeping oldest-first', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const alerts = new AlertManager({ webhookUrl: 'http://alerts.invalid/hook' });
      // errorCount 0 means the delta never crosses the threshold, so this
      // exercises the bookkeeping path alone — no webhook traffic.
      for (let i = 0; i < NOVEL_KEYS; i++) {
        await alerts.onErrorThreshold(`load.novel.${i}`, 0);
      }
      const tracked = (alerts as unknown as { lastErrorCount: Map<string, number> }).lastErrorCount;
      expect(tracked.size).toBe(DEFAULT_MAX_TRACKED_KEYS);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─── Caps that do not exist ──────────────────────────────────────────────

describe('server state that grows without a ceiling', () => {
  it('ProducerAttributionStore is bounded in both dimensions', () => {
    // Regression: `observed` was a plain Map<string, Set<string>> with no cap,
    // no eviction and no TTL, fed from `envelope.metadata.producer` — a string
    // chosen per message by whoever published to the Redis channel — keyed by
    // event name. Both dimensions are caller-controlled, so one varying field
    // per publish grew it forever, and `GET /api/events/attribution`
    // re-serialized the whole thing on every call.
    const store = new ProducerAttributionStore({ maxEvents: 500, maxProducersPerEvent: 50 });

    for (let i = 0; i < NOVEL_KEYS; i++) store.record(`load.novel.${i}`, 'svc-a');
    // …and one event whose *producer* field is the hostile dimension.
    for (let i = 0; i < NOVEL_KEYS; i++) store.record('one.event', `producer-${i}`);

    expect(Object.keys(store.getAll()).length).toBeLessThanOrEqual(500);
    expect(store.getObserved('one.event').length).toBeLessThanOrEqual(50);

    // Capped is not the same as quiet: the loss stays countable.
    const stats = store.getOverflowStats();
    expect(stats.droppedEvents).toBeGreaterThan(0);
    expect(stats.droppedProducers).toBeGreaterThan(0);

    // Eviction is oldest-first, so the most recent observations survive —
    // which is the half an operator is actually looking at.
    expect(store.getObserved('one.event')).toContain(`producer-${NOVEL_KEYS - 1}`);

    // And a deleted event's attribution can be reclaimed.
    store.forget('one.event');
    expect(store.getObserved('one.event')).toEqual([]);
  });

  it('an event has a ceiling on distinct subscribers', () => {
    // Regression: `addSubscriber` was push-and-dedupe with no cap, and every
    // add re-serializes the whole entry to Redis, so N adds cost O(N^2) bytes.
    // A subscriber is a service IDENTITY, not a process — every replica of a
    // consumer de-dupes onto one name — so the cap is refusal, not eviction:
    // dropping a live consumer would corrupt the answer to "who consumes X?",
    // which is the question the list exists to answer.
    const registry = new Registry();
    registry.declare({ name: 'load.subs', transport: 'signal', producer: 'p', schema: {} } as never);

    for (let i = 0; i < 5_000; i++) registry.addSubscriber('load.subs', `svc-${i}`);

    expect(registry.get('load.subs')!.subscribers).toHaveLength(MAX_SUBSCRIBERS_PER_EVENT);
    expect(registry.listSubscriberHeartbeats()).toHaveLength(MAX_SUBSCRIBERS_PER_EVENT);
    // Refusals are counted rather than silent — replication has no response
    // to write a 429 into, so the counter is the only signal there.
    expect(registry.getSubscriberRefusalStats().atCapacity).toBeGreaterThan(0);
    // The EARLIEST subscribers survive: the newcomer is refused, so an
    // established consumer is never displaced by a flood of new names.
    expect(registry.get('load.subs')!.subscribers).toContain('svc-0');
  });

  it('removing an event reclaims its subscriber heartbeats', () => {
    // Regression: `remove()` dropped the entry and the Redis hash field but
    // never touched `subscriberHeartbeats`, keyed `${eventName}\x00${service}`.
    // `pruneStaleSubscribers` only walks events that still exist, so nothing
    // could ever reach the orphans again — declare/subscribe/delete in a loop
    // leaked one unreclaimable entry per edge, forever.
    const registry = new Registry();
    const heartbeats = (registry as unknown as {
      subscriberHeartbeats: Map<string, number>;
    }).subscriberHeartbeats;

    for (let i = 0; i < 2_000; i++) {
      registry.declare({ name: `churn.${i}`, transport: 'signal', producer: 'p', schema: {} } as never);
      registry.addSubscriber(`churn.${i}`, 'svc-a');
      registry.remove(`churn.${i}`);
    }

    expect(registry.size()).toBe(0);
    expect(registry.listSubscriberHeartbeats()).toHaveLength(0);
    // Reclaimed at removal time, not left for a sweeper that cannot see them.
    expect(heartbeats.size).toBe(0);
    expect(registry.pruneStaleSubscribers(0)).toHaveLength(0);
    expect(heartbeats.size).toBe(0);
  });
});

// ─── Compression ─────────────────────────────────────────────────────────

describe('per-request compression state', () => {
  /**
   * A response whose socket is either live or already reset by the peer.
   *
   * `destroyed` is the only difference between the two, and it is now
   * load-bearing rather than incidental colour: see the two tests below.
   */
  function makeResponse(destroyed: boolean): {
    res: ReturnType<typeof makeRouteResponse>;
    headers: Map<string, string>;
    writes: number;
  } {
    const headers = new Map<string, string>();
    const state = { writes: 0 };
    const nodeRes = {
      headersSent: false,
      destroyed,
      writableEnded: false,
      setHeader(name: string, value: string) { headers.set(name, value); },
      getHeader(name: string) { return headers.get(name); },
      writeHead() { (nodeRes as { headersSent: boolean }).headersSent = true; },
      write() { state.writes += 1; return true; },
      end() { state.writes += 1; },
      flushHeaders() {},
    } as unknown as http.ServerResponse;
    const res = makeRouteResponse(nodeRes, {
      config: DEFAULT_COMPRESSION,
      encoding: 'br',
    });
    return { res, headers, get writes() { return state.writes; } };
  }

  it('holds no retained state across responses (whole-buffer, no zlib streams)', () => {
    // The compressor is `gzipSync`/`brotliCompressSync` over a complete
    // body — there is no per-request stream object, no pipe and nothing
    // registered on the response, so an aborted request cannot strand a
    // zlib handle. 2000 compressed responses must leave zero timers and
    // zero listeners behind.
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    for (let i = 0; i < 2_000; i++) {
      // A LIVE socket — the point here is that 2000 real compressions
      // leave nothing behind, so the responses have to actually compress.
      const { res, headers } = makeResponse(false);
      res.setHeader('Content-Type', 'application/json');
      res.json({ blob: 'x'.repeat(4_096), i });
      expect(headers.get('Content-Encoding')).toBe('br');
    }
    expect(vi.getTimerCount()).toBe(before);
  });

  it('does no compression work for a peer that has already gone away', () => {
    // Was `DEFECT:` — `finish()` in src/server/http-router.ts gated only on
    // `headersSent`, and a socket reset destroys the socket without any
    // headers having been sent, so `headersSent` was still false and the
    // work went ahead. A client that opened `GET /api/events` with
    // `Accept-Encoding: br` and reset therefore still cost a full brotli
    // pass over ~326 KiB (~2.1 ms of event-loop time, per the table at the
    // top of compression.ts) for bytes nobody would read — the cheapest
    // possible request to issue, and one of the most expensive to serve.
    //
    // `finish()` now returns early on `nodeRes.destroyed`, and `json()`
    // checks it before `JSON.stringify` so the serialization is skipped
    // too.
    const aborted = makeResponse(true);
    aborted.res.setHeader('Content-Type', 'application/json');
    aborted.res.json({ blob: 'x'.repeat(64 * 1024) });

    // Nothing was compressed, nothing was framed, nothing was written.
    expect(aborted.headers.get('Content-Encoding')).toBeUndefined();
    expect(aborted.headers.get('Content-Length')).toBeUndefined();
    expect(aborted.writes).toBe(0);
  });

  it('still compresses normally for a peer that is still connected', () => {
    // The guard must be about the peer being gone, not a blanket
    // short-circuit: the live path has to be untouched.
    const { res, headers } = makeResponse(false);
    res.setHeader('Content-Type', 'application/json');
    res.json({ blob: 'x'.repeat(64 * 1024) });

    expect(headers.get('Content-Encoding')).toBe('br');
    expect(Number(headers.get('Content-Length'))).toBeGreaterThan(0);
  });
});
