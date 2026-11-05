import { test, expect, type Page } from '@playwright/test';
import { seedRegistry, trackPageErrors } from './helpers';

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
 * The topology graph against the REAL registry — every declaration in
 * `src/declarations`, roughly two hundred of them, not the four-event fixture
 * the other specs run on.
 *
 * That difference is the whole point. Everything the admin has got wrong so
 * far was correct at four events: a `minZoom` floor that `fitView` could not
 * reach, a namespace overlay that turned into overlapping full-canvas slabs,
 * a dagre layout nobody had timed. None of it is visible until the graph is
 * the size it actually is in production.
 *
 * The registry is process-wide and the suite runs serially, so this file
 * swaps it in and puts the small fixture back afterwards.
 */

let realEventCount = 0;

test.beforeAll(async ({ request }) => {
  realEventCount = await seedRegistry(request, 'scale');
  expect(realEventCount).toBeGreaterThan(150);
});

test.afterAll(async ({ request }) => {
  await seedRegistry(request, 'small');
});

test('the whole catalog draws, with the counts the API reports', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: 'event' | 'service'; metadata: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string }>;
  };
  const eventNodes = topology.nodes.filter(n => n.type === 'event');
  const serviceNodes = topology.nodes.filter(n => n.type === 'service');
  expect(eventNodes.length).toBe(realEventCount);

  const t0 = Date.now();
  await page.goto('/topology');
  await expect(page.getByText(`${eventNodes.length} events`)).toBeVisible();
  await expect(page.getByText(`${serviceNodes.length} services`)).toBeVisible();
  // The canvas has to actually exist — `.view-canvas` collapsing to 0px is a
  // bug this view has shipped before, and at this size an empty canvas and a
  // slow one look identical.
  await expect(page.locator('.react-flow__renderer')).toBeVisible();
  const readyMs = Date.now() - t0;

  // Not a benchmark — a ceiling. A layout that went quadratic would blow
  // through this by an order of magnitude.
  expect(readyMs, `topology took ${readyMs}ms to draw ${eventNodes.length} events`).toBeLessThan(
    20_000,
  );

  // One edge per relation, at 400-odd of them.
  await expect(page.locator('.react-flow__edge')).toHaveCount(topology.edges.length);

  assertNoErrors();
});

test('every namespace in the real catalog is offered by the filter, and stays offered', async ({
  page,
  request,
}) => {
  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: string; metadata: Record<string, unknown> }>;
  };
  const namespaces = [
    ...new Set(
      topology.nodes.filter(n => n.type === 'event').map(n => n.metadata.namespace as string),
    ),
  ].sort();
  // The real distribution is lopsided — one namespace holds a third of the
  // catalog and another holds a single event.
  expect(namespaces.length).toBeGreaterThan(5);

  await page.goto('/topology');
  await expect.poll(() => namespaceOptions(page)).toEqual(['all', ...namespaces]);

  // Pick the smallest namespace: the filtered response mentions only that
  // one, and the dropdown used to be rebuilt from the response — so choosing
  // it deleted every other option, including the way back.
  const counts = new Map<string, number>();
  for (const n of topology.nodes) {
    if (n.type !== 'event') continue;
    const ns = n.metadata.namespace as string;
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  const smallest = [...counts.entries()].sort((a, b) => a[1] - b[1])[0]![0];

  await chooseNamespace(page, smallest);
  await expect(page.getByText(`${counts.get(smallest)} events`)).toBeVisible();
  await expect.poll(() => namespaceOptions(page)).toEqual(['all', ...namespaces]);

  // …and back to the whole graph.
  await chooseNamespace(page, 'all');
  await expect(page.getByText(`${realEventCount} events`)).toBeVisible();
});

test('fitView can actually fit the real graph', async ({ page }) => {
  await page.goto('/topology');
  await expect(page.locator('.react-flow__renderer')).toBeVisible();

  // ReactFlow writes the viewport transform onto `.react-flow__viewport`.
  // The real catalog lays out at roughly 2000 × 22000 px, so fitting it into
  // an admin viewport needs a zoom around 0.035. `minZoom` used to be 0.2:
  // fitView was clamped, and the operator landed on a fraction of the graph
  // with no way to pull back. This asserts the transform is not sitting on
  // the floor.
  const scale = await page.locator('.react-flow__viewport').evaluate(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return m.a;
  });
  expect(scale, 'fitView zoom').toBeGreaterThan(0);
  expect(scale, 'fitView was clamped by minZoom').toBeLessThan(0.2);

  // And the whole graph really is inside the viewport at that zoom: the
  // rendered node layer is no taller than the canvas that holds it.
  const fits = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__renderer') as HTMLElement | null;
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!pane || !viewport) return null;
    const p = pane.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    return { paneH: p.height, viewportH: v.height, paneW: p.width, viewportW: v.width };
  });
  expect(fits).not.toBeNull();
  expect(fits!.viewportH).toBeLessThanOrEqual(fits!.paneH + 1);
  expect(fits!.viewportW).toBeLessThanOrEqual(fits!.paneW + 1);
});

test('the namespace cluster overlay draws one box per namespace, not a pile', async ({
  page,
  request,
}) => {
  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: string; metadata: Record<string, unknown> }>;
  };
  const namespaces = new Set(
    topology.nodes.filter(n => n.type === 'event').map(n => n.metadata.namespace as string),
  );

  await page.goto('/topology');
  const overlay = page.locator('.namespace-cluster-overlay');
  await expect(overlay).toBeAttached();
  await expect(overlay.locator('rect')).toHaveCount(namespaces.size);

  // Ungrouped, dagre scattered each namespace's events down the full height
  // of the canvas, so these bounding boxes overlapped in 19 of 36 pairs and
  // told the operator nothing. Grouped, no two overlap.
  const boxes = await overlay.locator('rect').evaluateAll(els =>
    els.map(el => ({
      x: Number(el.getAttribute('x')),
      y: Number(el.getAttribute('y')),
      w: Number(el.getAttribute('width')),
      h: Number(el.getAttribute('height')),
    })),
  );
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // The boxes carry 24px of padding plus an 18px label strip, so touching
      // edges are expected; a real overlap is a substantial one.
      if (ox > 60 && oy > 60) overlaps.push(`${i}×${j}`);
    }
  }
  expect(overlaps).toEqual([]);
});
