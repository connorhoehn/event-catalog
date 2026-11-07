import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

/**
 * A root-`/health` body (service-runtime shape) whose coordinator check is in
 * the given state. This is a DIFFERENT endpoint from `/admin-api/health` with a
 * different vocabulary, and it is the only place the registry replication
 * state is reported.
 */
const serviceHealth = (coordinator: 'healthy' | 'degraded' | 'unhealthy', details: unknown = { replicaId: '4f2a91c0-aaaa', stale: coordinator !== 'healthy', peers: 2, resyncs: 0, pending: 0, conflicts: 0 }) => ({
  service: 'event-catalog',
  version: '0.6.0',
  status: coordinator === 'healthy' ? 'healthy' : coordinator,
  checks: [
    { id: 'redis', status: 'healthy', durationMs: 1 },
    { id: 'message-queue', status: 'healthy', durationMs: 1 },
    { id: 'registry', status: 'healthy', durationMs: 0, details: { eventCount: 229 } },
    { id: 'coordinator', status: coordinator, durationMs: 0, details },
  ],
  timestamp: new Date().toISOString(),
});

function mount(routes: Record<string, RouteResponse | (() => RouteResponse)> = {}) {
  const table = {
    '/admin-api/health': { body: health('connected', 'connected') },
    '/admin-api/transports/signal/channels': { body: { channels: [], total: 0 } },
    '/admin-api/transports/durable/queues': { body: { queues: [], total: 0 } },
    '/health': { body: serviceHealth('healthy') },
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
    mount({ '/admin-api/health': { status: 503, body: health('connected', 'disconnected') } });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    expect(card('Redis (Signal Transport)')).toHaveClass('healthy');
    expect(card('Message Queue (Durable Transport)')).toHaveClass('unhealthy');
    expect(within(card('Message Queue (Durable Transport)')).getByText('disconnected')).toBeInTheDocument();
  });

  it('renders the health card at all when the API answers 503', async () => {
    // A 503 here means "a transport is down", not "the catalog is down". The
    // page must show which one — replacing it with a generic error state
    // hides the only fact the operator needs.
    mount({ '/admin-api/health': { status: 503, body: health('disconnected', 'disconnected') } });
    expect(await screen.findByRole('heading', { name: 'Transport Health' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('disconnected')).toHaveLength(2);
  });

  it('reports a degraded transport as degraded, distinct from both up and down', async () => {
    mount({ '/admin-api/health': { body: health('degraded', 'connected') } });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    expect(within(card('Redis (Signal Transport)')).getByText('degraded')).toBeInTheDocument();
    // Degraded is still not "up" — the dot must not read green.
    expect(card('Redis (Signal Transport)')).toHaveClass('unhealthy');
  });

  it('announces the exact status words for both transports', async () => {
    mount({ '/admin-api/health': { body: health('connected', 'degraded') } });
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
    mount({ '/admin-api/health': { status: 500, text: 'redis exploded' } });
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
      '/admin-api/health': () => {
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
      '/admin-api/transports/signal/channels': {
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
      '/admin-api/transports/durable/queues': {
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

/** Alias so the coordinator block can still reach the transport-card helper. */
const card2 = card;

/** The replication card, found by its heading rather than by a class name. */
function coordinatorCard() {
  return screen
    .getByRole('heading', { name: 'Registry Coordinator (Replication)' })
    .closest('.transport-card') as HTMLElement;
}

describe('TransportHealth — registry coordinator (replication)', () => {
  it('renders the replication state alongside the two transports', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const found = coordinatorCard();
    expect(within(found).getByText('healthy')).toBeInTheDocument();
    expect(within(found).getByText(/applied every registry mutation/i)).toBeInTheDocument();
    expect(within(found).getByText('in sync')).toBeInTheDocument();
  });

  it('places the coordinator ABOVE the transports', async () => {
    // A stale replica is worse than a slow Redis and must not be the third
    // card an operator scrolls to: the transports reading "connected" is
    // exactly what makes a divergent registry invisible everywhere else.
    mount({ '/health': { body: serviceHealth('degraded') } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings.indexOf('Registry Coordinator (Replication)'))
      .toBeLessThan(headings.indexOf('Redis (Signal Transport)'));
  });

  it('says a stale replica may be serving contracts its peers do not have', async () => {
    mount({ '/health': { body: serviceHealth('degraded') } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    expect(within(card).getByText('degraded')).toBeInTheDocument();
    expect(within(card).getByText(/STALE REPLICA/)).toBeInTheDocument();
    expect(within(card).getByText(/missing or out of date/i)).toBeInTheDocument();
    // …while both transports read connected, which is exactly what makes a
    // divergent registry invisible everywhere else in this UI.
    expect(card2('Redis (Signal Transport)')).toHaveClass('healthy');
    expect(card2('Message Queue (Durable Transport)')).toHaveClass('healthy');
  });

  it('gives degraded three cues that are not colour, per the deprecated-bundle rule', async () => {
    mount({ '/health': { body: serviceHealth('degraded') } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    // 1. the server's word, in a chip
    expect(within(card).getByText('degraded')).toBeInTheDocument();
    // 2. a plain-English restatement of what that word means here
    expect(within(card).getByText('stale replica')).toBeInTheDocument();
    // 3. a glyph that differs in SHAPE, carried on a class the stylesheet
    //    also uses for a dashed left rule
    expect(card.querySelector('.coordinator-dot.degraded')?.textContent).toBe('\u25b2');
    expect(card).toHaveClass('degraded');
  });

  it('makes degraded visually distinct from unhealthy, not one rung milder', async () => {
    mount({ '/health': { body: serviceHealth('degraded') } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const degradedGlyph = coordinatorCard().querySelector('.coordinator-dot')?.textContent;
    const degradedWord = within(coordinatorCard()).getByText('stale replica').textContent;
    const degradedExplanation = coordinatorCard().querySelector('.coordinator-explanation')?.textContent;
    cleanup();
    vi.unstubAllGlobals();

    mount({ '/health': { body: serviceHealth('unhealthy') } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    expect(card).toHaveClass('unhealthy');
    expect(card).not.toHaveClass('degraded');
    expect(card.querySelector('.coordinator-dot')?.textContent).not.toBe(degradedGlyph);
    expect(within(card).getByText('replication down').textContent).not.toBe(degradedWord);
    expect(card.querySelector('.coordinator-explanation')?.textContent).not.toBe(degradedExplanation);
  });

  it('shows the replica id and the counters the server reported', async () => {
    mount({ '/health': { body: serviceHealth('degraded', { replicaId: '4f2a91c0-dead-beef', stale: true, peers: 3, resyncs: 7, pending: 12, conflicts: 1 }) } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    expect(within(card).getByText('4f2a91c0-dea')).toBeInTheDocument();
    expect(within(card).getByText('Peers tracked: 3')).toBeInTheDocument();
    expect(within(card).getByText('Resyncs: 7')).toBeInTheDocument();
    expect(within(card).getByText('Pending mutations: 12')).toBeInTheDocument();
    expect(within(card).getByText('Replication conflicts: 1')).toBeInTheDocument();
  });

  it('omits a counter the server did not report rather than printing a zero', async () => {
    // A missing `conflicts` rendered as "0" would tell an operator the
    // replicas agree, which is not what an absent field means.
    mount({ '/health': { body: serviceHealth('healthy', { replicaId: 'abc', peers: 1 }) } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    expect(within(card).getByText('Peers tracked: 1')).toBeInTheDocument();
    expect(within(card).queryByText(/Replication conflicts/)).not.toBeInTheDocument();
  });

  it('says "not reported" — never healthy — when the root route is unreachable', async () => {
    mount({ '/health': { status: 404, text: 'not found' } });
    await screen.findByRole('heading', { name: 'Registry Coordinator (Replication)' });
    const card = coordinatorCard();
    expect(within(card).getByText('not reported')).toBeInTheDocument();
    expect(within(card).getByText(/is unknown/i)).toBeInTheDocument();
    expect(card).not.toHaveClass('healthy');
  });

  it('keeps the transports rendered when the coordinator read fails outright', async () => {
    // Different endpoint, different failure domain. A proxy that 500s /health
    // must not take the transports view down with it.
    mount({ '/health': { networkError: 'Failed to fetch' } });
    await screen.findByRole('heading', { name: 'Redis (Signal Transport)' });
    expect(card('Redis (Signal Transport)')).toHaveClass('healthy');
    expect(within(coordinatorCard()).getByText('not reported')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces the replication state separately from the transports', async () => {
    mount({ '/health': { body: serviceHealth('degraded') } });
    await waitFor(() =>
      expect(screen.getByText('Registry replication: degraded.')).toBeInTheDocument(),
    );
    // Still its own sentence — folding it into the transports line would
    // re-announce two healthy transports every time replication moved.
    expect(screen.getByText('Transports: signal connected, durable connected.')).toBeInTheDocument();
  });
});
