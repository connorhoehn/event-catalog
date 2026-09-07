// /namespaces — the rollup grid and its per-namespace bulk actions.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamespacesView } from './NamespacesView';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';

const ns = (namespace: string, over: Record<string, unknown> = {}) => ({
  namespace,
  eventCount: 2,
  deprecatedCount: 0,
  producerCount: 1,
  subscriberCount: 3,
  signalCount: 1,
  durableCount: 1,
  events: [
    { name: `${namespace}:one`, transport: 'signal', version: 1, deprecated: false },
    { name: `${namespace}:two`, transport: 'durable', version: 4, deprecated: false },
  ],
  ...over,
});

const SUMMARY = { count: 2, items: [ns('call'), ns('pipeline')] };

function mount(routes: RouteTable = { '/api/namespaces/summary': { body: SUMMARY } }) {
  const mock = mockFetch(routes);
  renderWithRouter(<NamespacesView />);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('NamespacesView — loading / empty / error tri-state', () => {
  it('shows a busy state rather than claiming there are no namespaces', async () => {
    // The bug: `rows` starts empty, so the first paint was the "No
    // namespaces — declare an event to populate the catalog" card. A request
    // still in flight was reported as a finding about the catalog.
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading namespaces…');
    expect(screen.queryByText('No namespaces')).not.toBeInTheDocument();
    await screen.findByText('call');
  });

  it('renders an error, not an empty grid, on a 500', async () => {
    mount({ '/api/namespaces/summary': { status: 500, text: 'registry down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading namespaces');
    expect(alert).toHaveTextContent('registry down');
    expect(screen.queryByText('No namespaces')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Namespaces' })).toBeInTheDocument();
  });

  it('recovers when the operator retries', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/api/namespaces/summary': () =>
        failing ? { status: 503, text: 'starting up' } : { body: SUMMARY },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('call')).toBeInTheDocument();
  });

  it('says the catalog is empty only when it really is', async () => {
    mount({ '/api/namespaces/summary': { body: { count: 0, items: [] } } });
    expect(await screen.findByText('No namespaces')).toBeInTheDocument();
    expect(screen.getByText(/Declare an event to populate the catalog/)).toBeInTheDocument();
  });

  it('asks for the full detail payload in one round trip', async () => {
    const { calls } = mount();
    await screen.findByText('call');
    expect(calls[0]).toBe('/api/namespaces/summary?detail=full');
  });
});

describe('NamespacesView — the grid', () => {
  it('summarises each namespace with its counts', async () => {
    mount({
      '/api/namespaces/summary': {
        body: { count: 1, items: [ns('call', { eventCount: 9, signalCount: 7, durableCount: 2, deprecatedCount: 1 })] },
      },
    });
    await screen.findByText('call');
    expect(screen.getByText('9 events')).toBeInTheDocument();
    expect(screen.getByText('7 signal')).toBeInTheDocument();
    expect(screen.getByText('2 durable')).toBeInTheDocument();
    expect(screen.getByText('1 deprecated')).toBeInTheDocument();
  });

  it('pluralises producers and subscribers correctly', async () => {
    mount({
      '/api/namespaces/summary': {
        body: { count: 1, items: [ns('call', { producerCount: 1, subscriberCount: 3 })] },
      },
    });
    expect(await screen.findByText('1 producer · 3 subscribers')).toBeInTheDocument();
  });

  it('omits a zero-count chip rather than showing "0 durable"', async () => {
    mount({
      '/api/namespaces/summary': {
        body: { count: 1, items: [ns('call', { durableCount: 0, deprecatedCount: 0 })] },
      },
    });
    await screen.findByText('call');
    expect(screen.queryByText('0 durable')).not.toBeInTheDocument();
    expect(screen.queryByText('0 deprecated')).not.toBeInTheDocument();
  });

  it('expands a namespace to its events, and reports the expansion to a screen reader', async () => {
    const user = userEvent.setup();
    mount();
    const toggle = (await screen.findByText('call')).closest('button')!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'call:one' })).toHaveAttribute('href', '/events/call%3Aone');
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('collapses again on a second click', async () => {
    const user = userEvent.setup();
    mount();
    const toggle = (await screen.findByText('call')).closest('button')!;
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByRole('link', { name: 'call:one' })).not.toBeInTheDocument();
  });
});

describe('NamespacesView — the filter box', () => {
  it('narrows the grid to matching namespaces', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('call');
    await user.type(screen.getByLabelText('Filter by namespace'), 'pipe');
    expect(screen.queryByText('call')).not.toBeInTheDocument();
    expect(screen.getByText('pipeline')).toBeInTheDocument();
  });

  it('says the FILTER matched nothing, not that the catalog is empty', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('call');
    await user.type(screen.getByLabelText('Filter by namespace'), 'zzz');
    expect(screen.getByText('No namespace matches "zzz".')).toBeInTheDocument();
  });

  it('keeps the total chip counting the whole catalog, not the filtered view', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('call');
    await user.type(screen.getByLabelText('Filter by namespace'), 'call');
    expect(screen.getByText('2 total')).toBeInTheDocument();
  });
});

describe('NamespacesView — bulk deprecation', () => {
  async function expandCall(user: ReturnType<typeof userEvent.setup>) {
    const toggle = (await screen.findByText('call')).closest('button')!;
    await user.click(toggle);
  }

  it('requires a confirm step before deprecating a whole namespace', async () => {
    const user = userEvent.setup();
    const { fn } = mount();
    await expandCall(user);
    await user.click(screen.getByRole('button', { name: 'Deprecate namespace' }));
    // Nothing has been sent yet — only the confirmation UI appeared.
    expect(fn.mock.calls.filter(([url]) => String(url).includes('bulk/deprecate'))).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('sends every event in the namespace with the typed reason', async () => {
    const user = userEvent.setup();
    const { fn } = mount({
      '/api/namespaces/summary': { body: SUMMARY },
      '/api/events/bulk/deprecate': { body: { deprecated: ['call:one', 'call:two'], notFound: [], total: 2 } },
    });
    await expandCall(user);
    await user.click(screen.getByRole('button', { name: 'Deprecate namespace' }));
    await user.type(screen.getByLabelText(/Reason for deprecating/), 'superseded by v2');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const call = fn.mock.calls.find(([url]) => String(url).includes('bulk/deprecate'))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      names: ['call:one', 'call:two'],
      reason: 'superseded by v2',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Deprecated 2/2 event(s).');
  });

  it('reports a failed bulk deprecation instead of implying it worked', async () => {
    const user = userEvent.setup();
    mount({
      '/api/namespaces/summary': { body: SUMMARY },
      '/api/events/bulk/deprecate': { status: 500, text: 'write failed' },
    });
    await expandCall(user);
    await user.click(screen.getByRole('button', { name: 'Deprecate namespace' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Error: API 500: write failed');
  });

  it('cancels without sending anything', async () => {
    const user = userEvent.setup();
    const { fn } = mount();
    await expandCall(user);
    await user.click(screen.getByRole('button', { name: 'Deprecate namespace' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(fn.mock.calls.filter(([url]) => String(url).includes('bulk/deprecate'))).toHaveLength(0);
  });

  it('exports exactly the namespace it was asked about', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    mount();
    await expandCall(user);
    await user.click(screen.getByRole('button', { name: 'Export namespace JSON' }));
    expect(open).toHaveBeenCalledWith('/api/events/bulk/export?names=call%3Aone,call%3Atwo', '_blank');
  });
});
