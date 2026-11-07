// /declarations — the read-only registry browser.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeclarationViewer } from './DeclarationViewer';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';

const event = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  transport: 'signal',
  producer: 'platform-api',
  description: `what ${name} means`,
  schema: { type: 'object', properties: { id: { type: 'string' } } },
  subscribers: ['transcription-worker'],
  version: 2,
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
  stats: null,
  ...over,
});

const LIST = { events: [event('call:caption:line'), event('pipeline:step:started', { transport: 'durable' })], total: 2 };

function mount(routes: RouteTable = { '/admin-api/events': { body: LIST } }) {
  const mock = mockFetch(routes);
  renderWithRouter(<DeclarationViewer />);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('DeclarationViewer — loading / empty / error tri-state', () => {
  it('shows a busy skeleton and no verdict about the registry', async () => {
    mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('No event declarations')).not.toBeInTheDocument();
    await screen.findByRole('button', { name: /call:caption:line/ });
  });

  it('shows the error ALONE — not stacked over "No event declarations"', async () => {
    // The regression this guards: a 500 rendered the error banner AND the
    // empty state under it, so a broken registry and an empty one looked the
    // same below the fold.
    mount({ '/admin-api/events': { status: 500, text: 'registry exploded' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load declarations");
    expect(alert).toHaveTextContent('registry exploded');
    expect(screen.queryByText('No event declarations')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });

  it('recovers on Retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({ '/admin-api/events': () => (failing ? { status: 500, text: 'x' } : { body: LIST }) });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /call:caption:line/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an empty registry as empty', async () => {
    mount({ '/admin-api/events': { body: { events: [], total: 0 } } });
    expect(await screen.findByText('No event declarations')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts the declarations it loaded', async () => {
    mount();
    expect(await screen.findByText('2 declared')).toBeInTheDocument();
  });
});

describe('DeclarationViewer — selecting a declaration', () => {
  it('shows no detail pane until something is chosen', async () => {
    mount();
    await screen.findByRole('button', { name: /call:caption:line/ });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('opens the detail pane, named for the declaration, on click', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    const pane = screen.getByRole('region', { name: 'Declaration detail for call:caption:line' });
    expect(within(pane).getByRole('heading', { name: 'call:caption:line' })).toBeInTheDocument();
    expect(within(pane).getByText('what call:caption:line means')).toBeInTheDocument();
    expect(within(pane).getByText('platform-api')).toBeInTheDocument();
    expect(within(pane).getByText('transcription-worker')).toBeInTheDocument();
  });

  it('is reachable by keyboard, and marks the chosen row for a screen reader', async () => {
    // These rows used to be `<li onClick>`: no keyboard, no role — the whole
    // detail pane was unreachable for anyone not using a mouse.
    const user = userEvent.setup();
    mount();
    const row = await screen.findByRole('button', { name: /call:caption:line/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('marks only one row as current at a time', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    await user.click(screen.getByRole('button', { name: /pipeline:step:started/ }));
    expect(screen.getByRole('button', { name: /call:caption:line/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /pipeline:step:started/ })).toHaveAttribute('aria-current', 'page');
  });

  it('links out to the full event page with the name encoded', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    expect(screen.getByRole('link', { name: /full details/ })).toHaveAttribute(
      'href',
      '/events/call%3Acaption%3Aline',
    );
  });

  it('renders the current payload schema', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    expect(screen.getByText(/"properties"/)).toBeInTheDocument();
  });
});

describe('DeclarationViewer — version history', () => {
  it('says so when there is only a first version', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    expect(screen.getByText('First version — no prior schemas recorded.')).toBeInTheDocument();
  });

  it('lists prior schemas newest-first', async () => {
    const user = userEvent.setup();
    mount({
      '/admin-api/events': {
        body: {
          events: [
            event('call:caption:line', {
              version: 3,
              schemaHistory: [
                { version: 1, schema: { v: 1 }, updatedAt: '2026-01-01T00:00:00.000Z' },
                { version: 2, schema: { v: 2 }, updatedAt: '2026-02-01T00:00:00.000Z' },
              ],
            }),
          ],
          total: 1,
        },
      },
    });
    await user.click(await screen.findByRole('button', { name: /call:caption:line/ }));
    // Scoped to the Version History section — the left-hand row carries a
    // version chip of its own.
    const section = screen.getByRole('heading', { name: 'Version History' })
      .closest('section') as HTMLElement;
    const versions = within(section)
      .getAllByRole('listitem')
      .map((li) => within(li).getByText(/^v\d+$/).textContent);
    expect(versions).toEqual(['v2', 'v1']);
  });

  it('defaults a declaration with no version to v1 rather than "vundefined"', async () => {
    const user = userEvent.setup();
    mount({ '/admin-api/events': { body: { events: [event('a:one', { version: undefined })], total: 1 } } });
    await user.click(await screen.findByRole('button', { name: /a:one/ }));
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.queryByText(/vundefined/)).not.toBeInTheDocument();
  });
});
