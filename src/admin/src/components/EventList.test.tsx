import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventList } from './EventList';
import { chooseOption, mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';
import { realEvents, realRoutes } from '../test/fixtures/registry';

const event = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  transport: 'signal',
  producer: 'platform-api',
  schema: {},
  subscribers: [],
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
  stats: { publishCount: 10, publishRate: 1.5, lastPublishedAt: null, errorCount: 0, subscriberCount: 0 },
  ...over,
});

function mount(routes: RouteTable = {}) {
  const mock = mockFetch({
    '/api/events': { body: { events: [event('a:one'), event('b:two')], total: 2 } },
    '/api/metrics/history': { body: {} },
    ...routes,
  });
  renderWithRouter(<EventList />);
  return mock;
}

/** The y coordinates of a sparkline's polyline, top-down. */
function sparklineYs(): number[] {
  const points = document.querySelector('[data-testid="sparkline"] polyline')!.getAttribute('points')!;
  return points.split(' ').map((p) => Number(p.split(',')[1]));
}

afterEach(() => vi.unstubAllGlobals());

describe('EventList — loading / empty / error tri-state', () => {
  it('shows a busy state before the first response', async () => {
    mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('No events registered')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await screen.findByRole('table');
  });

  it('renders an error state and no empty state when the fetch fails', async () => {
    // A 500 that reads as "No events registered" tells the operator the
    // registry is empty. It is the same pixels for two opposite facts.
    mount({ '/api/events': { status: 500, text: 'registry down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading events');
    expect(alert).toHaveTextContent('registry down');
    expect(screen.queryByText('No events registered')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the empty state only for a genuinely empty registry', async () => {
    mount({ '/api/events': { body: { events: [], total: 0 } } });
    expect(await screen.findByText('No events registered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries the fetch when Retry is pressed', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/api/events': () =>
        failing ? { status: 500, text: 'down' } : { body: { events: [event('a:one')], total: 1 } },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('a:one')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still renders the table when the metrics history endpoint fails', async () => {
    // History is a nice-to-have; losing it must not lose the event list.
    mount({ '/api/metrics/history': { status: 500, text: 'no history' } });
    expect(await screen.findByText('a:one')).toBeInTheDocument();
    expect(screen.getAllByText('no samples yet')).toHaveLength(2);
  });
});

describe('EventList — sparkline', () => {
  it('says so rather than drawing a line from a single sample', async () => {
    mount({ '/api/metrics/history': { body: { 'a:one': [4] } } });
    await screen.findByText('a:one');
    expect(screen.getAllByText('no samples yet').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="sparkline"]')).toBeNull();
  });

  it('draws a steady high rate as flat, not as a dramatic climb', async () => {
    // The regression: min-based normalisation pinned the smallest sample to
    // the bottom edge, so 100 → 102/s and 0 → 100/s drew the identical
    // full-height ramp. Rates are magnitudes; the baseline has to be zero.
    mount({ '/api/metrics/history': { body: { 'a:one': [100, 101, 102] } } });
    await screen.findByText('a:one');
    const ys = sparklineYs();
    const swing = Math.max(...ys) - Math.min(...ys);
    expect(swing).toBeLessThan(1); // out of a 16px box
  });

  it('still shows a real climb as a climb', async () => {
    mount({ '/api/metrics/history': { body: { 'a:one': [0, 50, 100] } } });
    await screen.findByText('a:one');
    const ys = sparklineYs();
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
  });

  it('names the sparkline for a screen reader', async () => {
    mount({ '/api/metrics/history': { body: { 'a:one': [1, 2, 3] } } });
    expect(
      await screen.findByRole('img', { name: '60 second publish-rate trend for a:one' }),
    ).toBeInTheDocument();
  });
});

describe('EventList — cells', () => {
  it('shows a dash, not a bare "/s", for an event with no stats yet', async () => {
    mount({ '/api/events': { body: { events: [event('a:one', { stats: null })], total: 1 } } });
    const row = (await screen.findByText('a:one')).closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('/s')).not.toBeInTheDocument();
    expect(within(row).getByText('never')).toBeInTheDocument();
  });

  it('joins a multi-producer declaration rather than printing an array', async () => {
    mount({
      '/api/events': {
        body: { events: [event('a:one', { producer: ['platform-api', 'gateway'] })], total: 1 },
      },
    });
    const row = (await screen.findByText('a:one')).closest('tr')!;
    expect(within(row).getByText('platform-api, gateway')).toBeInTheDocument();
  });
});

describe('EventList — filters and bulk actions', () => {
  it('asks the server for the filtered set', async () => {
    const user = userEvent.setup();
    const { calls } = mount();
    await screen.findByText('a:one');
    // The filters live in the collection toolbar's Filters popover.
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await chooseOption(user, screen.getByLabelText('Transport'), 'durable');
    await waitFor(() => expect(calls.some((c) => c.includes('transport=durable'))).toBe(true));
  });

  it('hides the bulk toolbar until something is selected', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('a:one');
    // The bulk actions replace the toolbar's resting controls while a
    // selection exists (CollectionToolbar `selection`).
    expect(screen.queryByLabelText('Event controls: selection')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deprecate' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select a:one' }));
    const bar = screen.getByLabelText('Event controls: selection');
    expect(bar).toHaveTextContent('1 selected');
    expect(within(bar).getByRole('button', { name: 'Deprecate' })).toBeInTheDocument();
  });

  it('refuses a bulk deprecate with no reason and says why', async () => {
    const user = userEvent.setup();
    const { calls } = mount();
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select a:one' }));
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(await screen.findByText('Please enter a deprecation reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.includes('bulk/deprecate'))).toBe(false);
  });

  it('sends only the selected names when a reason is given', async () => {
    const user = userEvent.setup();
    const { fn } = mount({
      '/api/events/bulk/deprecate': { body: { deprecated: ['a:one'], notFound: [], total: 1 } },
    });
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select a:one' }));
    await user.type(screen.getByLabelText('Deprecation reason'), 'superseded');
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));

    // The confirmation has to outlive the selection it clears — see the
    // comment in EventList.tsx; this message used to be unmounted in the same
    // commit that set it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Deprecated 1 event(s).'));
    expect(screen.queryByLabelText('Event controls: selection')).not.toBeInTheDocument();
    const call = fn.mock.calls.find(([url]) => String(url).includes('bulk/deprecate'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      names: ['a:one'],
      reason: 'superseded',
    });
  });

  it('surfaces a failed bulk deprecate rather than implying it worked', async () => {
    const user = userEvent.setup();
    mount({ '/api/events/bulk/deprecate': { status: 500, text: 'nope' } });
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select a:one' }));
    await user.type(screen.getByLabelText('Deprecation reason'), 'why not');
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));
    expect(await screen.findByText(/Error: API 500/)).toBeInTheDocument();
  });
});

describe('EventList at full catalog scale, on a token-gated catalog', () => {
  // Derived fixture: the real ~229 declarations from src/declarations, so this
  // is the list an operator actually looks at when they reach for a bulk
  // deprecate — not a two-row toy.
  it('names the auth gate when a bulk deprecate over the real catalog is refused', async () => {
    const user = userEvent.setup();
    const { fn } = mockFetch({
      ...realRoutes,
      '/api/events/bulk/deprecate': { status: 401, text: '{"error":"Unauthorized"}' },
    });
    renderWithRouter(<EventList />);

    const first = realEvents[0]!.name;
    await screen.findByText(first);
    // The read succeeded — all 229 are on screen. Only the write is gated.
    expect(fn.mock.calls.some(([url]) => String(url).startsWith('/api/events'))).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: `Select ${first}` }));
    await user.type(screen.getByLabelText('Deprecation reason'), 'retiring');
    await user.click(screen.getByRole('button', { name: 'Deprecate' }));

    expect(await screen.findByText(/requires an API token/i)).toBeInTheDocument();
    expect(screen.queryByText(/Error: API 401/)).not.toBeInTheDocument();
    // Nothing was deprecated, and the UI must not imply otherwise.
    expect(screen.queryByText(/Deprecated \d+ event/)).not.toBeInTheDocument();
  });
});
