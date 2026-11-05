// /bundles/:name — the member list, and the deprecation an operator must not
// miss before pinning a CRD to it.

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BundleDetail, parseReplacement } from './BundleDetail';
import { isRequired } from '../api';
import { mockFetch, type RouteTable } from '../test/helpers';
import { realBundles } from '../test/fixtures/registry';

const deprecatedBundle = realBundles.find((b) => b.deprecated)!;
// The biggest live bundle — the member table has to hold up at its real
// length, not at the four rows a hand-written fixture would have.
const liveBundle = realBundles
  .filter((b) => !b.deprecated)
  .sort((a, b) => b.events.length - a.events.length)[0]!;

/** Render at a real URL so useParams/useSearchParams see what the app gives them. */
function renderAt(path: string, ui: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/bundles/:name" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

function mount(name: string, routes: RouteTable, query = '') {
  const mock = mockFetch(routes);
  renderAt(`/bundles/${encodeURIComponent(name)}${query}`, <BundleDetail />);
  return mock;
}

const routeFor = (b: typeof liveBundle): RouteTable => ({
  [`/api/feature-bundles/${b.name}`]: { body: b },
});

afterEach(() => vi.unstubAllGlobals());

describe('BundleDetail — loading / error / loaded', () => {
  it('shows a busy skeleton before the bundle arrives, not an empty member list', async () => {
    mount(liveBundle.name, routeFor(liveBundle));
    // The skeleton stack is what a sighted operator sees; `aria-busy` plus
    // the live region is what everyone else gets. Neither may be replaced by
    // an empty member table.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Loading bundle…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: liveBundle.name });
  });

  it('renders a 404 as an error naming the bundle, with a way back', async () => {
    mount('nope', { '/api/feature-bundles/nope': { status: 404, text: 'Bundle "nope" not found' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading this bundle');
    expect(alert).toHaveTextContent('not found');
    expect(screen.getByRole('link', { name: 'Bundles' })).toHaveAttribute('href', '/bundles');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('retries on demand', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount(liveBundle.name, {
      [`/api/feature-bundles/${liveBundle.name}`]: () =>
        failing ? { status: 500, text: 'registry down' } : { body: liveBundle },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: liveBundle.name })).toBeInTheDocument();
  });

  it('asks for the pinned version when the URL carries one', async () => {
    const { calls } = mount(
      liveBundle.name,
      { [`/api/feature-bundles/${liveBundle.name}/${liveBundle.version}`]: { body: liveBundle } },
      `?version=${liveBundle.version}`,
    );
    await screen.findByRole('heading', { name: liveBundle.name });
    expect(calls[0]).toContain(`/api/feature-bundles/${liveBundle.name}/${liveBundle.version}`);
  });
});

describe('BundleDetail — the member list', () => {
  it('lists every member, its requirement, and a link into the event detail', async () => {
    mount(liveBundle.name, routeFor(liveBundle));
    await screen.findByRole('heading', { name: liveBundle.name });

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(liveBundle.events.length);
    expect(liveBundle.events.length).toBeGreaterThan(5);

    const first = liveBundle.events[0]!;
    const link = within(table).getByRole('link', { name: first.name });
    expect(link).toHaveAttribute('href', `/events/${encodeURIComponent(first.name)}`);
  });

  it('treats an absent `required` flag as required, matching the CRD gate', async () => {
    const withOptional = {
      ...liveBundle,
      events: [
        { name: 'ws.chat.message' },
        { name: 'ws.error', required: false },
        { name: 'ws.chat.sent', required: true },
      ],
    };
    mount(withOptional.name, routeFor(withOptional));
    await screen.findByRole('heading', { name: withOptional.name });

    const rowFor = (n: string) => screen.getByRole('link', { name: n }).closest('tr')!;
    expect(within(rowFor('ws.chat.message')).getByText('required')).toBeInTheDocument();
    expect(within(rowFor('ws.chat.sent')).getByText('required')).toBeInTheDocument();
    expect(within(rowFor('ws.error')).getByText('optional')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2 required, 1 optional/ })).toBeInTheDocument();
  });

  it('summarises the required count the same way the rows do', async () => {
    mount(liveBundle.name, routeFor(liveBundle));
    await screen.findByRole('heading', { name: liveBundle.name });
    const required = liveBundle.events.filter(isRequired).length;
    const optional = liveBundle.events.length - required;
    expect(
      screen.getByRole('heading', { name: new RegExp(`${required} required, ${optional} optional`) }),
    ).toBeInTheDocument();
  });

  it('distinguishes a pinned schema version from an unpinned member', async () => {
    const pinned = {
      ...liveBundle,
      events: [{ name: 'ws.chat.message', version: 3 }, { name: 'ws.chat.sent' }],
    };
    mount(pinned.name, routeFor(pinned));
    await screen.findByRole('heading', { name: pinned.name });
    const rowFor = (n: string) => screen.getByRole('link', { name: n }).closest('tr')!;
    expect(within(rowFor('ws.chat.message')).getByText('v3')).toBeInTheDocument();
    expect(within(rowFor('ws.chat.sent')).getByText('current')).toBeInTheDocument();
  });

  it('heads every column, and every member row opens its event', async () => {
    // The library DataTable draws <th> in <thead> (implicit column scope) and
    // has no row-header cell; each row is itself activatable instead.
    mount(liveBundle.name, routeFor(liveBundle));
    await screen.findByRole('heading', { name: liveBundle.name });
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Event', 'Requirement', 'Pinned schema version',
    ]);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(liveBundle.events.length);
    for (const row of rows) expect(row).toHaveAttribute('tabindex', '0');
  });
});

describe('BundleDetail — deprecation is impossible to miss', () => {
  it('raises an alert naming the replacement, and links to it', async () => {
    mount(deprecatedBundle.name, routeFor(deprecatedBundle));
    await screen.findByRole('heading', { name: deprecatedBundle.name });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Deprecated bundle');
    expect(alert).toHaveTextContent(`do not pin a new CRD to ${deprecatedBundle.name}`);
    expect(alert).toHaveTextContent(`Deprecated since ${deprecatedBundle.deprecated!.since}`);

    const replacement = deprecatedBundle.deprecated!.replacement!;
    const parsed = parseReplacement(replacement)!;
    const link = within(alert).getByRole('link', { name: replacement });
    expect(link).toHaveAttribute(
      'href',
      `/bundles/${encodeURIComponent(parsed.name)}?version=${encodeURIComponent(parsed.version!)}`,
    );
  });

  it('also marks the header, so the state survives a scrolled-past banner', async () => {
    mount(deprecatedBundle.name, routeFor(deprecatedBundle));
    const heading = await screen.findByRole('heading', { name: deprecatedBundle.name });
    expect(screen.getByText('deprecated')).toBeInTheDocument();
    expect(heading.closest('.bundle-detail')).toHaveClass('deprecated');
  });

  it('leaves a live bundle unmarked', async () => {
    mount(liveBundle.name, routeFor(liveBundle));
    const heading = await screen.findByRole('heading', { name: liveBundle.name });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(heading.closest('.bundle-detail')).not.toHaveClass('deprecated');
  });

  it('says so plainly when a deprecation names no replacement', async () => {
    const orphaned = {
      ...deprecatedBundle,
      deprecated: { since: 'v9.9.9' },
    };
    mount(orphaned.name, routeFor(orphaned));
    await screen.findByRole('heading', { name: orphaned.name });
    expect(screen.getByRole('alert')).toHaveTextContent('No replacement was named');
  });
});

describe('parseReplacement', () => {
  it('splits a name@version pin', () => {
    expect(parseReplacement('agentic-pipeline-signal@1.0.0')).toEqual({
      name: 'agentic-pipeline-signal',
      version: '1.0.0',
    });
  });

  it('accepts a bare name', () => {
    expect(parseReplacement('chat')).toEqual({ name: 'chat' });
  });

  it('does not guess at something unparseable', () => {
    expect(parseReplacement('   ')).toBeNull();
    expect(parseReplacement('@1.0.0')).toEqual({ name: '@1.0.0' });
  });
});
