// /live — pick events, tail their messages.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveInspector } from './LiveInspector';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';

const event = (name: string, transport: 'signal' | 'durable') => ({
  name,
  transport,
  producer: 'platform-api',
  schema: {},
  subscribers: [],
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
  stats: null,
});

const EVENTS = {
  events: [event('call:caption:line', 'signal'), event('pipeline:step:started', 'durable')],
  total: 2,
};

const stats = (rate: number) => ({
  publishCount: 10,
  publishRate: rate,
  lastPublishedAt: null,
  errorCount: 0,
  subscriberCount: 1,
});

function mount(routes: RouteTable = {}) {
  const mock = mockFetch({
    '/api/events': { body: EVENTS },
    '/api/metrics': { body: { 'call:caption:line': stats(2.5) } },
    ...routes,
  });
  renderWithRouter(<LiveInspector />);
  return mock;
}

/** Run the 1s poll `times` times, flushing the awaits it does inside. */
async function poll(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe('LiveInspector — loading / empty / error tri-state for the pickers', () => {
  it('shows a busy state instead of "no events registered" while loading', async () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading events…');
    expect(screen.queryByText('No signal events registered')).not.toBeInTheDocument();
    await screen.findByLabelText('call:caption:line');
  });

  it('reports a failed event list rather than rendering two empty pickers', async () => {
    // This was `.catch(() => {})`: a registry that was down looked exactly
    // like a registry with nothing in it.
    mount({ '/api/events': { status: 500, text: 'registry down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading the event list');
    expect(alert).toHaveTextContent('registry down');
    expect(screen.queryByText('No signal events registered')).not.toBeInTheDocument();
    expect(screen.queryByText('No durable events registered')).not.toBeInTheDocument();
  });

  it('says which picker is empty when the catalog really has nothing of that kind', async () => {
    mount({ '/api/events': { body: { events: [event('a:one', 'signal')], total: 1 } } });
    expect(await screen.findByText('No durable events registered')).toBeInTheDocument();
    expect(screen.queryByText('No signal events registered')).not.toBeInTheDocument();
  });

  it('sorts each event into the picker for its transport', async () => {
    mount();
    await screen.findByLabelText('call:caption:line');
    const signalGroup = screen.getByRole('group', { name: 'Signal Events (Ephemeral)' });
    expect(within(signalGroup).getByLabelText('call:caption:line')).toBeInTheDocument();
    expect(within(signalGroup).queryByLabelText('pipeline:step:started')).not.toBeInTheDocument();
  });
});

describe('LiveInspector — the message stream', () => {
  it('asks the operator to pick something before it polls anything', async () => {
    const { fn } = mount();
    await screen.findByLabelText('call:caption:line');
    expect(screen.getByText('Select events to inspect')).toBeInTheDocument();
    await poll(2);
    expect(fn.mock.calls.some(([u]) => String(u).includes('/history'))).toBe(false);
  });

  it('tails the selected event and renders its payload', async () => {
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': {
        body: { messages: [{ text: 'hello world' }], transport: 'signal' },
      },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
    expect(screen.getByText('1 messages')).toBeInTheDocument();
  });

  it('does NOT re-append the same history page on every poll', async () => {
    // The bug: `/history` returns the last N messages, not the ones since the
    // last poll, so re-polling it re-appended the SAME rows every second. The
    // stream filled with duplicates of one message and the counter climbed on
    // a completely idle catalog — the pane's only job is showing what is
    // actually flowing.
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': {
        body: { messages: [{ seq: 1 }, { seq: 2 }], transport: 'signal' },
      },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll(4);
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('appends only what is genuinely new', async () => {
    const user = setup();
    let page = [{ seq: 1 }];
    mount({
      '/api/events/call%3Acaption%3Aline/history': () => ({
        body: { messages: page, transport: 'signal' },
      }),
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    page = [{ seq: 1 }, { seq: 2 }];
    await poll();
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('stops polling while paused and resumes afterwards', async () => {
    const user = setup();
    let page: Array<{ seq: number }> = [{ seq: 1 }];
    mount({
      '/api/events/call%3Acaption%3Aline/history': () => ({
        body: { messages: page, transport: 'signal' },
      }),
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    page = [{ seq: 1 }, { seq: 2 }];
    await poll(3);
    expect(screen.getByText('1 messages')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await poll();
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('empties the pane on Clear', async () => {
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': {
        body: { messages: [{ seq: 1 }], transport: 'signal' },
      },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 messages')).toBeInTheDocument();
  });

  it('names what it is watching', async () => {
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': { body: { messages: [], transport: 'signal' } },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    expect(screen.getByRole('status')).toHaveTextContent('Watching: call:caption:line');
  });

  it('keeps the pane alive when a poll fails mid-stream', async () => {
    const user = setup();
    let failing = false;
    mount({
      '/api/events/call%3Acaption%3Aline/history': () =>
        failing ? { status: 500, text: 'gone' } : { body: { messages: [{ seq: 1 }], transport: 'signal' } },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    failing = true;
    await poll(2);
    expect(screen.getByText('1 messages')).toBeInTheDocument();
  });

  it('re-shows an event history after it is deselected and picked again', async () => {
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': {
        body: { messages: [{ seq: 1 }], transport: 'signal' },
      },
    });
    const box = await screen.findByLabelText('call:caption:line');
    await user.click(box);
    await poll();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(box);
    await poll();
    expect(screen.getByText('1 messages')).toBeInTheDocument();
  });
});

describe('LiveInspector — live publish rates', () => {
  it('annotates a selected event with its publish rate', async () => {
    const user = setup();
    mount({
      '/api/events/call%3Acaption%3Aline/history': { body: { messages: [], transport: 'signal' } },
    });
    await user.click(await screen.findByLabelText('call:caption:line'));
    await poll();
    await waitFor(() => expect(screen.getByText('2.5/s')).toBeInTheDocument());
  });
});
