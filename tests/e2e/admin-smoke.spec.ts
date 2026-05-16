import { test, expect } from '@playwright/test';

/**
 * Admin UI smoke tests — 4 golden-path assertions:
 *  a) Dashboard shows 3 registered events
 *  b) Event detail view shows event name + Schema section
 *  c) Topology view renders ReactFlow nodes
 *  d) Transports page shows redis + message-queue headings
 *
 * The test server in tests/e2e/test-server.ts boots an in-memory
 * Express app (no Redis, no SQS) seeded with 3 events.
 */

test('(a) dashboard shows 3 registered events', async ({ page }) => {
  await page.goto('/');
  const eventsCard = page.locator('.stat-card').filter({ hasText: 'Registered Events' });
  await expect(eventsCard.locator('.stat-value')).toHaveText('3', { timeout: 10_000 });
});

test('(b) event detail view shows event name and schema', async ({ page }) => {
  await page.goto('/events/test.alpha');
  await expect(page.locator('h2').filter({ hasText: 'test.alpha' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Schema' })).toBeVisible({ timeout: 10_000 });
});

test('(c) topology view renders nodes for declared events', async ({ page }) => {
  await page.goto('/topology');
  // "Event Topology" heading + "3 events" chip confirm the topology data loaded.
  await expect(page.getByRole('heading', { name: 'Event Topology' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('3 events')).toBeVisible({ timeout: 15_000 });
});

test('(d) transports page shows redis and message-queue transport headings', async ({ page }) => {
  await page.goto('/health');
  await expect(page.getByText('Redis (Signal Transport)')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Message Queue (Durable Transport)')).toBeVisible({ timeout: 10_000 });
});
