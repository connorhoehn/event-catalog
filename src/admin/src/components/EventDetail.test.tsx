// /events/:name — the single-event page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { EventDetail } from './EventDetail';
import { mockFetch, type RouteTable } from '../test/helpers';

const NAME = 'call:caption:line';
const ENCODED = 'call%3Acaption%3Aline';

const entry = (over: Record<string, unknown> = {}) => ({
  name: NAME,
  namespace: 'call',
  transport: 'signal',
  producer: 'platform-api',
  description: 'One caption line as it is transcribed.',
  schema: { type: 'object', properties: { text: { type: 'string' } } },
  schemaFingerprint: 'a'.repeat(64),
  version: 3,
  subscribers: ['transcription-worker'],
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: null, publishCount: 12, errorCount: 0 },
  stats: { publishCount: 12, publishRate: 1.25, lastPublishedAt: null, errorCount: 0, subscriberCount: 1 },
  ...over,
});

const DEFAULTS: RouteTable = {
  [`/admin-api/events/${ENCODED}/history`]: { body: { messages: [], transport: 'signal' } },
  [`/admin-api/events/${ENCODED}/producers/observed`]: {
    body: { eventName: NAME, declared: ['platform-api'], observed: [], undeclaredProducers: [], deadDeclaredProducers: [], mismatch: false },
  },
  [`/admin-api/events/${ENCODED}/stats`]: { body: entry().stats },
  [`/admin-api/events/${ENCODED}`]: { body: entry() },
};

function mount(routes: RouteTable = {}) {
  const mock = mockFetch({ ...DEFAULTS, ...routes });
  render(
    <MemoryRouter initialEntries={[`/events/${ENCODED}`]}>
      <Routes>
        <Route path="/events/:name" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  return mock;
}

const section = (heading: string | RegExp) =>
  screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EventDetail — loading / error tri-state', () => {
  it('shows a busy skeleton before the event arrives', async () => {
    mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    await screen.findByRole('heading', { name: NAME });
  });

  it('renders an error with a way back, not a blank page', async () => {
    mount({ [`/admin-api/events/${ENCODED}`]: { status: 404, text: 'not declared' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading this event');
    expect(alert).toHaveTextContent('not declared');
    expect(within(alert).getByRole('link', { name: 'Back to all events' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Schema' })).not.toBeInTheDocument();
  });

  it('decodes the event name before asking for it', async () => {
    const { calls } = mount();
    await screen.findByRole('heading', { name: NAME });
    expect(calls).toContain(`/admin-api/events/${ENCODED}`);
  });
});

describe('EventDetail — a failing /history must not take down the page', () => {
  it('still renders the declaration when the transport cannot serve history', async () => {
    // The bug: `/history` reads through Redis / the message queue, so it 500s
    // exactly when a transport is sick — and it shared the page's
    // `Promise.all` rejection path. A sick transport therefore replaced the
    // schema, the fingerprint, the subscribers and the producer list — none
    // of which depend on the transport — with "Error loading this event".
    mount({ [`/admin-api/events/${ENCODED}/history`]: { status: 500, text: 'redis down' } });
    expect(await screen.findByRole('heading', { name: NAME })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schema' })).toBeInTheDocument();
    expect(screen.getByText('transcription-worker')).toBeInTheDocument();
  });

  it('reports the history failure inside the Recent Messages section', async () => {
    mount({ [`/admin-api/events/${ENCODED}/history`]: { status: 500, text: 'redis down' } });
    await screen.findByRole('heading', { name: NAME });
    const messages = section(/Recent Messages/);
    expect(within(messages).getByRole('alert')).toHaveTextContent("Couldn't load recent messages");
    expect(within(messages).getByRole('alert')).toHaveTextContent('redis down');
    // "No recent messages captured" would read as a quiet event, not a broken
    // transport.
    expect(within(messages).queryByText('No recent messages captured.')).not.toBeInTheDocument();
  });

  it('says "none captured" when history genuinely comes back empty', async () => {
    mount();
    await screen.findByRole('heading', { name: NAME });
    const messages = section(/Recent Messages/);
    expect(within(messages).getByText('No recent messages captured.')).toBeInTheDocument();
    expect(within(messages).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('degrades quietly when the observed-producer endpoint is missing', async () => {
    // An older server has no /producers/observed at all.
    mount({ [`/admin-api/events/${ENCODED}/producers/observed`]: { status: 404, text: 'nope' } });
    expect(await screen.findByRole('heading', { name: NAME })).toBeInTheDocument();
    expect(screen.queryByText('Observed Producers')).not.toBeInTheDocument();
  });
});

describe('EventDetail — the header', () => {
  it('shows transport, namespace, version and fingerprint', async () => {
    mount();
    await screen.findByRole('heading', { name: NAME });
    expect(screen.getByText('signal')).toBeInTheDocument();
    expect(screen.getByText('call')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
  });

  it('marks a deprecated event and explains why', async () => {
    mount({
      [`/admin-api/events/${ENCODED}`]: {
        body: entry({
          deprecation: { deprecatedAt: '2026-08-01T00:00:00.000Z', reason: 'superseded by v2', by: 'connor' },
        }),
      },
    });
    await screen.findByRole('heading', { name: NAME });
    expect(screen.getByText('deprecated')).toBeInTheDocument();
    expect(screen.getByText('superseded by v2')).toBeInTheDocument();
    expect(screen.getByText(/by connor/)).toBeInTheDocument();
  });

  it('flags a producer mismatch', async () => {
    mount({
      [`/admin-api/events/${ENCODED}/producers/observed`]: {
        body: {
          eventName: NAME,
          declared: ['platform-api'],
          observed: ['platform-api', 'rogue-service'],
          undeclaredProducers: ['rogue-service'],
          deadDeclaredProducers: [],
          mismatch: true,
        },
      },
    });
    await screen.findByRole('heading', { name: NAME });
    expect(screen.getByText('producer mismatch')).toBeInTheDocument();
    expect(screen.getByText('Observed Producers')).toBeInTheDocument();
    expect(screen.getByText('rogue-service')).toBeInTheDocument();
  });

  it('breadcrumbs back to the event list and marks the current page', async () => {
    mount();
    await screen.findByRole('heading', { name: NAME });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    expect(within(nav).getByText(NAME)).toHaveAttribute('aria-current', 'page');
  });
});

describe('EventDetail — live metrics', () => {
  it('renders the stats that came with the event', async () => {
    mount();
    await screen.findByRole('heading', { name: NAME });
    expect(screen.getByText('1.25/s')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('repolls stats and shows the new numbers', async () => {
    let rate = 1.25;
    mount({ [`/admin-api/events/${ENCODED}/stats`]: () => ({ body: { ...entry().stats, publishRate: rate } }) });
    await screen.findByText('1.25/s');
    rate = 9.5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(screen.getByText('9.50/s')).toBeInTheDocument());
  });

  it('keeps the last known numbers when a stats poll fails', async () => {
    // A single failed poll must not zero out the metrics — zeros read as "the
    // event stopped", which is a page-someone conclusion.
    let failing = false;
    mount({
      [`/admin-api/events/${ENCODED}/stats`]: () =>
        failing ? { status: 500, text: 'x' } : { body: entry().stats },
    });
    await screen.findByText('1.25/s');
    failing = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText('1.25/s')).toBeInTheDocument();
  });

  it('shows placeholders rather than zeros when there are no stats at all', async () => {
    mount({
      [`/admin-api/events/${ENCODED}`]: { body: entry({ stats: null }) },
      [`/admin-api/events/${ENCODED}/stats`]: { status: 404, text: 'no stats' },
    });
    await screen.findByRole('heading', { name: NAME });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });
});

describe('EventDetail — schema and history', () => {
  it('renders the current schema', async () => {
    mount();
    await screen.findByRole('heading', { name: NAME });
    expect(within(section('Schema')).getByText(/"properties"/)).toBeInTheDocument();
  });

  it('lists each historical version with a diff toggle', async () => {
    mount({
      [`/admin-api/events/${ENCODED}`]: {
        body: entry({
          schemaHistory: [
            { version: 1, schema: { type: 'object' }, fingerprint: 'b'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' },
            { version: 2, schema: { type: 'object' }, fingerprint: 'c'.repeat(64), updatedAt: '2026-02-01T00:00:00.000Z' },
          ],
        }),
      },
    });
    await screen.findByRole('heading', { name: 'Schema History (2)' });
    expect(screen.getAllByRole('button', { name: /diff/i })).toHaveLength(2);
  });

  it('renders recent messages as expandable entries, newest numbered highest', async () => {
    mount({
      [`/admin-api/events/${ENCODED}/history`]: {
        body: { messages: [{ payload: { a: 1 } }, { payload: { b: 2 } }], transport: 'signal' },
      },
    });
    await screen.findByRole('heading', { name: 'Recent Messages (2)' });
    const messages = section(/Recent Messages/);
    expect(within(messages).getByText('Message #2')).toBeInTheDocument();
    expect(within(messages).getByText('Message #1')).toBeInTheDocument();
  });
});
