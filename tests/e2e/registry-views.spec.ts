import { test, expect } from '@playwright/test';
import { collectionSearch, trackPageErrors } from './helpers';

/**
 * Namespaces and Subscribers, rendered against the live registry rather than
 * a fixture JSON blob. Both views are pure read paths over endpoints the unit
 * suite covers in isolation; what's untested is that the browser asks for the
 * right thing and renders what comes back.
 */

test('the namespace grid rolls up what /api/namespaces/summary reports', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const summary = (await (await request.get('/api/namespaces/summary?detail=full')).json()) as {
    items: Array<{
      namespace: string;
      eventCount: number;
      signalCount: number;
      durableCount: number;
      producerCount: number;
      subscriberCount: number;
      events: Array<{ name: string; transport: string }>;
    }>;
  };
  expect(summary.items.length).toBeGreaterThan(1);

  await page.goto('/namespaces');
  await expect(page.getByRole('heading', { name: 'Namespaces' })).toBeVisible();
  await expect(page.getByText(`${summary.items.length} total`)).toBeVisible();

  for (const ns of summary.items) {
    const card = page.getByRole('button').filter({ hasText: ns.namespace });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`${ns.eventCount} events`);
    await expect(card).toContainText(
      `${ns.producerCount} producer${ns.producerCount === 1 ? '' : 's'}`,
    );
  }

  assertNoErrors();
});

test('expanding a namespace lists its events and links through to detail', async ({ page, request }) => {
  const summary = (await (await request.get('/api/namespaces/summary?detail=full')).json()) as {
    items: Array<{ namespace: string; events: Array<{ name: string }> }>;
  };
  const testNs = summary.items.find(i => i.namespace === 'test')!;
  expect(testNs.events.length).toBe(3);

  await page.goto('/namespaces');
  await page.getByRole('button').filter({ hasText: 'test' }).click();

  for (const ev of testNs.events) {
    await expect(page.getByRole('link', { name: ev.name })).toBeVisible();
  }

  await page.getByRole('link', { name: 'test.gamma' }).click();
  await expect(page).toHaveURL(/\/events\/test\.gamma$/);
  await expect(page.getByRole('heading', { name: 'test.gamma' })).toBeVisible();
});

test('the namespace filter box narrows the grid', async ({ page }) => {
  await page.goto('/namespaces');
  await expect(page.getByRole('button').filter({ hasText: 'billing' })).toHaveCount(1);

  await (await collectionSearch(page, 'Filter by namespace…')).fill('bill');
  await expect(page.getByRole('button').filter({ hasText: 'billing' })).toHaveCount(1);
  await expect(page.getByRole('button').filter({ hasText: 'test' })).toHaveCount(0);

  await (await collectionSearch(page, 'Filter by namespace…')).fill('zzz');
  await expect(page.getByText('No namespace matches "zzz".')).toBeVisible();
});

test('subscribers view lists every registered consumer as fresh', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const { subscribers } = (await (await request.get('/api/subscribers')).json()) as {
    subscribers: Array<{ eventName: string; serviceName: string }>;
  };
  expect(subscribers.length).toBeGreaterThan(0);

  await page.goto('/subscribers');
  await expect(page.getByRole('heading', { name: 'Subscribers' })).toBeVisible();

  // Everything was registered at boot, so every row is inside the 5-minute
  // freshness window.
  await expect(page.getByText(`${subscribers.length} fresh`)).toBeVisible();
  await expect(page.getByText('0 stale')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(subscribers.length + 1); // + header

  for (const sub of subscribers) {
    const row = page.getByRole('row').filter({ hasText: sub.serviceName }).filter({ hasText: sub.eventName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('fresh');
  }

  assertNoErrors();
});

test('filtering subscribers to stale yields the scoped empty state', async ({ page }) => {
  await page.goto('/subscribers');
  await page.getByRole('button', { name: 'stale', exact: true }).click();

  await expect(page.getByText('No subscribers in this view')).toBeVisible();
  await expect(page.getByText('No stale subscribers — try a different filter.')).toBeVisible();

  await page.getByRole('button', { name: 'all', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
});
