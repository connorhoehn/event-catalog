// /subscribers — heartbeat freshness. The whole point of the view is telling
// a live consumer from a dead one, so the freshness buckets are what's tested.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubscribersView } from './SubscribersView';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const agoSeconds = (s: number) => new Date(NOW - s * 1000).toISOString();

const sub = (serviceName: string, ageSeconds: number, eventName = 'call:caption:line') => ({
  eventName,
  serviceName,
  lastSeenAt: agoSeconds(ageSeconds),
});

/** One of each bucket: fresh (<5m), aging (5–30m), stale (>30m). */
const MIXED = {
  subscribers: [
    sub('transcription-worker', 30),
    sub('summary-worker', 12 * 60),
    sub('ghost-worker', 90 * 60),
  ],
  total: 3,
};

function mount(routes: RouteTable = { '/api/subscribers': { body: MIXED } }) {
  const mock = mockFetch(routes);
  renderWithRouter(<SubscribersView />);
  return mock;
}

/** Data rows only — the header row has no `cell`s. */
const bodyRows = () => screen.queryAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0);
const serviceNames = () =>
  bodyRows().map((r) => within(r).getAllByRole('cell')[2]!.textContent);

beforeEach(() => {
  // Ages are computed from `Date.now()`, so the clock is pinned — otherwise
  // "fresh" is a race against however long the suite takes. `shouldAdvanceTime`
  // keeps userEvent's internal waits working.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SubscribersView — loading / empty / error tri-state', () => {
  it('shows a busy state rather than "no subscribers" while loading', async () => {
    // The bug: `rows` starts empty, so a request in flight rendered as "No
    // consumers have registered yet" — a conclusion an operator acts on.
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading subscribers…');
    expect(screen.queryByText('No subscribers in this view')).not.toBeInTheDocument();
    await screen.findByText('transcription-worker');
  });

  it('renders an error, not an empty table, on a 500', async () => {
    mount({ '/api/subscribers': { status: 500, text: 'redis down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading subscribers');
    expect(alert).toHaveTextContent('redis down');
    expect(screen.queryByText('No subscribers in this view')).not.toBeInTheDocument();
  });

  it('recovers on Retry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let failing = true;
    mount({ '/api/subscribers': () => (failing ? { status: 500, text: 'x' } : { body: MIXED }) });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('transcription-worker')).toBeInTheDocument();
  });

  it('distinguishes a registry with no consumers from a broken one', async () => {
    mount({ '/api/subscribers': { body: { subscribers: [], total: 0 } } });
    expect(await screen.findByText('No subscribers in this view')).toBeInTheDocument();
    expect(screen.getByText(/catalog\.subscribe/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('SubscribersView — freshness', () => {
  it('buckets each subscriber by heartbeat age', async () => {
    mount();
    await screen.findByText('transcription-worker');
    // Scoped to the table: "fresh" and "stale" are also filter-button labels.
    const status = (service: string) =>
      within(bodyRows().find((r) => r.textContent?.includes(service))!)
        .getAllByRole('cell')[0]!.textContent;
    expect(status('transcription-worker')).toBe('fresh');
    expect(status('summary-worker')).toBe('aging');
    expect(status('ghost-worker')).toBe('stale');
  });

  it('counts each bucket in the toolbar', async () => {
    mount();
    await screen.findByText('transcription-worker');
    expect(screen.getByText('1 fresh')).toBeInTheDocument();
    expect(screen.getByText('1 aging')).toBeInTheDocument();
    expect(screen.getByText('1 stale')).toBeInTheDocument();
  });

  it('formats the age in the largest sensible unit', async () => {
    mount({
      '/api/subscribers': {
        body: {
          subscribers: [sub('s', 45), sub('m', 5 * 60), sub('h', 3 * 3600), sub('d', 2 * 86400)],
          total: 4,
        },
      },
    });
    await screen.findByText('45s');
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('3h')).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('never shows a negative age for a clock-skewed future heartbeat', async () => {
    mount({
      '/api/subscribers': {
        body: { subscribers: [sub('future-worker', -120)], total: 1 },
      },
    });
    expect(await screen.findByText('0s')).toBeInTheDocument();
  });
});

describe('SubscribersView — the freshness filter', () => {
  it('shows every subscriber under "all"', async () => {
    mount();
    await screen.findByText('transcription-worker');
    expect(serviceNames()).toEqual(['transcription-worker', 'summary-worker', 'ghost-worker']);
  });

  it('shows only fresh consumers under "fresh"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    await screen.findByText('transcription-worker');
    await user.click(screen.getByRole('button', { name: 'fresh' }));
    expect(serviceNames()).toEqual(['transcription-worker']);
  });

  it('shows ONLY stale consumers under "stale" — not everything that is merely aging', async () => {
    // The bug: the stale filter was `age > FRESH_THRESHOLD`, i.e. "not
    // fresh", so it also listed every aging row. The chip said "1 stale" and
    // the table under it showed two — an operator chasing dead consumers was
    // handed a live one.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    await screen.findByText('transcription-worker');
    await user.click(screen.getByRole('button', { name: 'stale' }));
    expect(serviceNames()).toEqual(['ghost-worker']);
  });

  it('agrees with the count chip it sits next to', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount({
      '/api/subscribers': {
        body: {
          subscribers: [sub('a', 40 * 60), sub('b', 10 * 60), sub('c', 11 * 60), sub('d', 20)],
          total: 4,
        },
      },
    });
    await screen.findByText('1 stale');
    await user.click(screen.getByRole('button', { name: 'stale' }));
    expect(bodyRows()).toHaveLength(1);
  });

  it('says the FILTER is empty, not the registry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount({ '/api/subscribers': { body: { subscribers: [sub('live', 10)], total: 1 } } });
    await screen.findByText('live');
    await user.click(screen.getByRole('button', { name: 'stale' }));
    expect(screen.getByText('No stale subscribers — try a different filter.')).toBeInTheDocument();
  });

  it('tells a screen reader which filter is active', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    await screen.findByText('transcription-worker');
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'fresh' }));
    expect(screen.getByRole('button', { name: 'fresh' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SubscribersView — the table', () => {
  it('links each row to the event the consumer subscribed to', async () => {
    mount();
    const link = await screen.findAllByRole('link', { name: 'call:caption:line' });
    expect(link[0]).toHaveAttribute('href', '/events/call%3Acaption%3Aline');
  });

  it('gives every column a scoped header', async () => {
    mount();
    await screen.findByText('transcription-worker');
    for (const name of ['Status', 'Event', 'Service', 'Last seen', 'Age']) {
      expect(screen.getByRole('columnheader', { name })).toHaveAttribute('scope', 'col');
    }
  });

  it('keeps both rows when one service subscribes to two events', async () => {
    // Rows are keyed on the pair, not the service — collapsing them would
    // hide a subscription.
    mount({
      '/api/subscribers': {
        body: {
          subscribers: [sub('worker', 10, 'a:one'), sub('worker', 10, 'a:two')],
          total: 2,
        },
      },
    });
    await screen.findByRole('link', { name: 'a:one' });
    expect(bodyRows()).toHaveLength(2);
  });
});
