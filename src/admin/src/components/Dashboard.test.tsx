import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from './Dashboard';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';

const event = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  transport: 'signal',
  producer: 'platform-api',
  schema: {},
  subscribers: ['worker'],
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: '2026-09-07T11:00:00.000Z', publishCount: 5, errorCount: 0 },
  stats: { publishCount: 5, publishRate: 0.5, lastPublishedAt: '2026-09-07T11:00:00.000Z', errorCount: 0, subscriberCount: 1 },
  ...over,
});

const health = (redis: string, mq: string) => ({
  status: 'healthy',
  redis: { status: redis },
  messageQueue: { status: mq },
  uptime: 120,
  eventCount: 2,
});

function mount(routes: RouteTable = {}) {
  const mock = mockFetch({
    '/api/events': { body: { events: [event('a:one')], total: 1 } },
    '/api/health': { body: health('connected', 'connected') },
    '/api/health/registry': { status: 404, text: 'no' },
    '/api/events/poisoned': { body: { count: 0, items: [] } },
    ...routes,
  });
  renderWithRouter(<Dashboard />);
  return mock;
}

/** The status row whose label starts with `label`. */
const statusRow = (label: string) =>
  screen.getByText(label, { exact: false }).closest('.status-row') as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard — loading / error tri-state', () => {
  it('keeps the heading and shows a busy state while loading', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Transport Status' })).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Transport Status' });
  });

  it('renders an error state with the heading intact, not zeroed-out stats', async () => {
    // Zeros for "registered events" and "total publishes" on a failed fetch
    // read as a catalog with nothing in it.
    mount({ '/api/events': { status: 500, text: 'registry down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading the dashboard');
    expect(alert).toHaveTextContent('registry down');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText('Registered Events')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Publishes')).not.toBeInTheDocument();
  });

  it('recovers when Retry succeeds', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/api/events': () =>
        failing ? { status: 500, text: 'down' } : { body: { events: [event('a:one')], total: 1 } },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Registered Events')).toBeInTheDocument();
  });

  it('degrades without the optional registry-health card rather than failing', async () => {
    mount();
    await screen.findByText('Registered Events');
    expect(screen.queryByRole('heading', { name: 'Registry Health' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Dashboard — transport status', () => {
  it('shows a connected transport as up', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Transport Status' });
    const row = statusRow('Redis (Signal)');
    expect(within(row).getByText('connected')).toBeInTheDocument();
    expect(row.querySelector('.status-dot')).toHaveClass('green');
  });

  it('shows a disconnected transport as down and still renders on a 503', async () => {
    // /api/health answers 503 when a transport is disconnected. Losing the
    // body to a thrown request meant the dashboard reported "the catalog API
    // did not answer" at exactly the moment the catalog was answering with
    // the diagnosis.
    mount({ '/api/health': { status: 503, body: health('connected', 'disconnected') } });
    await screen.findByRole('heading', { name: 'Transport Status' });
    expect(within(statusRow('Message Queue (Durable)')).getByText('disconnected')).toBeInTheDocument();
    expect(statusRow('Message Queue (Durable)').querySelector('.status-dot')).toHaveClass('red');
    expect(statusRow('Redis (Signal)').querySelector('.status-dot')).toHaveClass('green');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not paint a degraded transport green', async () => {
    mount({ '/api/health': { body: health('degraded', 'connected') } });
    await screen.findByRole('heading', { name: 'Transport Status' });
    expect(statusRow('Redis (Signal)').querySelector('.status-dot')).toHaveClass('red');
    expect(within(statusRow('Redis (Signal)')).getByText('degraded')).toBeInTheDocument();
  });
});

describe('Dashboard — rollups', () => {
  it('counts signal and durable events separately', async () => {
    mount({
      '/api/events': {
        body: {
          events: [event('a', { transport: 'signal' }), event('b', { transport: 'durable' }), event('c', { transport: 'durable' })],
          total: 3,
        },
      },
    });
    await screen.findByText('Registered Events');
    // StatCard draws the label and the value as the card's two children.
    const cardValue = (label: string) =>
      screen.getByText(label).nextElementSibling!.textContent;
    expect(cardValue('Registered Events')).toBe('3');
    expect(cardValue('Signal (Ephemeral)')).toBe('1');
    expect(cardValue('Durable (At-Least-Once)')).toBe('2');
  });

  it('hides the lifecycle row entirely for a clean catalog', async () => {
    mount();
    await screen.findByText('Registered Events');
    expect(screen.queryByText(/Orphans/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Never published/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Deprecated Events' })).not.toBeInTheDocument();
  });

  it('flags orphans, never-published and deprecated events when present', async () => {
    mount({
      '/api/events': {
        body: {
          events: [
            event('orphan', { subscribers: [] }),
            event('never', { metadata: { createdAt: 'x', lastPublishedAt: null, publishCount: 0, errorCount: 0 } }),
            event('old', {
              deprecation: { deprecatedAt: '2026-08-01T00:00:00.000Z', reason: 'superseded by v2' },
            }),
          ],
          total: 3,
        },
      },
    });
    await screen.findByText('Registered Events');
    expect(screen.getByText('Orphans (no subscribers)')).toBeInTheDocument();
    expect(screen.getByText('Never published')).toBeInTheDocument();
    // A deprecated event that still has subscribers is the one worth saying
    // out loud — it is the migration nobody finished.
    expect(screen.getByText('Deprecated (1 still active)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deprecated Events' })).toBeInTheDocument();
    expect(screen.getByText('superseded by v2')).toBeInTheDocument();
  });

  it('lists poisoned events and lets one be dismissed', async () => {
    const user = userEvent.setup();
    mount({
      '/api/events/poisoned': {
        body: {
          count: 1,
          items: [{ eventName: 'a:one', failuresInWindow: 12, poisonedAt: 'x', threshold: 10, windowMs: 300000 }],
        },
      },
      '/api/events/a%3Aone/poison': { body: { cleared: 'a:one', wasPoison: true } },
    });
    expect(await screen.findByText(/1 Poisoned Event/)).toBeInTheDocument();
    expect(screen.getByText(/12 failures in 5m/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss poison alert for a:one' }));
    expect(await screen.findByText('Registered Events')).toBeInTheDocument();
    expect(screen.queryByText(/1 Poisoned Event/)).not.toBeInTheDocument();
  });

  it('shows no poison banner when nothing is poisoned', async () => {
    mount();
    await screen.findByText('Registered Events');
    expect(screen.queryByText(/Poisoned Event/)).not.toBeInTheDocument();
  });
});
