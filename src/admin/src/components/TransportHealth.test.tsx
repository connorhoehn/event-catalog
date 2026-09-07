import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransportHealth } from './TransportHealth';
import { mockFetch, type RouteResponse } from '../test/helpers';

const health = (redis: string, mq: string, extra: Record<string, unknown> = {}) => ({
  status: redis === 'connected' && mq === 'connected' ? 'healthy' : 'degraded',
  redis: { status: redis, latencyMs: 2 },
  messageQueue: { status: mq, latencyMs: 9 },
  uptime: 3725,
  eventCount: 12,
  ...extra,
});

function mount(routes: Record<string, RouteResponse | (() => RouteResponse)> = {}) {
  const table = {
    '/api/health': { body: health('connected', 'connected') },
    '/api/transports/signal/channels': { body: { channels: [], total: 0 } },
    '/api/transports/durable/queues': { body: { queues: [], total: 0 } },
    ...routes,
  };
  const mock = mockFetch(table);
  render(<TransportHealth />);
  return mock;
}

/** The card body for one transport, found by its heading rather than a class. */
function card(headingText: string) {
  return screen.getByRole('heading', { name: headingText }).closest('.transport-card') as HTMLElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('TransportHealth — status vocabulary', () => {
  it('shows a "connected" transport as up, not down', async () => {
    // The regression: the component compared against 'healthy', which
    // /api/health never says, so a working Redis rendered as DOWN.
    mount();
    const redis = await screen.findByRole('heading', { name: /Redis \(Signal Transport\)/ });
    const body = redis.closest('.transport-card')!;
    expect(within(body as HTMLElement).getByText('connected')).toBeInTheDocument();
    expect(body).toHaveClass('healthy');
    expect(body).not.toHaveClass('unhealthy');
  });

  it('shows a disconnected transport as down while the other stays up', async () => {
    mount({ '/api/health': { status: 503, body: health('connected', 'disconnected') } });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    expect(card('Redis (Signal Transport)')).toHaveClass('healthy');
    expect(card('Message Queue (Durable Transport)')).toHaveClass('unhealthy');
    expect(within(card('Message Queue (Durable Transport)')).getByText('disconnected')).toBeInTheDocument();
  });

  it('renders the health card at all when the API answers 503', async () => {
    // A 503 here means "a transport is down", not "the catalog is down". The
    // page must show which one — replacing it with a generic error state
    // hides the only fact the operator needs.
    mount({ '/api/health': { status: 503, body: health('disconnected', 'disconnected') } });
    expect(await screen.findByRole('heading', { name: 'Transport Health' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('disconnected')).toHaveLength(2);
  });

  it('reports a degraded transport as degraded, distinct from both up and down', async () => {
    mount({ '/api/health': { body: health('degraded', 'connected') } });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    expect(within(card('Redis (Signal Transport)')).getByText('degraded')).toBeInTheDocument();
    // Degraded is still not "up" — the dot must not read green.
    expect(card('Redis (Signal Transport)')).toHaveClass('unhealthy');
  });

  it('announces the exact status words for both transports', async () => {
    mount({ '/api/health': { body: health('connected', 'degraded') } });
    await waitFor(() =>
      expect(
        screen.getByText('Transports: signal connected, durable degraded.'),
      ).toBeInTheDocument(),
    );
  });
});

describe('TransportHealth — loading / empty / error tri-state', () => {
  it('shows a busy state before the first response, not an empty one', async () => {
    mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText(/No active signal channels/)).not.toBeInTheDocument();
    // Let the in-flight load settle so the assertions above are about the
    // pre-response frame and not a race.
    await screen.findByRole('heading', { name: 'Transport Health' });
  });

  it('renders an error state — not an empty one — when the first load fails', async () => {
    mount({ '/api/health': { status: 500, text: 'redis exploded' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Error loading transport health/);
    // The lie we are guarding against: a failed fetch reading as "everything
    // is fine, there is just nothing here".
    expect(screen.queryByText(/No active signal channels/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('distinguishes an empty catalog from a failed one', async () => {
    mount();
    expect(await screen.findByText('No active signal channels')).toBeInTheDocument();
    expect(screen.getByText('No active durable queues')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the last good reading when a later poll fails, and says so', async () => {
    let calls = 0;
    mount({
      '/api/health': () => {
        calls += 1;
        return calls === 1 ? { body: health('connected', 'connected') } : { status: 500, text: 'gone' };
      },
    });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Showing the last successful reading/)).toBeInTheDocument();
    // The reading itself survives — blanking the page loses the last thing
    // that was true.
    expect(within(card('Redis (Signal Transport)')).getByText('connected')).toBeInTheDocument();
  });
});

describe('TransportHealth — tables', () => {
  it('lists signal channels with their publish counts', async () => {
    mount({
      '/api/transports/signal/channels': {
        body: {
          channels: [
            { channel: 'call:caption:line', publishCount: 12345, lastPublishedAt: null, subscriberCount: 3 },
          ],
          total: 1,
        },
      },
    });
    const row = (await screen.findByText('call:caption:line')).closest('tr')!;
    expect(within(row).getByText('12,345')).toBeInTheDocument();
    expect(within(row).getByText('never')).toBeInTheDocument();
  });

  it('sums totals across queues', async () => {
    mount({
      '/api/transports/durable/queues': {
        body: {
          queues: [
            { queue: 'a', sent: 1000, received: 900, failed: 0, inFlight: 2 },
            { queue: 'b', sent: 2000, received: 1900, failed: 4, inFlight: 3 },
          ],
          total: 2,
        },
      },
    });
    expect(await screen.findByText('Total sent: 3,000')).toBeInTheDocument();
    expect(screen.getByText('In flight: 5')).toBeInTheDocument();
  });

  it('formats a multi-hour uptime rather than printing raw seconds', async () => {
    mount();
    expect(await screen.findByText('1h 2m 5s')).toBeInTheDocument();
  });
});
