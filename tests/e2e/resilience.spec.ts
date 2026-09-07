import { test, expect } from '@playwright/test';
import { emitTap, killFlowStreams, resetServer, trackPageErrors, waitForFlowClients } from './helpers';

/**
 * Negative paths. The bar for all of these is the same: the admin UI degrades
 * into something an operator can read and navigate away from. A white screen
 * (React tearing down the tree on an uncaught error) is a failure, and
 * `trackPageErrors` is what turns that into a named one rather than a
 * confusing locator timeout.
 */

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('the flow view survives an SSE stream that never opens', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);

  // A 500 makes EventSource give up for good (readyState CLOSED) rather than
  // sit in a reconnect loop, which is the case the hook reports.
  await page.route('**/api/flow*', route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );

  await page.goto('/flow');

  // The graph half of the page is independent of the tap and must still draw.
  await expect(page.getByRole('heading', { name: 'Live Flow' })).toBeVisible();
  await expect(page.getByText('test.alpha', { exact: true })).toHaveCount(1);
  // …and the failure is surfaced instead of swallowed.
  await expect(page.getByText('SSE connection closed')).toBeVisible();
  await expect(page.getByText('Waiting for events…')).toBeVisible();

  assertNoErrors();
});

test('a stream dropped by the server reconnects and keeps its buffer', async ({ page, request }) => {
  test.slow(); // EventSource backs off before reconnecting.
  const assertNoErrors = trackPageErrors(page);

  await page.goto('/flow');
  await waitForFlowClients(request, 1);
  await emitTap(request, { eventName: 'test.alpha' });
  await expect(page.getByText('1 events in buffer')).toBeVisible();

  // Sever the live response from underneath the browser.
  expect(await killFlowStreams(request)).toBe(1);
  await waitForFlowClients(request, 0);

  // Degraded, not broken: the page keeps what it already received and the
  // graph is still there.
  await expect(page.getByText('1 events in buffer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live Flow' })).toBeVisible();
  await expect(page.getByText('test.alpha', { exact: true }).first()).toBeVisible();

  // EventSource reconnects on its own; the next publish lands again.
  await waitForFlowClients(request, 1, 30_000);
  await emitTap(request, { eventName: 'test.gamma' });
  await expect(page.getByText('2 events in buffer')).toBeVisible();

  assertNoErrors();
});

test('an unreachable server leaves the dashboard readable and navigable', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.route('**/api/**', route => route.abort('connectionrefused'));

  await page.goto('/');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Error');
  // The shell is intact — the operator can still get somewhere else.
  await expect(page.getByRole('link', { name: 'Topology' })).toBeVisible();

  assertNoErrors();
});

test('a failing topology endpoint shows an error banner, not an empty canvas', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.route('**/api/topology*', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"registry unavailable"}' }),
  );

  await page.goto('/topology');

  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByText('registry unavailable')).toBeVisible();

  // Navigating away still works.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  assertNoErrors();
});

test('an unknown deep link serves the shell instead of a 404 body', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);

  const response = await page.goto('/no/such/page');
  expect(response?.status()).toBe(200);

  await expect(page.getByRole('heading', { name: 'Event Catalog' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

  assertNoErrors();
});
