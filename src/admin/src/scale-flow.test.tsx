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

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { memo, type ReactNode } from 'react';

import { installMockEventSource, mockFetch, MockEventSource, renderWithRouter } from './test/helpers';
import { REAL_EVENT_COUNT, realTopology, tapBurst } from './test/fixtures/registry';

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

const TIMINGS: Array<[string, string]> = [];

beforeEach(() => {
  MockEventSource.reset();
  graphRenders = 0;
  edgeRenders = 0;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(() => {
  const width = Math.max(...TIMINGS.map(([l]) => l.length));
  console.log(
    `\nscale timings — live flow (${REAL_EVENT_COUNT} events)\n` +
      TIMINGS.map(([l, v]) => `  ${l.padEnd(width)}  ${v.padStart(9)}`).join('\n') +
      '\n',
  );
});

async function mountFlow(): Promise<MockEventSource> {
  mockFetch({ '/api/topology': { body: realTopology } });
  installMockEventSource();
  renderWithRouter(<FlowView />);
  await screen.findByTestId('graph', {}, { timeout: 30_000 });
  return MockEventSource.latest;
}

function bufferCount(): number {
  const text = screen.getByText(/events in buffer/).textContent ?? '';
  return Number(text.split(' ')[0]);
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
    // about per-frame cost — the drip test below is what measures that. It
    // does say the buffer and the ticker survive 2000 frames arriving at once.
    expect(commits).toBeLessThan(burst.length / 5);
  }, 90_000);

  // The burst above lands inside ONE `act()`, so React batches all 2000
  // updates into a couple of commits — which is not what a real SSE stream
  // does. Frames arrive on separate event-loop turns, each one its own
  // batch, so each one can commit on its own. Flushing per frame is the
  // honest model of that, and it is the measurement that decides whether
  // /flow is safe to leave open during an incident.
  it('does not commit the graph once per frame when frames arrive one per turn', async () => {
    const es = await mountFlow();
    const mountRenders = graphRenders;
    const mountEdgeRenders = edgeRenders;
    const drip = tapBurst(500);

    const t0 = performance.now();
    for (const frame of drip) {
      await act(async () => {
        es.emit(frame);
      });
    }
    // Let any coalescing window close before counting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const ms = performance.now() - t0;

    const commits = graphRenders - mountRenders;
    const edgeWork = edgeRenders - mountEdgeRenders;
    const edgeCount = realTopology.edges.length;
    TIMINGS.push([`${drip.length} frames, one per turn`, `${ms.toFixed(0)} ms`]);
    TIMINGS.push([`graph commits / ${drip.length} frames`, String(commits)]);
    TIMINGS.push([`edge renders / ${drip.length} frames`, String(edgeWork)]);

    expect(bufferCount()).toBeLessThanOrEqual(200);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    // One commit per frame is the floor — the buffer chip genuinely changes
    // every frame. Two was the bug: an effect watching `lastEvent` fired a
    // second, separate commit to pulse the edges.
    expect(commits).toBeLessThanOrEqual(drip.length + 5);

    // The one that actually costs: rebuilding all `edgeCount` edge objects
    // per frame re-rendered every memoised edge wrapper. Only the handful
    // whose state changed should be touched.
    expect(edgeWork).toBeLessThan(drip.length * edgeCount * 0.05);
  }, 120_000);

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
