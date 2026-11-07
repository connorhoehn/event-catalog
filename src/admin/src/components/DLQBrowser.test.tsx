import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DLQBrowser } from './DLQBrowser';
import { mockFetch, type RouteTable } from '../test/helpers';

const entry = (id: string, eventName: string, over: Record<string, unknown> = {}) => ({
  id,
  eventName,
  payload: { hello: 'world' },
  error: 'handler threw',
  attempts: 3,
  deadAt: '2026-09-07T10:00:00.000Z',
  ...over,
});

const DLQ = '/admin-api/transports/durable/dlq';

function mount(routes: RouteTable = {}) {
  const mock = mockFetch({
    [DLQ]: { body: { messages: [entry('1', 'a:one'), entry('2', 'b:two')], total: 2 } },
    ...routes,
  });
  render(<DLQBrowser />);
  return mock;
}

const rowFor = (eventName: string) => screen.getByText(eventName).closest('tr') as HTMLElement;
const dataRows = () =>
  within(screen.getByRole('table')).getAllByRole('row').slice(1);

afterEach(() => vi.unstubAllGlobals());

describe('DLQBrowser — loading / empty / error tri-state', () => {
  it('shows a busy state first, not "no dead letters"', async () => {
    mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('No dead-lettered messages')).not.toBeInTheDocument();
    await screen.findByRole('table');
  });

  it('says the queue is empty only when the server actually said so', async () => {
    mount({ [DLQ]: { body: { messages: [], total: 0 } } });
    expect(await screen.findByText('No dead-lettered messages')).toBeInTheDocument();
    expect(screen.getByText('All durable events delivered successfully.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a 500 as an error, never as an empty queue', async () => {
    // "No dead-lettered messages" on a failed fetch is a lie an operator acts
    // on — they close the tab believing nothing is stuck.
    mount({ [DLQ]: { status: 500, text: 'sqs unavailable' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading the dead-letter queue');
    expect(alert).toHaveTextContent('sqs unavailable');
    expect(screen.queryByText('No dead-lettered messages')).not.toBeInTheDocument();
  });

  it('does not leave a stale table under the error banner', async () => {
    // The table is the answer to "what is stuck right now". Once the fetch
    // that would have refreshed it has failed, showing the previous rows with
    // no caveat presents old data as current.
    let ok = true;
    mount({
      [DLQ]: () => (ok ? { body: { messages: [entry('1', 'a:one')], total: 1 } } : { status: 500, text: 'gone' }),
    });
    await screen.findByText('a:one');
    ok = false;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('a:one')).not.toBeInTheDocument();
    // …and the header stops counting rows it can no longer vouch for.
    expect(screen.getByText('unavailable')).toBeInTheDocument();
    expect(screen.queryByText('1 entries')).not.toBeInTheDocument();
  });

  it('flags the in-memory fallback so the list is not mistaken for the real queue', async () => {
    mount({ [DLQ]: { body: { messages: [], total: 0, source: 'in-memory' } } });
    expect(await screen.findByText('in-memory fallback')).toBeInTheDocument();
  });
});

describe('DLQBrowser — filtering', () => {
  it('asks the server for the filtered set rather than filtering locally', async () => {
    const user = userEvent.setup();
    const { calls } = mount();
    await screen.findByText('a:one');
    await user.type(screen.getByLabelText('Event name'), 'a:one');
    await waitFor(() => expect(calls.at(-1)).toContain('eventName=a%3Aone'));
  });

  it('says which filter came up empty, not just that the queue is empty', async () => {
    const user = userEvent.setup();
    let filtered = false;
    mount({
      [DLQ]: () =>
        filtered
          ? { body: { messages: [], total: 0 } }
          : { body: { messages: [entry('1', 'a:one')], total: 1 } },
    });
    await screen.findByText('a:one');
    filtered = true;
    await user.type(screen.getByLabelText('Event name'), 'zzz');
    expect(await screen.findByText('No DLQ entries for "zzz".')).toBeInTheDocument();
  });
});

describe('DLQBrowser — selection', () => {
  it('starts with nothing selected and the batch action disabled', async () => {
    mount();
    await screen.findByText('a:one');
    const replaySelected = screen.getByRole('button', { name: 'Replay selected (0)' });
    expect(replaySelected).toBeDisabled();
  });

  it('counts individual selections', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select a:one' }));
    expect(screen.getByRole('button', { name: 'Replay selected (1)' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select b:two' }));
    expect(screen.getByRole('button', { name: 'Replay selected (2)' })).toBeInTheDocument();
  });

  it('deselects on a second click', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('a:one');
    const box = screen.getByRole('checkbox', { name: 'Select a:one' });
    await user.click(box);
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Replay selected (0)' })).toBeDisabled();
  });

  it('select-all toggles every row and back', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('a:one');
    const all = screen.getByRole('checkbox', { name: 'Select all' });
    await user.click(all);
    expect(screen.getByRole('button', { name: 'Replay selected (2)' })).toBeInTheDocument();
    expect(all).toBeChecked();
    await user.click(all);
    expect(screen.getByRole('button', { name: 'Replay selected (0)' })).toBeInTheDocument();
  });

  it('drops selections for rows that are gone after a refresh', async () => {
    // Otherwise "Replay selected (2)" would send ids the queue no longer has.
    const user = userEvent.setup();
    let first = true;
    mount({
      [DLQ]: () => {
        const messages = first ? [entry('1', 'a:one'), entry('2', 'b:two')] : [entry('2', 'b:two')];
        first = false;
        return { body: { messages, total: messages.length } };
      },
    });
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Replay selected (2)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText('a:one')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Replay selected (1)' })).toBeInTheDocument();
  });
});

describe('DLQBrowser — acting on entries', () => {
  it('replays exactly the row whose button was pressed', async () => {
    const user = userEvent.setup();
    const { calls } = mount({ [`${DLQ}/2/replay`]: { body: { replayed: '2', eventName: 'b:two' } } });
    await screen.findByText('b:two');
    await user.click(within(rowFor('b:two')).getByRole('button', { name: 'Replay b:two' }));
    await waitFor(() => expect(calls.some((c) => c.includes('/dlq/2/replay'))).toBe(true));
    expect(calls.some((c) => c.includes('/dlq/1/replay'))).toBe(false);
  });

  it('reloads the list after a replay so the row disappears', async () => {
    const user = userEvent.setup();
    let replayed = false;
    mount({
      [DLQ]: () => ({
        body: {
          messages: replayed ? [entry('2', 'b:two')] : [entry('1', 'a:one'), entry('2', 'b:two')],
          total: replayed ? 1 : 2,
        },
      }),
      [`${DLQ}/1/replay`]: () => {
        replayed = true;
        return { body: { replayed: '1', eventName: 'a:one' } };
      },
    });
    await screen.findByText('a:one');
    await user.click(within(rowFor('a:one')).getByRole('button', { name: 'Replay a:one' }));
    await waitFor(() => expect(screen.queryByText('a:one')).not.toBeInTheDocument());
    expect(dataRows()).toHaveLength(1);
  });

  it('deletes only the targeted entry', async () => {
    const user = userEvent.setup();
    const { calls } = mount({ [`${DLQ}/1`]: { body: { removed: '1' } } });
    await screen.findByText('a:one');
    await user.click(
      within(rowFor('a:one')).getByRole('button', { name: 'Delete dead letter for a:one' }),
    );
    await waitFor(() => expect(calls.some((c) => c.endsWith('/dlq/1'))).toBe(true));
  });

  it('reports a partial batch honestly instead of claiming success', async () => {
    const user = userEvent.setup();
    mount({
      [`${DLQ}/replay`]: {
        body: {
          replayed: [{ id: '1', eventName: 'a:one' }],
          failed: [{ id: '2', error: 'still poisoned' }],
          total: 2,
        },
      },
    });
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Replay selected (2)' }));
    expect(await screen.findByText('Replayed 1 of 2; 1 failed.')).toBeInTheDocument();
  });

  it('confirms a fully successful batch and clears the selection', async () => {
    const user = userEvent.setup();
    mount({
      [`${DLQ}/replay`]: {
        body: {
          replayed: [{ id: '1', eventName: 'a:one' }, { id: '2', eventName: 'b:two' }],
          failed: [],
          total: 2,
        },
      },
    });
    await screen.findByText('a:one');
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Replay selected (2)' }));
    expect(await screen.findByText('Replayed 2 of 2 entries.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay selected (0)' })).toBeDisabled();
  });

  it('keeps the table when an action fails — the list is still the truth', async () => {
    // A failed replay means one row did not move. It does not mean the table
    // is wrong, so it must not replace the table with an error state.
    const user = userEvent.setup();
    mount({ [`${DLQ}/1/replay`]: { status: 500, text: 'queue is full' } });
    await screen.findByText('a:one');
    await user.click(within(rowFor('a:one')).getByRole('button', { name: 'Replay a:one' }));
    expect(await screen.findByText(/queue is full/)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(dataRows()).toHaveLength(2);
  });
});

describe('DLQBrowser — a catalog with EVENT_CATALOG_AUTH_TOKEN set', () => {
  // Auth gates non-GET only (src/server/auth.ts `requiresAuth`), so the DLQ
  // loads perfectly and then every button on it is dead. The failure has to
  // say which of those two things happened.
  const authFail = { status: 401, text: '{"error":"Unauthorized"}' };

  it('explains a refused single-row replay instead of showing "API 401"', async () => {
    const user = userEvent.setup();
    mount({ [`${DLQ}/2/replay`]: authFail });
    await screen.findByRole('table');
    await user.click(within(rowFor('b:two')).getByRole('button', { name: 'Replay b:two' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/requires an API token/i);
    expect(alert).not.toHaveTextContent(/^Error: API 401/);
    // The table is still the truth — auth did not break the read.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(rowFor('b:two')).toBeInTheDocument();
  });

  it('explains a refused batch redrive the same way', async () => {
    const user = userEvent.setup();
    mount({ [`${DLQ}/replay`]: authFail });
    await screen.findByRole('table');
    await user.click(within(rowFor('a:one')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Replay selected (1)' }));

    expect(await screen.findByText(/requires an API token/i)).toBeInTheDocument();
  });

  it('explains a refused delete the same way', async () => {
    const user = userEvent.setup();
    mount({ [`${DLQ}/1`]: authFail });
    await screen.findByRole('table');
    await user.click(within(rowFor('a:one')).getByRole('button', { name: 'Delete dead letter for a:one' }));

    expect(await screen.findByText(/requires an API token/i)).toBeInTheDocument();
  });
});
