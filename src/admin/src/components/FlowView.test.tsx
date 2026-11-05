// What the operator sees on /flow as the stream runs.
//
// ReactFlow is stubbed: it needs a real layout engine and a canvas, and none
// of the behaviour under test here is its. The stub still renders the edges it
// is handed with their `state`, which is the one thing FlowView asks of it —
// so the "an event pulses its edges" assertions are real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { installMockEventSource, mockFetch, MockEventSource, renderWithRouter } from '../test/helpers';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, children }: { nodes: unknown[]; edges: Array<{ id: string; data?: Record<string, unknown> }>; children?: ReactNode }) => (
    <div data-testid="graph" data-node-count={nodes.length}>
      {edges.map((e) => (
        <div key={e.id} data-testid="edge" data-edge-id={e.id} data-state={String(e.data?.state)} />
      ))}
      {children}
    </div>
  ),
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

const { FlowView } = await import('./FlowView');

const topology = {
  nodes: [
    { id: 'platform-api', type: 'service', metadata: {} },
    { id: 'call:caption:line', type: 'event', metadata: { transport: 'signal', namespace: 'call' } },
    { id: 'transcription-worker', type: 'service', metadata: {} },
  ],
  edges: [
    { from: 'platform-api', to: 'call:caption:line', relation: 'publishes' },
    { from: 'call:caption:line', to: 'transcription-worker', relation: 'subscribes' },
  ],
};

const tapEvent = (over: Record<string, unknown> = {}) => ({
  eventName: 'call:caption:line',
  namespace: 'call',
  producer: 'platform-api',
  transport: 'signal',
  timestamp: '2026-09-07T11:22:33.456Z',
  ...over,
});

function mount(topologyResponse: unknown = topology) {
  mockFetch({ '/api/topology': { body: topologyResponse } });
  installMockEventSource();
  return renderWithRouter(<FlowView />);
}

const edgeStates = () =>
  screen.getAllByTestId('edge').map((el) => el.getAttribute('data-state'));

beforeEach(() => MockEventSource.reset());
afterEach(() => vi.unstubAllGlobals());

describe('FlowView — loading / error tri-state', () => {
  it('shows a loading state before the topology arrives', async () => {
    mount();
    expect(screen.getByText('Loading flow…')).toBeInTheDocument();
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument();
    await screen.findByTestId('graph');
  });

  it('shows an error state, not an empty graph, when the topology fetch fails', async () => {
    mockFetch({ '/api/topology': { status: 500, text: 'no registry' } });
    installMockEventSource();
    renderWithRouter(<FlowView />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading the flow graph');
    // An empty canvas would read as "nothing is declared", which is a lie.
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for events/)).not.toBeInTheDocument();
  });

  it('renders an empty-but-valid topology as a graph, not an error', async () => {
    mount({ nodes: [], edges: [] });
    expect(await screen.findByTestId('graph')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('FlowView — stream state', () => {
  it('reports live and an empty buffer before any event arrives', async () => {
    mount();
    await screen.findByTestId('graph');
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('0 events in buffer')).toBeInTheDocument();
    expect(screen.getByText('Waiting for events…')).toBeInTheDocument();
  });

  it('counts buffered events and lists them newest-first', async () => {
    mount();
    await screen.findByTestId('graph');
    act(() => {
      MockEventSource.latest.emit(tapEvent({ eventName: 'first' }));
      MockEventSource.latest.emit(tapEvent({ eventName: 'second' }));
    });
    expect(screen.getByText('2 events in buffer')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: /Recent events/ })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('second');
    expect(rows[1]).toHaveTextContent('first');
  });

  it('shows only the last ten events in the ticker', async () => {
    mount();
    await screen.findByTestId('graph');
    act(() => {
      for (let i = 0; i < 15; i++) MockEventSource.latest.emit(tapEvent({ eventName: `e${i}` }));
    });
    expect(screen.getByText('15 events in buffer')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: /Recent events/ })).getAllByRole('listitem');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('e14');
    expect(rows[9]).toHaveTextContent('e5');
  });

  it('survives a malformed frame instead of blanking the view', async () => {
    // The regression this guards: a frame that parses but has no `timestamp`
    // reached the ticker, which does `timestamp.slice(11, 23)`, and the
    // resulting render throw took the entire Live Flow view down.
    mount();
    await screen.findByTestId('graph');
    act(() => {
      MockEventSource.latest.emit(tapEvent({ eventName: 'good' }));
      MockEventSource.latest.emitRaw('{"broken":true}');
      MockEventSource.latest.emitRaw('not json at all');
      MockEventSource.latest.emit(tapEvent({ eventName: 'still-here' }));
    });
    expect(screen.getByTestId('graph')).toBeInTheDocument();
    expect(screen.getByText('2 events in buffer')).toBeInTheDocument();
    expect(screen.getByText('still-here')).toBeInTheDocument();
  });

  it('surfaces a dead stream as a status message rather than silence', async () => {
    mount();
    await screen.findByTestId('graph');
    act(() => MockEventSource.latest.fail());
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((el) => el.textContent?.includes('SSE connection closed')),
      ).toBe(true),
    );
    // The graph is still valid data — it must not be replaced by the error.
    expect(screen.getByTestId('graph')).toBeInTheDocument();
  });
});

describe('FlowView — pause / resume / clear', () => {
  it('swaps Pause for Resume and stops taking events', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    act(() => MockEventSource.latest.emit(tapEvent({ eventName: 'before' })));

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();

    const closed = MockEventSource.instances[0]!;
    act(() => closed.emit(tapEvent({ eventName: 'while-paused' })));
    expect(screen.getByText('1 events in buffer')).toBeInTheDocument();
    expect(screen.queryByText('while-paused')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByText('live')).toBeInTheDocument();
    act(() => MockEventSource.latest.emit(tapEvent({ eventName: 'after-resume' })));
    expect(screen.getByText('2 events in buffer')).toBeInTheDocument();
  });

  it('clear empties the ticker but leaves the stream live', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    act(() => MockEventSource.latest.emit(tapEvent()));
    expect(screen.getByText('1 events in buffer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 events in buffer')).toBeInTheDocument();
    expect(screen.getByText('Waiting for events…')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    // Still receiving.
    act(() => MockEventSource.latest.emit(tapEvent({ eventName: 'post-clear' })));
    expect(screen.getByText('post-clear')).toBeInTheDocument();
  });
});

describe('FlowView — sampling and filters', () => {
  it('reopens the stream with the sample knob the operator typed', async () => {
    // The regression: state held a coerced number, so clearing the box
    // rewrote it as "1" and the next keystrokes appended — typing 10 sampled
    // 1-in-110, which on a firehose is the difference between watching the
    // flow and watching nothing.
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    const input = screen.getByLabelText('sample 1/N');
    await user.clear(input);
    await user.type(input, '10');
    expect(input).toHaveValue(10);
    await waitFor(() => expect(MockEventSource.latest.url).toBe('/api/flow?sample=10'));
  });

  it('never sends a sample below 1, which would mean "no events at all"', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    const input = screen.getByLabelText('sample 1/N');
    await user.clear(input);
    expect(MockEventSource.latest.url).not.toContain('sample=');
    await user.type(input, '0');
    expect(MockEventSource.latest.url).not.toContain('sample=0');
    // …and the box is normalised once the operator leaves it.
    await user.tab();
    expect(input).toHaveValue(1);
  });

  it('clamps the sample to the advertised maximum', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    const input = screen.getByLabelText('sample 1/N');
    await user.clear(input);
    await user.type(input, '99999');
    await waitFor(() => expect(MockEventSource.latest.url).toBe('/api/flow?sample=1000'));
  });

  it('offers each namespace present in the topology, plus "all"', async () => {
    mount();
    await screen.findByTestId('graph');
    const select = screen.getByLabelText('namespace');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['all', 'call']);
  });

  it('keeps every namespace in the list after one of them narrows the graph', async () => {
    // The regression: options were derived from the CURRENT topology
    // response, and choosing a namespace refetches `?namespace=<it>` — whose
    // nodes mention only that one. So picking "call" deleted "pipeline" from
    // the list that had just been used to pick it, and the only way to
    // another namespace was back through "all". TopologyView was fixed for
    // this; the flow view, which shares the control, was not.
    const twoNamespaces = {
      nodes: [
        { id: 'platform-api', type: 'service', metadata: {} },
        { id: 'call:caption:line', type: 'event', metadata: { transport: 'signal', namespace: 'call' } },
        { id: 'pipeline:run:started', type: 'event', metadata: { transport: 'durable', namespace: 'pipeline' } },
      ],
      edges: [{ from: 'platform-api', to: 'call:caption:line', relation: 'publishes' }],
    };
    const callOnly = {
      nodes: [
        { id: 'platform-api', type: 'service', metadata: {} },
        { id: 'call:caption:line', type: 'event', metadata: { transport: 'signal', namespace: 'call' } },
      ],
      edges: [{ from: 'platform-api', to: 'call:caption:line', relation: 'publishes' }],
    };
    let call = 0;
    mockFetch({ '/api/topology': () => (call++ === 0 ? { body: twoNamespaces } : { body: callOnly }) });
    installMockEventSource();
    const user = userEvent.setup();
    renderWithRouter(<FlowView />);
    await screen.findByTestId('graph');

    const select = screen.getByLabelText('namespace');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'all',
      'call',
      'pipeline',
    ]);

    await user.selectOptions(select, 'call');
    await waitFor(() => expect(MockEventSource.latest.url).toContain('namespace=call'));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'all',
      'call',
      'pipeline',
    ]);
  });

  it('refetches the topology and reopens the stream when a namespace is chosen', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('graph');
    await user.selectOptions(screen.getByLabelText('namespace'), 'call');
    await waitFor(() => expect(MockEventSource.latest.url).toContain('namespace=call'));
  });
});

describe('FlowView — edge pulsing', () => {
  it('activates both edges incident to a firing event, then fades them', async () => {
    // Fake only what the fade reads. React 19's scheduler runs on
    // setImmediate/MessageChannel; faking those stalls the commit that
    // applies the pulse, so the edges never leave 'default'.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      mount();
      await screen.findByTestId('graph');
      expect(edgeStates()).toEqual(['default', 'default']);

      act(() => MockEventSource.latest.emit(tapEvent()));
      expect(edgeStates()).toEqual(['active', 'active']);

      // 800ms fade — an edge that never returns to default leaves the whole
      // graph lit up and stops meaning anything.
      act(() => vi.advanceTimersByTime(900));
      expect(edgeStates()).toEqual(['default', 'default']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves edges alone for an event that is not in this topology', async () => {
    mount();
    await screen.findByTestId('graph');
    act(() => MockEventSource.latest.emit(tapEvent({ eventName: 'some:other:event' })));
    expect(edgeStates()).toEqual(['default', 'default']);
    // It is still counted — the buffer is the raw stream, not the graph.
    expect(screen.getByText('1 events in buffer')).toBeInTheDocument();
  });
});
