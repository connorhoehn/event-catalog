// /topology, rendered against the REAL @xyflow/react.
//
// Deliberately not stubbed, unlike FlowView's suite. Two of the three bugs
// this view has shipped were invisible to markup assertions on a stub:
//
//   1. Two copies of @xyflow/react (one from this app, one pulled in through
//      the library's former source alias) put ReactFlowProvider's context in a different module
//      instance than the one `useStore` reads, so NamespaceClusters threw
//      "you have not used ReactFlowProvider as an ancestor" and the route
//      white-screened. A stub makes that unreachable; rendering the real
//      graph through the same vite alias + dedupe the bundle uses reproduces
//      it exactly. So: these tests assert that nodes AND the namespace
//      overlay actually reach the DOM.
//   2. `.view-canvas` had only `min-height`, so the graph laid out at 0px.
//      jsdom applies no stylesheet, so that one is pinned in styles.test.ts
//      instead — it is a CSS invariant, not a render one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopologyView } from './TopologyView';
import { chooseOption, mockFetch, readOptions, renderWithRouter, type RouteTable } from '../test/helpers';

const FULL = {
  nodes: [
    { id: 'platform-api', type: 'service', metadata: {} },
    { id: 'call:caption:line', type: 'event', metadata: { transport: 'signal', namespace: 'call' } },
    { id: 'pipeline:step:started', type: 'event', metadata: { transport: 'durable', namespace: 'pipeline' } },
    { id: 'transcription-worker', type: 'service', metadata: {} },
  ],
  edges: [
    { from: 'platform-api', to: 'call:caption:line', relation: 'publishes' },
    { from: 'call:caption:line', to: 'transcription-worker', relation: 'subscribes' },
    { from: 'platform-api', to: 'pipeline:step:started', relation: 'publishes' },
  ],
};

/** Only the `call` namespace — what `GET /api/topology?namespace=call` returns. */
const CALL_ONLY = {
  nodes: [
    { id: 'platform-api', type: 'service', metadata: {} },
    { id: 'call:caption:line', type: 'event', metadata: { transport: 'signal', namespace: 'call' } },
  ],
  edges: [{ from: 'platform-api', to: 'call:caption:line', relation: 'publishes' }],
};

function mount(routes: RouteTable = { '/admin-api/topology': { body: FULL } }) {
  const mock = mockFetch(routes);
  renderWithRouter(<TopologyView />);
  return mock;
}

const namespaceSelect = () => screen.getByLabelText('namespace');
const namespaceOptions = async (user: ReturnType<typeof userEvent.setup>) =>
  (await readOptions(user, namespaceSelect())).map((o) => o.value);

afterEach(() => vi.unstubAllGlobals());

describe('TopologyView — loading / empty / error tri-state', () => {
  it('shows a busy state before the topology arrives, and keeps the heading', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Event Topology' })).toBeInTheDocument();
    expect(screen.getByText('Loading topology…')).toBeInTheDocument();
    expect(screen.queryByText('No events registered yet')).not.toBeInTheDocument();
    await screen.findByText('call:caption:line');
  });

  it('renders an error, not an empty graph, when /api/topology fails', async () => {
    mount({ '/admin-api/topology': { status: 500, text: 'registry unreachable' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading the topology');
    expect(alert).toHaveTextContent('registry unreachable');
    // "No events registered yet" on a 500 is the lie an operator acts on.
    expect(screen.queryByText('No events registered yet')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Event Topology' })).toBeInTheDocument();
  });

  it('surfaces a network failure rather than rendering forever', async () => {
    mount({ '/admin-api/topology': { networkError: 'Failed to fetch' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
  });

  it('distinguishes an empty catalog from a failed one', async () => {
    mount({ '/admin-api/topology': { body: { nodes: [], edges: [] } } });
    expect(await screen.findByText('No events registered yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('TopologyView — the graph itself', () => {
  it('renders every event and service node through a working ReactFlow context', async () => {
    // The white-screen regression: with two @xyflow/react instances,
    // NamespaceClusters' useStore throws and nothing below reaches the DOM.
    mount();
    for (const label of ['call:caption:line', 'pipeline:step:started', 'platform-api', 'transcription-worker']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it('labels each event node with its transport and namespace', async () => {
    mount();
    await screen.findByText('call:caption:line');
    expect(screen.getByText('signal · call')).toBeInTheDocument();
    expect(screen.getByText('durable · pipeline')).toBeInTheDocument();
  });

  it('marks a service that only publishes as a producer and one that only consumes as a consumer', async () => {
    mount();
    await screen.findByText('platform-api');
    expect(screen.getByText('service · producer')).toBeInTheDocument();
    expect(screen.getByText('service · consumer')).toBeInTheDocument();
  });

  it('draws one namespace cluster per namespace, counting its events', async () => {
    // The overlay reads live node positions out of ReactFlow's store — it is
    // the component that actually needs the shared context.
    mount();
    expect(await screen.findByText('call · 1')).toBeInTheDocument();
    expect(screen.getByText('pipeline · 1')).toBeInTheDocument();
  });

  it('counts events and services separately in the toolbar', async () => {
    mount();
    expect(await screen.findByText('2 events')).toBeInTheDocument();
    expect(screen.getByText('2 services')).toBeInTheDocument();
  });

  it('survives a node whose metadata carries no namespace or transport', async () => {
    // The namespace field went missing from /api/topology once already.
    mount({
      '/admin-api/topology': {
        body: {
          nodes: [{ id: 'orphan:event', type: 'event', metadata: {} }],
          edges: [],
        },
      },
    });
    expect(await screen.findByText('orphan:event')).toBeInTheDocument();
    // Defaults to signal rather than rendering "undefined".
    expect(screen.getByText('signal')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});

describe('TopologyView — the namespace filter', () => {
  it('offers every namespace in the catalog', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('call:caption:line');
    expect(await namespaceOptions(user)).toEqual(['', 'call', 'pipeline']);
  });

  it('refetches the topology scoped to the chosen namespace', async () => {
    const user = userEvent.setup();
    const { calls } = mount({
      '/admin-api/topology?namespace=call': { body: CALL_ONLY },
      '/admin-api/topology': { body: FULL },
    });
    await screen.findByText('pipeline:step:started');
    await chooseOption(user, namespaceSelect(), 'call');
    await waitFor(() =>
      expect(screen.queryByText('pipeline:step:started')).not.toBeInTheDocument(),
    );
    expect(calls).toContain('/admin-api/topology?namespace=call');
  });

  it('KEEPS the other namespaces selectable after filtering to one', async () => {
    // Regression: the options were derived from the CURRENT response, and a
    // filtered response mentions only the namespace you filtered to — so
    // choosing "call" deleted "pipeline" from the dropdown you had just used
    // to choose it. The only route back to another namespace was via "all".
    const user = userEvent.setup();
    mount({
      '/admin-api/topology?namespace=call': { body: CALL_ONLY },
      '/admin-api/topology': { body: FULL },
    });
    await screen.findByText('pipeline:step:started');
    await chooseOption(user, namespaceSelect(), 'call');
    await waitFor(() =>
      expect(screen.queryByText('pipeline:step:started')).not.toBeInTheDocument(),
    );
    expect(await namespaceOptions(user)).toEqual(['', 'call', 'pipeline']);
  });

  it('says the namespace is empty, not that the catalog is', async () => {
    const user = userEvent.setup();
    mount({
      '/admin-api/topology?namespace=call': { body: { nodes: [], edges: [] } },
      '/admin-api/topology': { body: FULL },
    });
    await screen.findByText('pipeline:step:started');
    await chooseOption(user, namespaceSelect(), 'call');
    expect(await screen.findByText('No events in the "call" namespace')).toBeInTheDocument();
    expect(screen.queryByText('No events registered yet')).not.toBeInTheDocument();
  });

  it('recovers from a transient failure when the operator retries', async () => {
    // Two regressions in one: `error` was never reset, so a single 500 pinned
    // the error card for the life of the view and every later success
    // rendered behind it — and the error state replaced the whole toolbar, so
    // there was no control left to ask again with. A browser reload was the
    // only way out of a five-second blip.
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/admin-api/topology': () => (failing ? { status: 500, text: 'boom' } : { body: FULL }),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('call:caption:line')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('TopologyView — toolbar accessibility', () => {
  it('names the namespace select for a screen reader', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('call:caption:line');
    const select = namespaceSelect();
    expect(select).toHaveRole('combobox');
    expect((await readOptions(user, select)).map((o) => o.label)).toContain('all');
  });
});
