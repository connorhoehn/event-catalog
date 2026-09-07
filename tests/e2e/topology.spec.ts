import { test, expect } from '@playwright/test';
import { trackPageErrors } from './helpers';

/**
 * The topology graph against real declaration data.
 *
 * The graph is a ReactFlow canvas, so the assertions are on the node labels
 * an operator can actually read, cross-checked against what GET /api/topology
 * returned — not on node counts baked into this file.
 */

test('the canvas draws every node and service the registry reports', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  const topology = (await (await request.get('/api/topology')).json()) as {
    nodes: Array<{ id: string; type: 'event' | 'service'; metadata: Record<string, unknown> }>;
    edges: Array<{ from: string; to: string; relation: string }>;
  };
  const eventNodes = topology.nodes.filter(n => n.type === 'event');
  const serviceNodes = topology.nodes.filter(n => n.type === 'service');
  expect(eventNodes.length).toBeGreaterThan(0);
  expect(serviceNodes.length).toBeGreaterThan(0);

  await page.goto('/topology');
  await expect(page.getByRole('heading', { name: 'Event Topology' })).toBeVisible();

  // Header chips are the operator's at-a-glance count.
  await expect(page.getByText(`${eventNodes.length} events`)).toBeVisible();
  await expect(page.getByText(`${serviceNodes.length} services`)).toBeVisible();

  for (const node of topology.nodes) {
    await expect(page.getByText(node.id, { exact: true })).toHaveCount(1);
  }

  // Event nodes are labelled `<transport> · <namespace>`; service nodes with
  // the role the edges imply.
  const kindCounts = new Map<string, number>();
  for (const n of eventNodes) {
    const kind = `${n.metadata.transport as string} · ${n.metadata.namespace as string}`;
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }
  expect(kindCounts.size).toBeGreaterThan(0);
  for (const [kind, count] of kindCounts) {
    await expect(page.getByText(kind, { exact: true })).toHaveCount(count);
  }
  await expect(page.getByText('service · producer', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('service · consumer', { exact: true }).first()).toBeVisible();

  // One edge per relation the API reported.
  await expect(page.locator('.react-flow__edge')).toHaveCount(topology.edges.length);

  assertNoErrors();
});

// `Registry.getTopology()` now stamps `namespace` onto every event node's
// metadata, which is what TopologyView and FlowView build their namespace
// <select> from and what NamespaceClusters uses to draw the Phase E8.4
// cluster overlay.
test(
  'the namespace filter narrows the graph via the server',
  async ({ page, request }) => {
    await page.goto('/topology');
    await expect(page.getByRole('heading', { name: 'Event Topology' })).toBeVisible();

    // The dropdown should be populated from the namespaces present in the data.
    const select = page.getByRole('combobox');
    await expect(select.locator('option')).toHaveText(['all', 'billing', 'test']);

    await select.selectOption('billing');

    const scoped = (await (await request.get('/api/topology?namespace=billing')).json()) as {
      nodes: Array<{ id: string; type: string }>;
    };
    const scopedEvents = scoped.nodes.filter(n => n.type === 'event');

    await expect(page.getByText(`${scopedEvents.length} events`)).toBeVisible();
    await expect(page.getByText('billing.invoice.paid', { exact: true })).toHaveCount(1);
    // The test namespace should be gone from the canvas.
    await expect(page.getByText('test.alpha', { exact: true })).toHaveCount(0);
  },
);

test('the server-side namespace filter really does narrow the subgraph', async ({ request }) => {
  // The endpoint the dropdown calls. Covers the server-side filter directly,
  // independent of the UI wiring exercised by the test above.
  const all = (await (await request.get('/api/topology')).json()) as { nodes: Array<{ id: string }> };
  const scoped = (await (await request.get('/api/topology?namespace=billing')).json()) as {
    nodes: Array<{ id: string; type: string }>;
  };

  expect(scoped.nodes.length).toBeLessThan(all.nodes.length);
  expect(scoped.nodes.filter(n => n.type === 'event').map(n => n.id)).toEqual(['billing.invoice.paid']);
});

test('an empty registry shows the empty state rather than a blank canvas', async ({ page }) => {
  await page.route('**/api/topology*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], edges: [] }) }),
  );

  await page.goto('/topology');
  await expect(page.getByText('No events registered yet')).toBeVisible();
  await expect(page.getByText('0 events')).toBeVisible();
});
