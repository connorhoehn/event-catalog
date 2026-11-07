// /bundles — the FeatureBundle inventory, against the real declaration set.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BundlesView } from './BundlesView';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';
import { REAL_BUNDLE_COUNT, realBundles, realBundlesResponse } from '../test/fixtures/registry';

const OK: RouteTable = { '/admin-api/feature-bundles': { body: realBundlesResponse } };

function mount(routes: RouteTable = OK) {
  const mock = mockFetch(routes);
  renderWithRouter(<BundlesView />);
  return mock;
}

const deprecatedBundle = realBundles.find((b) => b.deprecated)!;
const liveBundle = realBundles.find((b) => !b.deprecated)!;

afterEach(() => vi.unstubAllGlobals());

describe('BundlesView — loading / empty / error tri-state', () => {
  it('says it is loading rather than claiming there are no bundles', async () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading bundles…');
    expect(screen.queryByText('No bundles registered')).not.toBeInTheDocument();
    await screen.findByRole('link', { name: liveBundle.name });
  });

  it('renders an error, not an empty inventory, on a 500', async () => {
    mount({ '/admin-api/feature-bundles': { status: 500, text: 'bundle registry down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading bundles');
    expect(alert).toHaveTextContent('bundle registry down');
    expect(screen.queryByText('No bundles registered')).not.toBeInTheDocument();
    // The heading survives every state — bailing out to a bare banner leaves
    // the view with no <h2> for a screen reader to land on.
    expect(screen.getByRole('heading', { name: 'Feature Bundles' })).toBeInTheDocument();
  });

  it('recovers when the operator retries', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/admin-api/feature-bundles': () =>
        failing ? { status: 503, text: 'starting up' } : { body: realBundlesResponse },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: liveBundle.name })).toBeInTheDocument();
  });

  it('explains an empty registry instead of leaving a blank page', async () => {
    mount({ '/admin-api/feature-bundles': { body: { bundles: [], total: 0 } } });
    expect(await screen.findByText('No bundles registered')).toBeInTheDocument();
    expect(screen.getByText(/declared in src\/declarations\/bundles/)).toBeInTheDocument();
  });
});

describe('BundlesView — the inventory at real scale', () => {
  it('lists every registered bundle with its member count', async () => {
    mount();
    await screen.findByRole('link', { name: liveBundle.name });
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(REAL_BUNDLE_COUNT);
    expect(REAL_BUNDLE_COUNT).toBeGreaterThan(10);

    const row = screen.getByRole('link', { name: liveBundle.name }).closest('tr')!;
    expect(within(row).getByText(String(liveBundle.events.length), { exact: false }))
      .toBeInTheDocument();
    expect(within(row).getByText(liveBundle.transport)).toBeInTheDocument();
  });

  it('gives every column a header and every row an activatable target', async () => {
    // The library DataTable draws <th> in <thead> (implicit column scope)
    // and has no row-header cell, so the row's own name is its link, and
    // the row itself opens the bundle.
    mount();
    await screen.findByRole('link', { name: liveBundle.name });
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Bundle', 'Version', 'Transport', 'Events', 'Status', 'Fingerprint',
    ]);
    const rows = screen.getAllByRole('row').slice(1);
    for (const row of rows) {
      expect(within(row).getAllByRole('link').length).toBeGreaterThan(0);
      expect(row).toHaveAttribute('tabindex', '0');
    }
  });

  it('shows the fingerprint short and expands it on demand', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: liveBundle.name });
    const short = liveBundle.fingerprint.slice(0, 12);
    const toggle = screen.getByRole('button', { name: new RegExp(short) });
    expect(screen.queryByText(liveBundle.fingerprint)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(liveBundle.fingerprint)).toBeInTheDocument();
  });

  it('marks a deprecated bundle unmistakably, with its replacement', async () => {
    mount();
    const link = await screen.findByRole('link', { name: deprecatedBundle.name });
    const row = link.closest('tr')!;
    expect(within(row).getByText('deprecated')).toBeInTheDocument();
    const meta = within(row).getByText(new RegExp(`since ${deprecatedBundle.deprecated!.since}`));
    // The replacement has to be on the row itself: an operator scanning the
    // list for something to pin should not have to open the detail page to
    // find out what to pin instead.
    expect(meta).toHaveTextContent(deprecatedBundle.deprecated!.replacement!);
    // …and a live bundle is not dressed up the same way.
    const liveRow = screen.getByRole('link', { name: liveBundle.name }).closest('tr')!;
    expect(within(liveRow).queryByText('deprecated')).not.toBeInTheDocument();
    expect(within(liveRow).getByText('active')).toBeInTheDocument();
  });

  it('links each bundle to its detail view, version included', async () => {
    mount();
    const link = await screen.findByRole('link', { name: liveBundle.name });
    expect(link).toHaveAttribute(
      'href',
      `/bundles/${encodeURIComponent(liveBundle.name)}?version=${encodeURIComponent(liveBundle.version)}`,
    );
  });

  it('filters by name through a bound label', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: liveBundle.name });
    const input = screen.getByLabelText('Filter bundles by name or description');
    await user.type(input, deprecatedBundle.name);
    expect(screen.getByRole('link', { name: deprecatedBundle.name })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: liveBundle.name })).not.toBeInTheDocument();
  });

  it('reports a filter that matches nothing as a filter, not an empty registry', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: liveBundle.name });
    await user.type(screen.getByLabelText('Filter bundles by name or description'), 'zzzznope');
    expect(await screen.findByText(/No bundle matches "zzzznope"/)).toBeInTheDocument();
  });
});
