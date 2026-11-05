// Production-scale behaviour and render cost — the static views.
//
// The rest of the admin suite renders three-to-six events. Production is 216
// declarations, 231 topology nodes and 380 edges, and every UI bug found so
// far (a <select> that erased its own options, a graph laid out at 0px, a
// list that re-appended its history) was invisible at the small size and
// obvious at the real one.
//
// So this file mounts every heavy view against the fixture derived from
// `src/declarations` and asserts two different things:
//
//   - correctness at scale: the whole catalog reaches the DOM, filters still
//     narrow it, every namespace stays in the dropdown;
//   - cost at scale: each view's mount time is printed and bounded. The
//     budgets are deliberately loose — they exist to catch an accidental
//     O(n²), not to benchmark the CI box.
//
// ReactFlow is NOT stubbed here: two of the three topology bugs shipped so
// far were invisible to markup assertions on a stub. The firehose half of
// the story, which does stub it in order to count commits, lives in
// `scale-flow.test.tsx` — `vi.mock` is per-module, so it cannot share a file
// with these.

import { afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { mockFetch, renderWithRouter } from './test/helpers';
import {
  REAL_BUNDLE_COUNT,
  REAL_EVENT_COUNT,
  buildRealTopology,
  realBundles,
  realBundlesResponse,
  realEvents,
  realEventsResponse,
  realMetricsHistory,
  realNamespaceSummary,
  realNamespaces,
  realTopology,
} from './test/fixtures/registry';
import { GRAPH_MIN_ZOOM, graphExtent, layoutGraph } from './components/topology/layout';
import { TopologyView } from './components/TopologyView';
import { chooseOption, readOptions } from './test/helpers';
import { EventList } from './components/EventList';
import { NamespacesView } from './components/NamespacesView';
import { BundlesView } from './components/BundlesView';
import { CoverageView } from './components/CoverageView';
import { computeCoverage } from './components/bundles/coverage';

const TIMINGS: Array<[string, string]> = [];

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  TIMINGS.push([label, `${(performance.now() - t0).toFixed(0)} ms`]);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
  const width = Math.max(...TIMINGS.map(([l]) => l.length));
  const lines = TIMINGS.map(([l, v]) => `  ${l.padEnd(width)}  ${v.padStart(9)}`);
  console.log(`\nscale timings — static views (${REAL_EVENT_COUNT} events)\n${lines.join('\n')}\n`);
});

describe('the fixture really is the production registry', () => {
  it('carries every declaration, not a hand-written handful', () => {
    expect(REAL_EVENT_COUNT).toBeGreaterThanOrEqual(200);
    expect(realTopology.nodes.length).toBeGreaterThan(REAL_EVENT_COUNT);
    expect(realTopology.edges.length).toBeGreaterThan(REAL_EVENT_COUNT);
  });

  it('has the lopsided namespace distribution the real catalog has', () => {
    const counts = realNamespaceSummary.items.map((i) => i.eventCount);
    // Biggest namespace holds a third of the catalog; smallest holds one
    // event. A view that only ever saw an even split has not been tested.
    expect(counts[0]!).toBeGreaterThan(REAL_EVENT_COUNT / 4);
    expect(counts[counts.length - 1]!).toBe(1);
    expect(realNamespaces.length).toBeGreaterThanOrEqual(8);
  });
});

// ── Topology ───────────────────────────────────────────────────────────────

describe('TopologyView at 216 events', () => {
  it('lays the whole graph out in well under a second, with finite coordinates', () => {
    const nodes = realTopology.nodes.map((n) => ({ id: n.id, position: { x: 0, y: 0 }, data: {} }));
    const edges = realTopology.edges.map((e, i) => ({
      id: `${e.from}->${e.to}#${i}`,
      source: e.from,
      target: e.to,
    }));
    const t0 = performance.now();
    const laid = layoutGraph(nodes, edges);
    const ms = performance.now() - t0;
    TIMINGS.push([`layoutGraph (${nodes.length}n/${edges.length}e)`, `${ms.toFixed(0)} ms`]);

    expect(laid).toHaveLength(nodes.length);
    // A NaN here is the 0px-canvas bug's cousin: the whole graph would draw
    // on top of itself and nothing would say why.
    for (const n of laid) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
    expect(ms).toBeLessThan(4_000);
  });

  it('draws namespace clusters that hug their own events instead of overlapping', () => {
    const namespaces: Record<string, string> = {};
    for (const n of realTopology.nodes) {
      if (n.type === 'event') namespaces[n.id] = n.metadata.namespace as string;
    }
    const nodes = realTopology.nodes.map((n) => ({ id: n.id, position: { x: 0, y: 0 }, data: {} }));
    const edges = realTopology.edges.map((e, i) => ({
      id: `${e.from}->${e.to}#${i}`,
      source: e.from,
      target: e.to,
    }));
    const laid = layoutGraph(nodes, edges, { groups: namespaces });
    const byId = new Map(laid.map((n) => [n.id, n.position]));

    // The same bounding boxes NamespaceClusters draws.
    const boxes = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
    for (const [id, ns] of Object.entries(namespaces)) {
      const p = byId.get(id)!;
      const cur = boxes.get(ns);
      const b = { x1: p.x, y1: p.y, x2: p.x + 200, y2: p.y + 60 };
      if (!cur) boxes.set(ns, b);
      else {
        cur.x1 = Math.min(cur.x1, b.x1);
        cur.y1 = Math.min(cur.y1, b.y1);
        cur.x2 = Math.max(cur.x2, b.x2);
        cur.y2 = Math.max(cur.y2, b.y2);
      }
    }

    const entries = [...boxes.entries()];
    const overlapping: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [an, a] = entries[i]!;
        const [bn, b] = entries[j]!;
        if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0) {
          overlapping.push(`${an}×${bn}`);
        }
      }
    }
    TIMINGS.push(['namespace cluster overlaps', `${overlapping.length} pairs`]);
    // Ungrouped, 19 of 36 pairs overlapped and the overlay was noise.
    expect(overlapping).toEqual([]);
  });

  it('lays out shallow enough that fitView is not clamped by minZoom', () => {
    const namespaces: Record<string, string> = {};
    for (const n of realTopology.nodes) {
      if (n.type === 'event') namespaces[n.id] = n.metadata.namespace as string;
    }
    const nodes = realTopology.nodes.map((n) => ({ id: n.id, position: { x: 0, y: 0 }, data: {} }));
    const edges = realTopology.edges.map((e, i) => ({
      id: `${e.from}->${e.to}#${i}`,
      source: e.from,
      target: e.to,
    }));
    const extent = graphExtent(layoutGraph(nodes, edges, { groups: namespaces }));

    // A laptop-sized admin viewport.
    const needed = Math.min(1280 / extent.width, 800 / extent.height);
    TIMINGS.push([
      'fitView zoom for the real graph',
      `${needed.toFixed(3)} (min ${GRAPH_MIN_ZOOM})`,
    ]);
    // `minZoom` was 0.2 and the real graph needs ~0.035, so `fitView` was
    // clamped and the operator landed on a sixth of the graph with no way to
    // pull back. At six events nothing was clamped and nobody noticed.
    expect(needed).toBeGreaterThan(GRAPH_MIN_ZOOM);
  });

  it('draws the whole catalog and keeps every namespace in the filter', async () => {
    mockFetch({ '/api/topology': { body: realTopology } });
    await timed('TopologyView mount', async () => {
      renderWithRouter(<TopologyView />);
      await screen.findByText(`${REAL_EVENT_COUNT} events`, {}, { timeout: 30_000 });
    });

    const select = screen.getByLabelText('namespace');
    const options = await readOptions(userEvent.setup(), select);
    expect(options.map((o) => o.value)).toEqual(['', ...realNamespaces]);
  }, 60_000);

  it('keeps the full namespace list after a filtered fetch narrows the graph', async () => {
    const scoped = buildRealTopology('sfu');
    let call = 0;
    mockFetch({
      '/api/topology': () => (call++ === 0 ? { body: realTopology } : { body: scoped }),
    });
    renderWithRouter(<TopologyView />);
    await screen.findByText(`${REAL_EVENT_COUNT} events`, {}, { timeout: 30_000 });

    const user = userEvent.setup();
    const select = screen.getByLabelText('namespace');
    await timed('TopologyView namespace filter', async () => {
      await chooseOption(user, select, 'sfu');
      await screen.findByText(
        `${scoped.nodes.filter((n) => n.type === 'event').length} events`,
        {},
        { timeout: 30_000 },
      );
    });

    // The bug this pins: options derived from the *current* response vanish
    // the moment a namespace is picked.
    expect((await readOptions(user, select)).map((o) => o.value)).toEqual(['', ...realNamespaces]);
  }, 60_000);
});

// ── EventList ──────────────────────────────────────────────────────────────

describe('EventList at 216 rows', () => {
  function mountList() {
    mockFetch({
      '/api/events': { body: realEventsResponse },
      '/api/metrics/history': { body: realMetricsHistory },
    });
    renderWithRouter(<EventList />);
  }

  it('renders every row with its sparkline', async () => {
    await timed('EventList mount (216 rows)', async () => {
      mountList();
      await screen.findByText(`${REAL_EVENT_COUNT} events`, {}, { timeout: 30_000 });
    });

    expect(screen.getAllByRole('row').length).toBe(REAL_EVENT_COUNT + 1); // + header
    // 60 samples each, so every row draws a sparkline rather than the dash.
    expect(screen.getAllByRole('img', { name: /publish-rate trend/ }).length).toBe(REAL_EVENT_COUNT);
  }, 60_000);

  it('selects all 216 rows, then deselects one, without a quadratic stall', async () => {
    mountList();
    await screen.findByText(`${REAL_EVENT_COUNT} events`, {}, { timeout: 30_000 });

    await timed('EventList select-all (216)', async () => {
      await userEvent.click(screen.getByLabelText('Select all events'));
      await screen.findByText(`${REAL_EVENT_COUNT} selected`, {}, { timeout: 30_000 });
    });

    const first = screen.getByLabelText(`Select ${realEventsResponse.events[0]!.name}`);
    await timed('EventList toggle one of 216', async () => {
      await userEvent.click(first);
      await screen.findByText(`${REAL_EVENT_COUNT - 1} selected`, {}, { timeout: 30_000 });
    });
  }, 90_000);
});

// ── Namespaces ─────────────────────────────────────────────────────────────

describe('NamespacesView with the real, uneven distribution', () => {
  it('renders every namespace card and expands the largest one', async () => {
    mockFetch({ '/api/namespaces/summary': { body: realNamespaceSummary } });
    await timed('NamespacesView mount', async () => {
      renderWithRouter(<NamespacesView />);
      await screen.findByText(`${realNamespaceSummary.count} total`, {}, { timeout: 30_000 });
    });

    const biggest = realNamespaceSummary.items[0]!;
    await timed(
      `NamespacesView expand "${biggest.namespace}" (${biggest.eventCount} events)`,
      async () => {
        await userEvent.click(
          screen.getByRole('button', { name: new RegExp(`^${biggest.namespace}\\b`) }),
        );
        await screen.findByText(biggest.events[0]!.name, {}, { timeout: 30_000 });
      },
    );

    // Every event in the namespace is listed — not a truncated page.
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(biggest.eventCount);
  }, 90_000);
});

// ── Bundles + coverage ─────────────────────────────────────────────────────

describe('Bundles and coverage against the whole catalog', () => {
  const coverage = computeCoverage(realEvents, realBundles);

  it('lists every registered bundle', async () => {
    mockFetch({ '/api/feature-bundles': { body: realBundlesResponse } });
    await timed(`BundlesView mount (${REAL_BUNDLE_COUNT} bundles)`, async () => {
      renderWithRouter(<BundlesView />);
      await screen.findByText(`${REAL_BUNDLE_COUNT} total`, {}, { timeout: 30_000 });
    });
    // DataTable has no row-header cells; count body rows (all but the header).
    expect(screen.getAllByRole('row').length - 1).toBe(REAL_BUNDLE_COUNT);
  }, 60_000);

  it('diffs 226 events against 18 bundles and groups the gap by namespace', async () => {
    mockFetch({
      '/api/events': { body: realEventsResponse },
      '/api/feature-bundles': { body: realBundlesResponse },
    });
    await timed(
      `CoverageView mount (${REAL_EVENT_COUNT} events × ${REAL_BUNDLE_COUNT} bundles)`,
      async () => {
        renderWithRouter(<CoverageView />);
        await screen.findByText(`${coverage.uncovered} uncovered`, {}, { timeout: 30_000 });
      },
    );

    // The finding the view exists for: a substantial slice of the catalog is
    // in no bundle, and it is legible as a handful of namespace groups rather
    // than eighty-odd loose names.
    expect(coverage.uncovered).toBeGreaterThan(50);
    const gapGroups = coverage.namespaces.filter((n) => n.uncovered > 0);
    expect(screen.getAllByRole('button', { name: /uncovered/ }).length).toBe(gapGroups.length);
    expect(gapGroups.length).toBeLessThan(coverage.uncovered / 3);

    // Only the worst namespace is expanded, so the initial paint is bounded
    // by that group and not by every gap in the catalog.
    const worst = gapGroups[0]!;
    expect(
      screen.getAllByRole('link', { name: new RegExp(`^${worst.namespace}[.:]`) }).length,
    ).toBeGreaterThan(0);
  }, 90_000);

  it('looks an event up across the whole catalog without a stall', async () => {
    mockFetch({
      '/api/events': { body: realEventsResponse },
      '/api/feature-bundles': { body: realBundlesResponse },
    });
    renderWithRouter(<CoverageView />);
    await screen.findByText(`${coverage.uncovered} uncovered`, {}, { timeout: 30_000 });

    const target = coverage.rows.find((r) => r.covered)!;
    await timed(`Coverage lookup over ${REAL_EVENT_COUNT} events`, async () => {
      await userEvent.type(screen.getByLabelText('Is this event covered?'), target.name);
      await screen.findByRole('link', { name: target.name }, { timeout: 30_000 });
    });

    const row = screen.getByRole('link', { name: target.name }).closest('tr')!;
    expect(row.textContent).toContain(target.bundles[0]!.name);
  }, 90_000);
});
