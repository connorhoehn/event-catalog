import { test, expect } from '@playwright/test';
import { armDurableFailure, publishedToDurable, resetServer, seedDlq, trackPageErrors } from './helpers';

/**
 * DLQ browser round-trips.
 *
 * Every mutation is checked twice: once on what the operator sees, and once
 * against the server — did the entry really leave the store, and did a replay
 * really hand the message back to the durable transport?
 */

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('an empty DLQ shows the reassuring empty state', async ({ page }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/dlq');

  await expect(page.getByRole('heading', { name: 'Dead-Letter Queue' })).toBeVisible();
  await expect(page.getByText('0 entries')).toBeVisible();
  await expect(page.getByText('No dead-lettered messages')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  assertNoErrors();
});

test('a seeded dead letter is rendered with its failure detail', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);
  const entry = await seedDlq(request, {
    eventName: 'billing.invoice.paid',
    error: 'handler threw: invoice 42 not found',
    attempts: 5,
    payload: { invoiceId: '42' },
  });

  await page.goto('/dlq');

  await expect(page.getByText('1 entries')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'billing.invoice.paid' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('handler threw: invoice 42 not found');
  await expect(row).toContainText(entry.deadAt);
  // Columns: [select] [event] [attempts] [dead at] [error] [actions]
  await expect(row.getByRole('cell').nth(2)).toHaveText('5');

  assertNoErrors();
});

test('replaying an entry re-publishes it to the durable transport and clears the row', async ({
  page,
  request,
}) => {
  await seedDlq(request, { eventName: 'test.beta', payload: { count: 7 }, error: 'timeout' });
  await page.goto('/dlq');

  const row = page.getByRole('row').filter({ hasText: 'test.beta' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Replay' }).click();

  // UI: the row is gone and the count drops.
  await expect(page.getByText('0 entries')).toBeVisible();
  await expect(page.getByText('No dead-lettered messages')).toBeVisible();

  // Server: the message really went back onto the queue, with its payload.
  const published = await publishedToDurable(request);
  expect(published).toHaveLength(1);
  expect(published[0].eventName).toBe('test.beta');
  expect(published[0].payload).toEqual({ count: 7 });

  // …and it is really gone from the store, not just hidden.
  const remaining = await (await request.get('/__e2e__/dlq')).json();
  expect(remaining.entries).toEqual([]);
});

test('deleting an entry drops it without re-publishing anything', async ({ page, request }) => {
  await seedDlq(request, { eventName: 'test.beta', error: 'poison payload' });
  await page.goto('/dlq');

  const row = page.getByRole('row').filter({ hasText: 'test.beta' });
  await row.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByText('No dead-lettered messages')).toBeVisible();
  expect(await publishedToDurable(request)).toEqual([]);
  expect((await (await request.get('/__e2e__/dlq')).json()).entries).toEqual([]);
});

test('batch replay reports how many entries went back onto the queue', async ({ page, request }) => {
  await seedDlq(request, { eventName: 'test.beta', payload: { count: 1 } });
  await seedDlq(request, { eventName: 'billing.invoice.paid', payload: { invoiceId: 'a' } });
  await seedDlq(request, { eventName: 'billing.invoice.paid', payload: { invoiceId: 'b' } });

  await page.goto('/dlq');
  await expect(page.getByText('3 entries')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.getByRole('button', { name: /Replay selected \(3\)/ }).click();

  await expect(page.getByRole('status')).toContainText('Replayed 3 of 3 entries.');
  await expect(page.getByText('0 entries')).toBeVisible();

  const published = await publishedToDurable(request);
  expect(published.map(p => p.eventName).sort()).toEqual([
    'billing.invoice.paid',
    'billing.invoice.paid',
    'test.beta',
  ]);
});

test('the event-name filter scopes the listing server-side', async ({ page, request }) => {
  await seedDlq(request, { eventName: 'test.beta' });
  await seedDlq(request, { eventName: 'billing.invoice.paid' });

  await page.goto('/dlq');
  await expect(page.getByText('2 entries')).toBeVisible();

  await page.getByPlaceholder('Filter by event name...').fill('billing.invoice.paid');

  await expect(page.getByText('1 entries')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'billing.invoice.paid' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'test.beta' })).toHaveCount(0);

  // A filter that matches nothing gets a scoped empty state, not a blank page.
  await page.getByPlaceholder('Filter by event name...').fill('nope.no.such.event');
  await expect(page.getByText('No DLQ entries for "nope.no.such.event".')).toBeVisible();
});

test('a failed replay surfaces the error and leaves the entry in place', async ({ page, request }) => {
  await seedDlq(request, { eventName: 'test.beta', error: 'original failure' });
  await armDurableFailure(request, 'queue unreachable');

  await page.goto('/dlq');
  await page.getByRole('row').filter({ hasText: 'test.beta' }).getByRole('button', { name: 'Replay' }).click();

  // The raw transport error is deliberately not echoed to the client — it goes
  // to the server log. The alert must still name the failure and say what to do.
  await expect(page.getByRole('alert')).toContainText('the durable transport rejected the message');
  // The dead letter is still there — a failed redrive must not lose the message.
  expect((await (await request.get('/__e2e__/dlq')).json()).entries).toHaveLength(1);
});
