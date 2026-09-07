import { test, expect, type Page } from '@playwright/test';
import {
  failBundles,
  fetchBundles,
  fetchEvents,
  memberIsRequired,
  resetServer,
  seedRegistry,
  setBundleRegistry,
  trackPageErrors,
  type ServerBundle,
} from './helpers';

/**
 * /bundles, /bundles/:name and /coverage against the real server.
 *
 * These views shipped with 63 component tests and no end-to-end cover, and
 * the thing they were built to expose was broken on the server the whole
 * time: `FeatureBundleRegistry` was constructed empty and never populated, so
 * `GET /api/feature-bundles` answered `{bundles: [], total: 0}` in production
 * while 19 bundles sat declared in `src/declarations/bundles`. The admin drew
 * that faithfully — "No bundles registered" — which is also exactly what a
 * deployment with no bundles looks like, so nobody could tell.
 *
 * So nothing here is hard-coded. Every count is read back from the endpoint
 * the browser is about to call, and the first assertion in the first test is
 * that the number is not zero. A registry that empties itself again fails
 * here instead of rendering as a tidy empty state.
 *
 * The event registry is seeded to the real ~229 declarations for the whole
 * file: bundle members ARE event names, so at the four-event fixture every
 * member would dangle and /coverage would have nothing to be consistent with.
 */

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await seedRegistry(request, 'scale');
});

test.afterAll(async ({ request }) => {
  // The rest of the suite asserts exact counts against the four-event
  // fixture, and one server process is shared by all of it.
  await resetServer(request);
});

/** A bundle with no deprecation and at least one member — the ordinary case. */
function firstHealthy(bundles: ServerBundle[]): ServerBundle {
  const healthy = bundles.find(b => !b.deprecated && b.events.length > 0);
  expect(healthy, 'no non-deprecated bundle with members is registered').toBeTruthy();
  return healthy!;
}

/** The bundles table row owning a given bundle name, matched on the exact link. */
function bundleRow(page: Page, name: string) {
  // `filter({ hasText })` would match `agentic-pipeline-signal` for
  // `agentic-pipeline`; the link's accessible name is exact.
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
}

test('the bundle list renders every bundle the server actually holds', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const { bundles, total } = await fetchBundles(request);
  // THE regression assertion. An unpopulated registry answers 0 here and this
  // test fails before it ever opens a browser tab.
  expect(total, 'the server registered no FeatureBundles').toBeGreaterThan(0);
  expect(bundles).toHaveLength(total);

  await page.goto('/bundles');
  await expect(page.getByRole('heading', { name: 'Feature Bundles' })).toBeVisible();
  await expect(page.getByText(`${total} total`)).toBeVisible();

  // One row per bundle version, plus the header row. Not a literal — if a
  // bundle is declared tomorrow this still holds.
  await expect(page.getByRole('row')).toHaveCount(total + 1);
  // And the "there are none" state is not on the page while there are some.
  await expect(page.getByText('No bundles registered')).toHaveCount(0);

  for (const bundle of bundles) {
    const row = bundleRow(page, bundle.name);
    await expect(row, `row for ${bundle.name}`).toHaveCount(1);
    await expect(row).toContainText(bundle.version);
    await expect(row).toContainText(bundle.transport);
    // "6 (6 required)" — the member counts come off the same payload.
    const required = bundle.events.filter(memberIsRequired).length;
    await expect(row).toContainText(`${bundle.events.length}`);
    await expect(row).toContainText(`(${required} required)`);
    // The fingerprint is what a CRD pins, so it has to be on screen.
    await expect(row).toContainText(bundle.fingerprint.slice(0, 12));
  }

  const deprecated = bundles.filter(b => b.deprecated).length;
  if (deprecated > 0) {
    await expect(page.getByText(`${deprecated} deprecated`)).toBeVisible();
  }

  assertNoErrors();
});

test('the filter box narrows the list and says so when nothing matches', async ({ page, request }) => {
  const { bundles } = await fetchBundles(request);
  const target = firstHealthy(bundles);

  await page.goto('/bundles');
  await expect(bundleRow(page, target.name)).toHaveCount(1);

  await page.getByPlaceholder('Filter bundles…').fill(target.name);
  await expect(page.getByRole('link', { name: target.name, exact: true })).toBeVisible();

  await page.getByPlaceholder('Filter bundles…').fill('zzz-no-such-bundle');
  await expect(page.getByText('No bundle matches "zzz-no-such-bundle".')).toBeVisible();
  // Filtering to nothing is an empty RESULT, never an error.
  await expect(page.getByText('Error loading bundles')).toHaveCount(0);
});

test('bundle detail lists its members and links each one into the catalog', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const { bundles } = await fetchBundles(request);
  const bundle = firstHealthy(bundles);
  const required = bundle.events.filter(memberIsRequired).length;
  const optional = bundle.events.length - required;

  // Arrive the way an operator does — by clicking the list, not by URL.
  await page.goto('/bundles');
  await page.getByRole('link', { name: bundle.name, exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/bundles/${bundle.name}\\?version=${bundle.version.replace(/\./g, '\\.')}$`),
  );

  await expect(page.getByRole('heading', { name: bundle.name })).toBeVisible();
  await expect(page.getByText(`v${bundle.version}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${bundle.events.length} events`, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: new RegExp(`Member events.*${required} required, ${optional} optional`) }),
  ).toBeVisible();
  // A healthy bundle carries no deprecation banner at all.
  await expect(page.getByText(/Deprecated bundle/)).toHaveCount(0);

  const memberTable = page.getByRole('table');
  await expect(memberTable.getByRole('row')).toHaveCount(bundle.events.length + 1);
  for (const member of bundle.events) {
    const row = memberTable
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: member.name, exact: true }) });
    await expect(row, `member row for ${member.name}`).toHaveCount(1);
    await expect(row).toContainText(memberIsRequired(member) ? 'required' : 'optional');
    // An unpinned member floats to whatever the registry holds; that is a
    // different, visible state from "pinned to v1".
    await expect(row).toContainText(member.version !== undefined ? `v${member.version}` : 'current');
  }

  // The member link has to reach the event the catalog actually declares —
  // this is the join between the bundle registry and the event registry.
  const first = bundle.events[0]!;
  await page.getByRole('link', { name: first.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${first.name.replace(/\./g, '\\.')}$`));
  await expect(page.getByRole('heading', { name: first.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schema' })).toBeVisible();

  assertNoErrors();
});

test('a deprecated bundle is unmistakable in the list and on its page', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const { bundles } = await fetchBundles(request);
  const stale = bundles.find(b => b.deprecated);
  expect(
    stale,
    'no deprecated bundle is declared — the deprecation path is now untested',
  ).toBeTruthy();
  const deprecated = stale!.deprecated!;

  await page.goto('/bundles');
  const row = bundleRow(page, stale!.name);
  // Not colour alone: the row says the word, the date, and the replacement.
  await expect(row).toContainText('deprecated');
  await expect(row).toContainText(`since ${deprecated.since}`);
  if (deprecated.replacement) {
    await expect(row).toContainText(`use ${deprecated.replacement}`);
  }

  await page.getByRole('link', { name: stale!.name, exact: true }).click();
  await expect(
    page.getByText(`Deprecated bundle — do not pin a new CRD to ${stale!.name}@${stale!.version}`),
  ).toBeVisible();
  await expect(page.getByText(`Deprecated since ${deprecated.since}.`)).toBeVisible();

  if (deprecated.replacement) {
    // `name@version`, split so the operator can click it rather than retype it.
    const [replacementName] = deprecated.replacement.split('@');
    await page.getByRole('link', { name: deprecated.replacement, exact: true }).click();
    await expect(page.getByRole('heading', { name: replacementName! })).toBeVisible();
    // And the bundle it sends you to is not itself deprecated.
    await expect(page.getByText(/Deprecated bundle/)).toHaveCount(0);
  }

  assertNoErrors();
});

test('coverage reports the same orphans the server data implies', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const [{ bundles }, events] = await Promise.all([fetchBundles(request), fetchEvents(request)]);

  // The diff, computed here rather than imported from the view — otherwise
  // this would only prove the view agrees with itself.
  const members = new Set(bundles.flatMap(b => b.events.map(e => e.name)));
  const declared = new Set(events.map(e => e.name));
  const uncoveredEvents = events.filter(e => !members.has(e.name));
  const covered = events.length - uncoveredEvents.length;
  const dangling = [...members].filter(n => !declared.has(n));

  expect(events.length).toBeGreaterThan(0);
  expect(uncoveredEvents.length, 'nothing is uncovered, so this view asserts nothing').toBeGreaterThan(0);

  const uncoveredByNs = new Map<string, number>();
  for (const e of uncoveredEvents) {
    const ns = e.namespace ?? 'unnamespaced';
    uncoveredByNs.set(ns, (uncoveredByNs.get(ns) ?? 0) + 1);
  }
  // Same ordering the view uses: biggest gap first, ties alphabetical.
  const worst = [...uncoveredByNs.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]!;

  await page.goto('/coverage');
  await expect(page.getByRole('heading', { name: 'Bundle Coverage' })).toBeVisible();
  await expect(page.getByText(`${events.length} events`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${covered} covered`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${uncoveredEvents.length} uncovered`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${bundles.length} bundles`, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`of ${events.length} declared events belong to no bundle`),
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', {
      name: `${covered} of ${events.length} declared events belong to a bundle`,
    }),
  ).toBeVisible();

  // Every member of every registered bundle is an event this server declares.
  // A dangling member means a bundle that cannot validate, so it is a banner,
  // not a silent omission.
  if (dangling.length === 0) {
    await expect(page.getByText('Bundles reference events the catalog does not have')).toHaveCount(0);
  } else {
    await expect(page.getByText('Bundles reference events the catalog does not have')).toBeVisible();
  }

  // "Namespaces with gaps" is the default; exactly the namespaces that have
  // one should be listed. Each group toggle owns its body by id, which is a
  // sturdier handle than the namespace label (`ws` is a substring of plenty).
  for (const [namespace, count] of uncoveredByNs) {
    const group = page.locator(`[aria-controls="coverage-body-${namespace}"]`);
    await expect(group, `coverage group for ${namespace}`).toHaveCount(1);
    await expect(group).toContainText(`${count} uncovered`);
  }
  await expect(page.locator('[aria-controls^="coverage-body-"]')).toHaveCount(uncoveredByNs.size);

  // The worst namespace is opened on arrival, so the view answers something
  // instead of presenting closed drawers.
  const worstUncovered = uncoveredEvents.filter(e => (e.namespace ?? 'unnamespaced') === worst[0]);
  for (const e of worstUncovered.slice(0, 5)) {
    await expect(page.getByRole('link', { name: e.name, exact: true })).toBeVisible();
  }

  assertNoErrors();
});

test('the coverage lookup answers "is this event covered" for both answers', async ({ page, request }) => {
  const [{ bundles }, events] = await Promise.all([fetchBundles(request), fetchEvents(request)]);
  const members = new Map<string, ServerBundle>();
  for (const b of bundles) for (const e of b.events) if (!members.has(e.name)) members.set(e.name, b);

  const coveredEvent = events.find(e => members.has(e.name));
  const orphan = events.find(e => !members.has(e.name));
  expect(coveredEvent, 'no event is in a bundle').toBeTruthy();
  expect(orphan, 'no event is outside every bundle').toBeTruthy();

  await page.goto('/coverage');
  const lookup = page.getByPlaceholder('Look up an event by name…');

  await lookup.fill(coveredEvent!.name);
  const coveredRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: coveredEvent!.name, exact: true }) });
  await expect(coveredRow).toContainText(members.get(coveredEvent!.name)!.name);
  await expect(coveredRow).not.toContainText('no bundle');

  await lookup.fill(orphan!.name);
  const orphanRow = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: orphan!.name, exact: true }) });
  await expect(orphanRow).toContainText('no bundle');

  await lookup.fill('zzz-no-such-event');
  await expect(page.getByText('No declared event matches “zzz-no-such-event”')).toBeVisible();
});

/**
 * The tri-state.
 *
 * "The registry holds nothing" and "the registry did not answer" produced the
 * same screen for months, which is why an endpoint that returned `{bundles:
 * []}` in production went unnoticed. These three tests pin the three states
 * apart on the real server.
 */
test.describe('bundles: populated, empty, broken', () => {
  test.afterEach(async ({ request }) => {
    await failBundles(request, null);
    await setBundleRegistry(request, 'real');
  });

  test('a registry that genuinely holds no bundles renders the empty state', async ({ page, request }) => {
    const total = await setBundleRegistry(request, 'empty');
    expect(total).toBe(0);

    await page.goto('/bundles');
    await expect(page.getByText('0 total')).toBeVisible();
    await expect(page.getByText('No bundles registered')).toBeVisible();
    // The empty state explains where bundles come from — and is NOT an error.
    await expect(page.getByText('Error loading bundles')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('a failing /api/feature-bundles renders an error, never an empty list', async ({ page, request }) => {
    await failBundles(request, 'bundle registry unreachable');

    await page.goto('/bundles');
    await expect(page.getByText('Error loading bundles')).toBeVisible();
    // The distinction that did not exist: no empty state, no "0 total" list,
    // no table pretending the deployment has no bundles.
    await expect(page.getByText('No bundles registered')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);

    // And it recovers: the error is a state, not a dead end.
    const { total } = await (async () => {
      await failBundles(request, null);
      return fetchBundles(request);
    })();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(`${total} total`)).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('coverage refuses to report gaps it cannot compute', async ({ page, request }) => {
    await failBundles(request, 'bundle registry unreachable');

    await page.goto('/coverage');
    await expect(page.getByText('Error loading coverage')).toBeVisible();
    // Without the bundle payload every event looks uncovered, which is the
    // wrong direction for a view whose output is "go declare a bundle".
    await expect(page.getByText('Every namespace is fully covered')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);

    await failBundles(request, null);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
  });
});
