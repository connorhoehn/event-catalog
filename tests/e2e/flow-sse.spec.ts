import { test, expect, type Page } from '@playwright/test';
import { emitTap, resetServer, trackPageErrors, waitForFlowClients } from './helpers';

/**
 * Phase E8 — the live flow view, end to end.
 *
 * This is the one part of the system unit tests structurally cannot reach:
 * a real SSE response from `GET /api/flow`, a real browser `EventSource`,
 * and the React view that renders what arrives. Every assertion below is on
 * what an operator would see in the ticker or the toolbar chips.
 *
 * Determinism note: `tapEmitter` has no replay buffer, so a tap published
 * before the browser has attached is lost forever. Every test gates on the
 * server's real listener count (`waitForFlowClients`) instead of sleeping.
 */

/** The ticker rows, newest first, as plain text. */
function ticker(page: Page) {
  return page.locator('.flow-ticker-row');
}

/** The "N events in buffer" chip. */
function bufferChip(page: Page) {
  return page.getByText(/\d+ events in buffer/);
}

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('an event published on the server appears in the live ticker', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  await page.goto('/flow');
  await expect(page.getByRole('heading', { name: 'Live Flow' })).toBeVisible();
  await expect(page.getByText('live', { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting for events…')).toBeVisible();
  await expect(bufferChip(page)).toHaveText('0 events in buffer');

  // Only now is the EventSource guaranteed attached to the tap.
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.alpha', envelope: { id: 'evt-1' } });

  await expect(ticker(page)).toHaveCount(1);
  const row = ticker(page).first();
  await expect(row).toContainText('test.alpha');
  await expect(row).toContainText('signal');
  await expect(row).toContainText('test-svc');
  await expect(bufferChip(page)).toHaveText('1 events in buffer');
  await expect(page.getByText('Waiting for events…')).toBeHidden();

  assertNoErrors();
});

test('the ticker keeps ordering and caps its visible rows at ten', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  for (let i = 0; i < 12; i++) {
    await emitTap(request, { eventName: i % 2 === 0 ? 'test.alpha' : 'billing.invoice.paid' });
  }

  // Buffer keeps everything; the ticker shows only the most recent ten.
  await expect(bufferChip(page)).toHaveText('12 events in buffer');
  await expect(ticker(page)).toHaveCount(10);

  // Newest first: the 12th tap (i=11) was billing.invoice.paid, durable.
  await expect(ticker(page).first()).toContainText('billing.invoice.paid');
  await expect(ticker(page).first()).toContainText('durable');
  await expect(ticker(page).first()).toContainText('billing-svc');
});

test('pause detaches the SSE stream server-side; resume re-attaches it', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.alpha' });
  await expect(bufferChip(page)).toHaveText('1 events in buffer');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('paused', { exact: true })).toBeVisible();
  // The real proof of a pause: the server no longer has a listener.
  await waitForFlowClients(request, 0);

  // Anything published while paused is genuinely missed, not queued.
  await emitTap(request, { eventName: 'test.gamma', count: 3 });
  await expect(bufferChip(page)).toHaveText('1 events in buffer');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('live', { exact: true })).toBeVisible();
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.gamma' });
  await expect(bufferChip(page)).toHaveText('2 events in buffer');
  await expect(ticker(page).first()).toContainText('test.gamma');
});

test('clear empties the buffer without dropping the stream', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.alpha', count: 3 });
  await expect(bufferChip(page)).toHaveText('3 events in buffer');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(bufferChip(page)).toHaveText('0 events in buffer');
  await expect(page.getByText('Waiting for events…')).toBeVisible();

  // Still live — a subsequent publish lands.
  await waitForFlowClients(request, 1);
  await emitTap(request, { eventName: 'test.alpha' });
  await expect(bufferChip(page)).toHaveText('1 events in buffer');
});

// KNOWN DEFECT — see the matching note in topology.spec.ts. FlowView builds
// its namespace <select> from `topology.nodes[].metadata.namespace`, which
// `Registry.getTopology()` never sets, so "billing" is not an option to pick
// and the tap can never be narrowed from the UI. The /api/flow handler's
// namespace filter itself is fine.
test.fail('the namespace filter is applied by the server, not the browser', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  // Selecting a namespace should re-open the stream with ?namespace=billing.
  const select = page.getByRole('combobox');
  await expect(select.locator('option')).toHaveText(['all', 'billing', 'test'], { timeout: 5_000 });
  await select.selectOption('billing');
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.alpha' });
  await emitTap(request, { eventName: 'billing.invoice.paid' });

  await expect(ticker(page)).toHaveCount(1);
  await expect(ticker(page).first()).toContainText('billing.invoice.paid');
  await expect(bufferChip(page)).toHaveText('1 events in buffer');
});

test('the sample knob drops events server-side at 1-in-N', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  // sample=2 → the /api/flow handler forwards every 2nd matching event.
  await page.getByRole('spinbutton').fill('2');
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: 'test.alpha', count: 4 });

  await expect(bufferChip(page)).toHaveText('2 events in buffer');
  await expect(ticker(page)).toHaveCount(2);
});

test('the flow graph renders the same topology the API reports', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/flow');

  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: string }>;
  };

  // Every node the API describes is drawn on the canvas. No taps have been
  // published in this test, so the ticker is empty and each name appears
  // exactly once — on its node.
  for (const node of topology.nodes) {
    await expect(page.getByText(node.id, { exact: true })).toHaveCount(1);
  }

  assertNoErrors();
});
