import { test, expect } from '@playwright/test';
import { trackPageErrors } from './helpers';

/**
 * Golden-path smoke over the real server + the real built admin bundle.
 *
 * Fixture (tests/e2e/test-server.ts): 4 events across 2 namespaces, 6
 * services, one orphan event with no subscribers.
 */

test('dashboard rolls up the registry the server actually serves', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // The counts on the cards must agree with GET /api/events, not with a
  // number hard-coded here — that keeps the assertion meaningful if the
  // fixture grows.
  const events = (await (await request.get('/api/events')).json()).events as Array<{
    transport: string;
    producer: string;
  }>;
  const signal = events.filter(e => e.transport === 'signal').length;
  const durable = events.filter(e => e.transport === 'durable').length;
  const producers = new Set(events.map(e => e.producer)).size;

  await expect(page.getByText('Registered Events').locator('..')).toContainText(String(events.length));
  await expect(page.getByText('Signal (Ephemeral)').locator('..')).toContainText(String(signal));
  await expect(page.getByText('Durable (At-Least-Once)').locator('..')).toContainText(String(durable));
  await expect(page.getByText('Services', { exact: true }).locator('..')).toContainText(String(producers));

  // test.beta is the fixture's orphan; the lifecycle rollup must notice.
  await expect(page.getByText('Orphans (no subscribers)')).toBeVisible();

  assertNoErrors();
});

test('event detail deep-link survives the SPA fallback and shows the schema', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);
  // A hard navigation to a nested path — this only works if the server's
  // SPA fallback serves index.html for unknown paths.
  await page.goto('/events/billing.invoice.paid');

  await expect(page.getByRole('heading', { name: 'billing.invoice.paid' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schema' })).toBeVisible();
  // The schema body is the real declaration served by GET /api/events/:name.
  await expect(page.getByText('invoiceId')).toBeVisible();
  await expect(page.getByText('amountCents')).toBeVisible();

  assertNoErrors();
});

test('transports view reports both transport backends as connected', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/transports');

  await expect(page.getByText('Redis (Signal Transport)')).toBeVisible();
  await expect(page.getByText('Message Queue (Durable Transport)')).toBeVisible();

  assertNoErrors();
});

test('every nav destination renders without an uncaught error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(`${page.url()} :: ${err.message}`));

  const routes = [
    '/',
    '/events',
    '/namespaces',
    '/declarations',
    '/topology',
    '/bundles',
    '/coverage',
    '/flow',
    '/audit',
    '/subscribers',
    '/live',
    '/dlq',
    '/transports',
  ];

  for (const route of routes) {
    await page.goto(route);
    // The AppShell nav is the shell; if React tore the tree down it goes with it.
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
    // Each view's page template owns a heading (h1, or h2 on a detail
    // page); waiting on one proves the lazy chunk resolved and the route
    // rendered rather than sitting on the Suspense skeleton.
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test('the server keeps /health for itself — the SPA must not claim it', async ({ page, request }) => {
  // The Transports view used to live at '/health', the exact path the server
  // serves its health JSON on from the same origin. Deep-linking or reloading
  // that view returned raw JSON instead of the UI. The SPA route is
  // '/transports' now; this pins both halves so neither can drift back.
  const raw = await request.get('/health');
  expect(raw.ok()).toBe(true);
  expect(raw.headers()['content-type'] ?? '').toContain('json');
  expect((await raw.json()).service).toBe('event-catalog');

  await page.goto('/transports');
  await expect(page.getByText('Redis (Signal Transport)')).toBeVisible();
});
