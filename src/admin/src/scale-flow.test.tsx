// The live flow view under a firehose.
//
// Production's SSE tap can fire continuously. The buffer cap (MAX_BUFFER =
// 200) is the documented bound, but a bounded buffer says nothing about
// render cost: if every frame commits, an admin tab left open on /flow
// during an incident pins a core and the operator's own tooling becomes part
// of the outage.
//
// ReactFlow is stubbed here — deliberately, and for a different reason than
// the FlowView unit suite stubs it. The stub counts its own renders, which
// makes "does this view commit once per SSE frame" a number rather than a
// hunch. `vi.mock` is per-module, so this cannot live in `scale.test.tsx`,
// which needs the real graph.
//
// ─── Why the clock is fake ──────────────────────────────────────────────────
//
// The drip measurement used to run on the real clock and assert a single
// commit budget (`commits <= frames + 5`). That budget was an accident of how
// fast the machine happened to be.
//
// FlowView retires expired pulses with ONE self-rescheduling sweeper, floored
// at `Math.max(nextDue - now, 16)` ms. So the sweeper's commits are paced by
// the CLOCK, not by the stream: at 500 frames/sec it coalesces ~8 frames'
// worth of fades into one commit, and at 20 frames/sec it retires each frame
// separately. Both are correct; they produce wildly different totals.
//
// On the real clock, "how many frames fit in 16 ms" is a function of how long
// `act()` takes to render the catalog — so growing the registry from 216 to
// 229 events pushed the per-frame cost over the sweep floor and the single
// budget tipped over. The test failed because the catalog grew, which is
// exactly the thing it was supposed to tolerate.
//
// So: mount on the real clock, then freeze it. Every measurement below counts
// pulse commits and sweep commits SEPARATELY (emit a frame with the clock
// stopped; advance the clock with no frame arriving), and each is bounded by
// the thing that actually governs it:
//
//   pulse commits — exactly one per frame, forever, at any catalog size
//   sweep commits — at most one per 16 ms of stream time, and never more
//                   than one per frame, no matter how many edges are lit
//
// Neither bound mentions wall-clock or `realTopology.edges.length`, which is
// the whole point.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { memo, type ReactNode } from 'react';

import { installMockEventSource, mockFetch, MockEventSource, renderWithRouter } from './test/helpers';
import {
  buildRealTopology,
  REAL_EVENT_COUNT,
  realEvents,
  realTopology,
  tapBurst,
  tapFrameFor,
} from './test/fixtures/registry';
import type { TopologyGraph } from './api';

let graphRenders = 0;
let edgeRenders = 0;

/**
 * Stands in for ReactFlow's `EdgeWrapper`, which is memoised on the edge
 * object it is handed. That memo is the whole reason edge identity matters:
 * hand it a fresh object and it re-renders, hand it the same one and it
 * bails. Counting renders here measures exactly what the real renderer would
 * have done.
 */
const StubEdge = memo(function StubEdge({ edge }: { edge: { id: string; data?: unknown } }) {
  edgeRenders++;
  const state = String((edge.data as { state?: string } | undefined)?.state);
  return <div data-testid="edge" data-edge-id={edge.id} data-state={state} />;
});

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
    children,
  }: {
    nodes: unknown[];
    edges: Array<{ id: string; data?: unknown }>;
    children?: ReactNode;
  }) => {
    graphRenders++;
    return (
      <div data-testid="graph" data-node-count={nodes.length} data-edge-count={edges.length}>
        {edges.map((e) => (
          <StubEdge key={e.id} edge={e} />
        ))}
        {children}
      </div>
    );
  },
  ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  useStore: () => [],
  EdgeLabelRenderer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ['M0 0', 0, 0, 0, 0],
}));

const { FlowView } = await import('./components/FlowView');

/** FlowView's own constants, restated so a change there fails here loudly. */
const FADE_MS = 800;
const SWEEP_FLOOR_MS = 16;

const TIMINGS: Array<[string, string]> = [];

beforeEach(() => {
  MockEventSource.reset();
  graphRenders = 0;
  edgeRenders = 0;
});

afterEach(() => {
  // Unmount while the fake clock is still installed — FlowView's cleanup
  // calls clearTimeout on a timer this clock owns — then hand the timers back.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  const width = Math.max(...TIMINGS.map(([l]) => l.length));
  console.log(
    `\nscale timings — live flow (${REAL_EVENT_COUNT} events, ${realTopology.edges.length} edges)\n` +
      TIMINGS.map(([l, v]) => `  ${l.padEnd(width)}  ${v.padStart(9)}`).join('\n') +
      '\n',
  );
});

async function mountFlow(topology: TopologyGraph = realTopology): Promise<MockEventSource> {
  mockFetch({ '/admin-api/topology': { body: topology } });
  installMockEventSource();
  renderWithRouter(<FlowView />);
  await screen.findByTestId('graph', {}, { timeout: 30_000 });
  return MockEventSource.latest;
}

function bufferCount(): number {
  const text = screen.getByText(/events in buffer/).textContent ?? '';
  return Number(text.split(' ')[0]);
}

const FRAME_EPOCH = Date.parse('2026-09-07T12:00:00.000Z');

/** N tap frames cycling through one namespace's events, with stable timestamps. */
function framesFrom(namespace: string | null, n: number): ReturnType<typeof tapFrameFor>[] {
  const names = realEvents
    .filter((e) => namespace === null || e.namespace === namespace)
    .map((e) => e.name);
  expect(names.length, `no events in namespace ${namespace}`).toBeGreaterThan(0);
  return Array.from({ length: n }, (_, i) =>
    tapFrameFor(names[i % names.length]!, new Date(FRAME_EPOCH + i).toISOString()),
  );
}

interface DripResult {
  /** Commits caused by a frame arriving. */
  pulseCommits: number;
  /** Commits caused by the fade sweeper firing. */
  sweepCommits: number;
  /** Memoised edge wrappers re-rendered, mount and warm-up excluded. */
  edgeWork: number;
  /** Virtual milliseconds of stream time consumed. */
  elapsedMs: number;
}

/**
 * Drip frames into a mounted view on a FROZEN clock, one frame per
 * event-loop turn, advancing virtual time by `stepMs` between them.
 *
 * The split matters: with the clock stopped, an `emit` can only produce the
 * commit the frame itself causes, and with no frame arriving, an advance can
 * only produce commits the sweeper caused. On the real clock those two are
 * inseparable, which is why the old single budget could not say which one had
 * regressed.
 *
 * Call only after `vi.useFakeTimers()`.
 */
async function drip(
  es: MockEventSource,
  frames: ReturnType<typeof tapFrameFor>[],
  stepMs: number,
): Promise<DripResult> {
  // One warm-up frame plus a full fade, outside the measurement: the first
  // pulse after mount rebuilds every edge object once (the style cache starts
  // empty), and that one-off is not per-frame cost.
  await act(async () => {
    es.emit(frames[0]!);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FADE_MS + SWEEP_FLOOR_MS);
  });

  const edgesAt = edgeRenders;
  let pulseCommits = 0;
  let sweepCommits = 0;

  for (const frame of frames) {
    const beforeEmit = graphRenders;
    await act(async () => {
      es.emit(frame);
    });
    pulseCommits += graphRenders - beforeEmit;

    const beforeTick = graphRenders;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(stepMs);
    });
    sweepCommits += graphRenders - beforeTick;
  }

  // Drain the fades still in flight so the sweeper is idle at the end.
  const beforeDrain = graphRenders;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FADE_MS + SWEEP_FLOOR_MS);
  });
  sweepCommits += graphRenders - beforeDrain;

  return {
    pulseCommits,
    sweepCommits,
    edgeWork: edgeRenders - edgesAt,
    elapsedMs: frames.length * stepMs + FADE_MS + SWEEP_FLOOR_MS,
  };
}

/** The sweeper's ceiling: one commit per tick, and a tick is at least 16 ms. */
function sweepBudget(frameCount: number, elapsedMs: number): number {
  return Math.min(frameCount, Math.ceil(elapsedMs / SWEEP_FLOOR_MS)) + 2;
}

describe('FlowView under a sustained tap', () => {
  it('keeps the buffer capped and the ticker at ten rows across 2000 frames', async () => {
    const es = await mountFlow();
    const burst = tapBurst(2_000);
    const mountRenders = graphRenders;

    const t0 = performance.now();
    await act(async () => {
      for (const frame of burst) es.emit(frame);
    });
    await waitFor(() => expect(bufferCount()).toBeGreaterThan(0));
    const ms = performance.now() - t0;

    const commits = graphRenders - mountRenders;
    TIMINGS.push(['2000 SSE frames', `${ms.toFixed(0)} ms`]);
    TIMINGS.push(['graph commits / 2000 frames', String(commits)]);

    // Bounded buffer: MAX_BUFFER is 200, so 2000 frames must not grow it.
    expect(bufferCount()).toBeLessThanOrEqual(200);
    // The ticker shows the last ten, and only the last ten — no re-appending.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    // The most recent frame is at the top.
    expect(screen.getAllByRole('listitem')[0]!).toHaveTextContent(burst[burst.length - 1]!.eventName);
    // Everything inside one `act()` is one React batch, so this says nothing
    // about per-frame cost — the drip tests below are what measure that. It
    // does say the buffer and the ticker survive 2000 frames arriving at once.
    expect(commits).toBeLessThan(burst.length / 5);
  }, 90_000);

  // The burst above lands inside ONE `act()`, so React batches all 2000
  // updates into a couple of commits — which is not what a real SSE stream
  // does. Frames arrive on separate event-loop turns, each one its own batch,
  // so each one can commit on its own.
  //
  // Two frame rates, one clock we control. A stream faster than the sweep
  // floor and a stream slower than it produce very different sweep counts and
  // the SAME per-frame commit count, which is the invariant: the view commits
  // once because a frame arrived, and the fade sweeper is paced by the clock
  // on top of that — never once per lit edge, never once per frame twice.
  it.each([
    { label: 'faster than the sweep floor', stepMs: 4 },
    { label: 'slower than the sweep floor', stepMs: 32 },
  ])('commits once per frame when frames arrive $label', async ({ label, stepMs }) => {
    const es = await mountFlow();
    const frames = framesFrom(null, 500);

    vi.useFakeTimers();
    const result = await drip(es, frames, stepMs);

    TIMINGS.push([`${frames.length} frames @ ${stepMs}ms — pulse commits`, String(result.pulseCommits)]);
    TIMINGS.push([`${frames.length} frames @ ${stepMs}ms — sweep commits`, String(result.sweepCommits)]);
    TIMINGS.push([`${frames.length} frames @ ${stepMs}ms — edge renders`, String(result.edgeWork)]);

    // One commit per frame is the floor — the buffer chip genuinely changes
    // every frame. Two was the bug: an effect watching `lastEvent` fired a
    // second, separate commit to pulse the edges. Exact, not a budget: this
    // number cannot legitimately drift with catalog size or machine speed.
    expect(result.pulseCommits, `pulse commits (${label})`).toBe(frames.length);

    // The sweeper is a single self-rescheduling timer floored at 16 ms, so its
    // commits are capped by stream time — and never exceed one per frame.
    expect(result.sweepCommits, `sweep commits (${label})`).toBeLessThanOrEqual(
      sweepBudget(frames.length, result.elapsedMs),
    );

    // The buffer and the ticker survive the whole stream.
    expect(bufferCount()).toBeLessThanOrEqual(200);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getAllByRole('listitem')[0]!).toHaveTextContent(frames[frames.length - 1]!.eventName);
  }, 120_000);

  // A stream faster than the sweep floor must actually coalesce. Without this
  // the bound above is satisfiable by a sweeper that fires once per frame at
  // every rate, which is the design that produced 400 extra commits a second.
  it('coalesces fades when frames arrive faster than the sweep floor', async () => {
    const es = await mountFlow();
    const frames = framesFrom(null, 500);
    const stepMs = 4;

    vi.useFakeTimers();
    const result = await drip(es, frames, stepMs);

    // 500 frames spanning ~2 s of stream time cannot need more than ~125
    // sweeps at a 16 ms floor. One sweep per frame would be 500.
    expect(result.sweepCommits).toBeLessThan(frames.length / 2);
    expect(result.sweepCommits).toBeGreaterThan(0);
  }, 120_000);

  // O(1) per tick, not O(active edges): the sweeper retires everything due in
  // ONE state update. Lighting sixty events at the same instant and lighting
  // one must cost the same number of commits when the fade expires.
  it('retires a fade in one commit however many edges are lit', async () => {
    const es = await mountFlow();
    const many = framesFrom(null, 60);

    vi.useFakeTimers();

    /** Commits caused purely by the fade expiring for a batch of frames. */
    async function retireCost(batch: ReturnType<typeof tapFrameFor>[]): Promise<number> {
      // One act() ⇒ one instant ⇒ every pulse expires together.
      await act(async () => {
        for (const frame of batch) es.emit(frame);
      });
      const before = graphRenders;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FADE_MS + SWEEP_FLOOR_MS);
      });
      return graphRenders - before;
    }

    const one = await retireCost(many.slice(0, 1));
    const sixty = await retireCost(many);

    TIMINGS.push(['retire 1 lit event', `${one} commit`]);
    TIMINGS.push([`retire ${many.length} lit events`, `${sixty} commit`]);

    expect(one).toBe(1);
    expect(sixty).toBe(one);
  }, 120_000);

  // The assertion the old budget was reaching for, said properly: the cost of
  // a stream is a function of the stream, not of how big the catalog is. Same
  // frames, same clock, a topology 7.6× larger — same commits.
  it('costs the same per frame at 31 events as at the full catalog', async () => {
    // 32 ms × 31 distinct client events cycles slower than FADE_MS, so pulses
    // genuinely expire mid-stream and the sweeper is exercised on both graphs
    // rather than only on the drain at the end.
    const stepMs = 32;
    const frames = framesFrom('client', 300);
    const small = buildRealTopology('client');
    expect(small.edges.length * 3).toBeLessThan(realTopology.edges.length);

    const es1 = await mountFlow(small);
    vi.useFakeTimers();
    const narrow = await drip(es1, frames, stepMs);

    cleanup();
    vi.useRealTimers();
    graphRenders = 0;
    edgeRenders = 0;

    const es2 = await mountFlow(realTopology);
    vi.useFakeTimers();
    const wide = await drip(es2, frames, stepMs);

    TIMINGS.push([
      `${frames.length} frames — commits @ ${small.edges.length} edges`,
      String(narrow.pulseCommits + narrow.sweepCommits),
    ]);
    TIMINGS.push([
      `${frames.length} frames — commits @ ${realTopology.edges.length} edges`,
      String(wide.pulseCommits + wide.sweepCommits),
    ]);
    TIMINGS.push([
      `${frames.length} frames — edge renders ${small.edges.length}/${realTopology.edges.length} edges`,
      `${narrow.edgeWork}/${wide.edgeWork}`,
    ]);

    expect(wide.pulseCommits).toBe(narrow.pulseCommits);
    expect(wide.sweepCommits).toBe(narrow.sweepCommits);

    // Only the edges incident to the firing event are rebuilt, so the same
    // stream touches the same handful of wrappers in both graphs. The 349
    // extra edges in the wide topology must cost nothing.
    expect(wide.edgeWork).toBe(narrow.edgeWork);
    // And that handful is a handful: a few edges per frame, not the graph.
    expect(wide.edgeWork).toBeLessThan(frames.length * 8);
  }, 180_000);

  it('drops off-shape frames without taking the view down', async () => {
    const es = await mountFlow();
    await act(async () => {
      es.emitRaw('not json');
      es.emit(null);
      es.emit({ nope: true });
      es.emit(tapBurst(1)[0]);
    });
    await waitFor(() => expect(bufferCount()).toBe(1));
    expect(screen.getByTestId('graph')).toBeInTheDocument();
  }, 40_000);
});
