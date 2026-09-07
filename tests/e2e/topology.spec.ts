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

  // Event nodes are labelled with their transport; service nodes with the
  // role the edges imply.
  const signalCount = eventNodes.filter(n => n.metadata.transport === 'signal').length;
  const durableCount = eventNodes.filter(n => n.metadata.transport === 'durable').length;
  await expect(page.getByText('signal', { exact: true })).toHaveCount(signalCount);
  await expect(page.getByText('durable', { exact: true })).toHaveCount(durableCount);
  await expect(page.getByText('service · producer', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('service · consumer', { exact: true }).first()).toBeVisible();

  // One edge per relation the API reported.
  await expect(page.locator('.react-flow__edge')).toHaveCount(topology.edges.length);

  assertNoErrors();
});

// KNOWN DEFECT — `Registry.getTopology()` (src/registry/index.ts) builds event
// nodes with `metadata: { transport, description }` and no `namespace`. Both
// TopologyView and FlowView derive their namespace <select> options — and
// NamespaceClusters derives the whole Phase E8.4 cluster overlay — from
// `node.metadata.namespace`, so today the dropdown only ever offers "all" and
// no cluster is ever drawn, even though GET /api/topology?namespace=… filters
// correctly server-side. Marked `fail` so the suite stays honest: it flips to
// a failure the moment the metadata is added, at which point delete this
// annotation.
test.fail(
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
  // The endpoint the (currently unreachable) dropdown would call. Keeps the
  // filter itself covered while the UI wiring is broken.
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
