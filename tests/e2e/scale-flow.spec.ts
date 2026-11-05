import { test, expect, type Page } from '@playwright/test';
import { emitTap, resetServer, seedRegistry, trackPageErrors, waitForFlowClients } from './helpers';

// The namespace filter is the library Select: a combobox trigger over a
// listbox portaled to <body>, not a native <select>. Its options exist only
// while it is open, so reading them opens and closes it.
async function namespaceOptions(page: Page): Promise<string[]> {
  await page.getByLabel('namespace').click();
  const labels = await page
    .getByRole('listbox')
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/^✓/, '').trim()));
  await page.keyboard.press('Escape');
  return labels;
}

async function chooseNamespace(page: Page, label: string): Promise<void> {
  await page.getByLabel('namespace').click();
  await page.getByRole('listbox').getByRole('option', { name: label, exact: true }).click();
}


/**
 * The live flow view, on the real registry, under a real burst.
 *
 * `flow-sse.spec.ts` proves the wiring on four events and a dozen taps. This
 * file asks the question that only shows up in production: with 200-odd
 * declarations on the canvas and a tap firing continuously, does the buffer
 * stay bounded, does the ticker keep up, and does the tab stay responsive?
 *
 * Every tap goes through the real `tapEmitter` and a real browser
 * `EventSource`, and every wait is on an observable server or DOM fact — no
 * sleeps, so adding a thousand events does not add a thousand milliseconds of
 * padding to the suite.
 */

function ticker(page: Page) {
  return page.locator('.flow-ticker-row');
}

function bufferChip(page: Page) {
  return page.getByText(/\d+ events in buffer/);
}

/** The MAX_BUFFER cap in useFlowTap. */
const MAX_BUFFER = 200;

let realEventCount = 0;
let eventNames: string[] = [];

test.beforeAll(async ({ request }) => {
  realEventCount = await seedRegistry(request, 'scale');
  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: string }>;
  };
  eventNames = topology.nodes.filter(n => n.type === 'event').map(n => n.id);
  expect(eventNames.length).toBe(realEventCount);
});

test.afterAll(async ({ request }) => {
  await seedRegistry(request, 'small');
});

test('the flow graph draws the whole catalog before a single tap arrives', async ({
  page,
  request,
}) => {
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/flow');
  await expect(page.getByRole('heading', { name: 'Live Flow' })).toBeVisible();
  await expect(page.locator('.react-flow__renderer')).toBeVisible();

  const topology = (await (await request.get('/api/topology')).json()) as {
    edges: Array<unknown>;
  };
  await expect(page.locator('.react-flow__edge')).toHaveCount(topology.edges.length);
  await expect(bufferChip(page)).toHaveText('0 events in buffer');
  assertNoErrors();
});

test('a burst of 1000 taps leaves the buffer capped and the tab alive', async ({
  page,
  request,
}) => {
  const assertNoErrors = trackPageErrors(page);
  await resetServer(request);
  // resetServer restores the small fixture, so put the real one back.
  await seedRegistry(request, 'scale');

  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  // Spread across many distinct events so the pulse touches a large slice of
  // the 400-odd edges, which is what a real incident looks like.
  const sample = eventNames.filter((_, i) => i % 7 === 0).slice(0, 40);
  const t0 = Date.now();
  for (const name of sample) {
    await emitTap(request, { eventName: name, count: 25 });
  }
  const emitMs = Date.now() - t0;

  // The bound the hook documents. 1000 frames in, the buffer must be at its
  // cap — not at 1000, and not still climbing.
  await expect(bufferChip(page)).toHaveText(`${MAX_BUFFER} events in buffer`, { timeout: 20_000 });
  // The ticker shows the last ten and only the last ten. A list that
  // re-appended its history is exactly the bug this pins.
  await expect(ticker(page)).toHaveCount(10);
  await expect(ticker(page).first()).toContainText(sample[sample.length - 1]!);

  // The page is still answering. `evaluate` runs on the main thread, so a
  // pinned CPU shows up here as a timeout rather than as a vague "it felt
  // slow" — this is the whole reason the render path was reworked.
  const t1 = Date.now();
  await page.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
  const responseMs = Date.now() - t1;
  expect(responseMs, `main thread took ${responseMs}ms to answer after ${emitMs}ms of taps`)
    .toBeLessThan(5_000);

  assertNoErrors();
});

test('pausing under load detaches the stream and freezes the buffer', async ({ page, request }) => {
  await page.goto('/flow');
  await waitForFlowClients(request, 1);

  await emitTap(request, { eventName: eventNames[0]!, count: 50 });
  await expect(bufferChip(page)).toHaveText('50 events in buffer');

  await page.getByRole('button', { name: 'Pause' }).click();
  await waitForFlowClients(request, 0);

  await emitTap(request, { eventName: eventNames[1]!, count: 500 });
  // Genuinely missed, not queued — a paused view that silently backfills is
  // worse than one that admits the gap.
  await expect(bufferChip(page)).toHaveText('50 events in buffer');

  await page.getByRole('button', { name: 'Resume' }).click();
  await waitForFlowClients(request, 1);
  await emitTap(request, { eventName: eventNames[2]! });
  await expect(bufferChip(page)).toHaveText('51 events in buffer');
});

test('the namespace filter narrows a live firehose to one namespace', async ({ page, request }) => {
  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: string; metadata: Record<string, unknown> }>;
  };
  const byNs = new Map<string, string[]>();
  for (const n of topology.nodes) {
    if (n.type !== 'event') continue;
    const ns = n.metadata.namespace as string;
    byNs.set(ns, [...(byNs.get(ns) ?? []), n.id]);
  }
  // A namespace small enough that "only these events arrive" is a real claim.
  const [smallNs, members] = [...byNs.entries()].sort((a, b) => a[1].length - b[1].length)[0]!;
  const outsider = [...byNs.entries()].find(([ns]) => ns !== smallNs)![1][0]!;

  const allNamespaces = [...byNs.keys()].sort();

  await page.goto('/flow');
  await waitForFlowClients(request, 1);
  await expect.poll(() => namespaceOptions(page)).toEqual(['all', ...allNamespaces]);

  await chooseNamespace(page, smallNs);
  await waitForFlowClients(request, 1);
  // Narrowing the graph must not empty the control that narrowed it. The
  // filtered topology mentions one namespace, and the options used to be
  // rebuilt from it — so choosing one deleted the other eight.
  await expect.poll(() => namespaceOptions(page)).toEqual(['all', ...allNamespaces]);

  await emitTap(request, { eventName: outsider, count: 30 });
  await emitTap(request, { eventName: members[0]!, count: 2 });

  // Only the in-namespace taps land — the server does the filtering, and 30
  // frames of the wrong namespace must not reach the ticker.
  await expect(bufferChip(page)).toHaveText('2 events in buffer');
  await expect(ticker(page)).toHaveCount(2);
  await expect(ticker(page).first()).toContainText(members[0]!);
});
