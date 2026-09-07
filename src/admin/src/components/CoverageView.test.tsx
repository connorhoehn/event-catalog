// /coverage — the gap view, at the scale that made it necessary.
//
// The audit found 83 of 225 declared events in no bundle. These tests run
// against the same derived fixture the rest of the suite uses, so the numbers
// under assertion are the catalog's, not a convenient handful's.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverageView } from './CoverageView';
import { mockFetch, renderWithRouter, type RouteTable } from '../test/helpers';
import { computeCoverage } from './bundles/coverage';
import {
  realBundles,
  realBundlesResponse,
  realEvents,
  realEventsResponse,
} from '../test/fixtures/registry';

const OK: RouteTable = {
  '/api/events': { body: realEventsResponse },
  '/api/feature-bundles': { body: realBundlesResponse },
};

const expected = computeCoverage(realEvents, realBundles);
const worstNamespace = expected.namespaces[0]!;
const uncoveredExample = worstNamespace.uncoveredEvents[0]!;
const coveredExample = expected.rows.find((r) => r.covered && !r.onlyDeprecated)!;

function mount(routes: RouteTable = OK) {
  const mock = mockFetch(routes);
  renderWithRouter(<CoverageView />);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('CoverageView — loading / empty / error tri-state', () => {
  it('reports loading rather than a clean bill of health', async () => {
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading coverage…');
    expect(screen.queryByText('Every namespace is fully covered')).not.toBeInTheDocument();
    await screen.findByText(worstNamespace.namespace);
  });

  it('renders an error when the bundle registry 500s — not "everything is covered"', async () => {
    mount({
      '/api/events': { body: realEventsResponse },
      '/api/feature-bundles': { status: 500, text: 'bundle registry down' },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error loading coverage');
    expect(alert).toHaveTextContent('bundle registry down');
    expect(screen.queryByText('Every namespace is fully covered')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bundle Coverage' })).toBeInTheDocument();
  });

  it('renders an error when the event catalog 500s — a half answer would understate the gap', async () => {
    mount({
      '/api/events': { status: 503, text: 'registry starting' },
      '/api/feature-bundles': { body: realBundlesResponse },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('registry starting');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('recovers on retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    mount({
      '/api/events': { body: realEventsResponse },
      '/api/feature-bundles': () =>
        failing ? { status: 503, text: 'starting up' } : { body: realBundlesResponse },
    });
    await screen.findByRole('alert');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(worstNamespace.namespace)).toBeInTheDocument();
  });

  it('celebrates full coverage instead of showing an empty list', async () => {
    const events = realEvents.slice(0, 3);
    const bundle = {
      ...realBundles[0]!,
      events: events.map((e) => ({ name: e.name })),
    };
    mount({
      '/api/events': { body: { events, total: events.length } },
      '/api/feature-bundles': { body: { bundles: [bundle], total: 1 } },
    });
    expect(await screen.findByText('Every namespace is fully covered')).toBeInTheDocument();
  });
});

describe('CoverageView — the gap, grouped so it is legible', () => {
  it('counts the whole catalog in the toolbar', async () => {
    mount();
    await screen.findByText(worstNamespace.namespace);
    expect(screen.getByText(`${expected.total} events`)).toBeInTheDocument();
    expect(screen.getByText(`${expected.covered} covered`)).toBeInTheDocument();
    expect(screen.getByText(`${expected.uncovered} uncovered`)).toBeInTheDocument();
    expect(expected.uncovered).toBeGreaterThan(50);
  });

  it('groups the gaps by namespace instead of listing 80-odd names flat', async () => {
    mount();
    await screen.findByText(worstNamespace.namespace);
    const gapNamespaces = expected.namespaces.filter((n) => n.uncovered > 0);
    // Default view is "namespaces with gaps": one row per namespace, not one
    // per uncovered event.
    for (const ns of gapNamespaces) {
      expect(screen.getByText(ns.namespace)).toBeInTheDocument();
    }
    const covered = expected.namespaces.find((n) => n.uncovered === 0);
    if (covered) {
      expect(screen.queryByText(covered.namespace)).not.toBeInTheDocument();
    }
  });

  it('opens the worst namespace on arrival, so the view answers something immediately', async () => {
    mount();
    const toggle = await screen.findByRole('button', {
      name: new RegExp(`^${worstNamespace.namespace}`),
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('link', { name: uncoveredExample.name }),
    ).toHaveAttribute('href', `/events/${encodeURIComponent(uncoveredExample.name)}`);
  });

  it('collapses and re-expands a group from the keyboard', async () => {
    const user = userEvent.setup();
    mount();
    const toggle = await screen.findByRole('button', {
      name: new RegExp(`^${worstNamespace.namespace}`),
    });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: uncoveredExample.name })).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists every uncovered event of an expanded namespace, and only those', async () => {
    mount();
    await screen.findByRole('button', { name: new RegExp(`^${worstNamespace.namespace}`) });
    const body = document.getElementById(`coverage-body-${worstNamespace.namespace}`)!;
    const rows = within(body).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(worstNamespace.uncovered);
    for (const th of within(body).getAllByRole('columnheader')) {
      expect(th).toHaveAttribute('scope', 'col');
    }
  });

  it('can show the fully-covered namespaces too', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(worstNamespace.namespace);
    await user.click(screen.getByRole('button', { name: 'All namespaces' }));
    for (const ns of expected.namespaces) {
      expect(screen.getByText(ns.namespace)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'All namespaces' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('gives every coverage bar a name, since the bar itself says nothing', async () => {
    mount();
    await screen.findByText(worstNamespace.namespace);
    const bars = screen.getAllByRole('progressbar');
    expect(bars.length).toBeGreaterThan(1);
    expect(bars[0]).toHaveAccessibleName(
      `${expected.covered} of ${expected.total} declared events belong to a bundle`,
    );
    for (const bar of bars) {
      expect(bar).toHaveAccessibleName();
    }
  });
});

describe('CoverageView — "is this event covered by anything I can pin?"', () => {
  it('answers for an uncovered event', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(worstNamespace.namespace);
    await user.type(screen.getByLabelText('Is this event covered?'), uncoveredExample.name);
    const row = screen.getByRole('link', { name: uncoveredExample.name }).closest('tr')!;
    expect(within(row).getByText('no bundle')).toBeInTheDocument();
  });

  it('answers for a covered event, naming the bundles and linking to them', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(worstNamespace.namespace);
    await user.type(screen.getByLabelText('Is this event covered?'), coveredExample.name);
    const row = screen.getByRole('link', { name: coveredExample.name }).closest('tr')!;
    const bundle = coveredExample.bundles[0]!;
    const link = within(row).getByRole('link', { name: new RegExp(`^${bundle.name}@`) });
    expect(link).toHaveAttribute(
      'href',
      `/bundles/${encodeURIComponent(bundle.name)}?version=${encodeURIComponent(bundle.version)}`,
    );
  });

  it('says so when nothing matches, rather than showing the gap list underneath', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(worstNamespace.namespace);
    await user.type(screen.getByLabelText('Is this event covered?'), 'zzzznope');
    expect(screen.getByRole('heading', { name: /No declared event matches/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`^${worstNamespace.namespace}`) }))
      .not.toBeInTheDocument();
  });

  it('caps a broad query instead of rendering the whole catalog', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(worstNamespace.namespace);
    await user.type(screen.getByLabelText('Is this event covered?'), 'e');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1).length).toBeLessThanOrEqual(50);
    expect(screen.getByRole('heading', { name: /matching events/ })).toBeInTheDocument();
  });
});

describe('CoverageView — bundle members the catalog does not declare', () => {
  it('warns about a dangling required member', async () => {
    const bundle = {
      ...realBundles[0]!,
      events: [{ name: 'ws.chat.ghost', required: true }],
    };
    mount({
      '/api/events': { body: realEventsResponse },
      '/api/feature-bundles': { body: { bundles: [bundle], total: 1 } },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bundles reference events the catalog does not have');
    expect(alert).toHaveTextContent('ws.chat.ghost (required)');
  });

  it('stays quiet when every member exists', async () => {
    mount();
    await screen.findByText(worstNamespace.namespace);
    expect(screen.queryByText(/Bundles reference events the catalog does not have/))
      .not.toBeInTheDocument();
  });
});
