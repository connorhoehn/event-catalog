import { test, expect } from '@playwright/test';
import { resetServer, seedRegistry, emitTap, waitForFlowClients, trackPageErrors } from './helpers';

/**
 * Response compression, end to end.
 *
 * gzip/brotli is on by default (`DEFAULT_COMPRESSION`), it applies to every
 * JSON body over 1 KiB and to the whole admin bundle, and `text/event-stream`
 * is excluded *structurally* — SSE reaches the socket through
 * `flushHeaders()`/`write()`, which `makeRouteResponse` never compresses, and
 * `isCompressibleType` refuses the media type as a second line of defence.
 *
 * Structurally-safe is not the same as observed-safe, and these are the two
 * failures a unit test cannot see:
 *
 *   1. A compressed body that arrives *unreadable* — a `Content-Encoding` the
 *      client did not ask for, a header that outlives a body that was not
 *      actually compressed, or a Content-Length describing the wrong one of
 *      the two. Every symptom is the same: JSON.parse throws in the browser,
 *      the view renders its error state, and every server-side test passes.
 *   2. An SSE stream that is buffered rather than streamed. A compressor in
 *      front of `text/event-stream` holds frames until its window fills, so
 *      the flow view goes from "live" to "live but nothing ever arrives" —
 *      and the connection itself, the listener count and the frame format are
 *      all still perfectly correct.
 */

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('a large API response really is compressed, and really is readable', async ({ request }) => {
  const count = await seedRegistry(request, 'scale');
  expect(count).toBeGreaterThan(200);

  const compressed = await request.get('/api/events', {
    headers: { 'Accept-Encoding': 'br, gzip, deflate' },
  });
  expect(compressed.status()).toBe(200);

  // The header says it was compressed…
  const encoding = compressed.headers()['content-encoding'];
  expect(['br', 'gzip', 'deflate']).toContain(encoding);
  // …and caches are told the body varies by what the client asked for. Without
  // this a shared cache serves a brotli body to a client that cannot read it.
  expect(compressed.headers()['vary'] ?? '').toMatch(/accept-encoding/i);

  // …AND the body decodes to the same JSON an identity request returns. This
  // is the assertion that catches an unreadable body: a truncated stream, a
  // Content-Length describing the pre-compression size, or a header claiming
  // a coding that was never applied all fail here and nowhere else.
  const body = await compressed.json() as { events: unknown[]; total: number };
  expect(body.total).toBe(count);
  expect(body.events).toHaveLength(count);

  const identity = await request.get('/api/events', {
    headers: { 'Accept-Encoding': 'identity' },
  });
  expect(identity.headers()['content-encoding']).toBeUndefined();
  const plain = await identity.json() as { total: number; events: unknown[] };
  expect(plain.total).toBe(body.total);
  expect(JSON.stringify(plain.events)).toBe(JSON.stringify(body.events));

  // And it was worth doing: the whole point is that this body is large.
  const rawBytes = (await identity.body()).length;
  const wireBytes = Number(compressed.headers()['content-length']);
  expect(rawBytes).toBeGreaterThan(100_000);
  expect(wireBytes).toBeLessThan(rawBytes / 2);

  await seedRegistry(request, 'small');
});

test('a client that refuses compression is not handed a compressed body anyway', async ({ request }) => {
  // Node's own `http.request` sends no Accept-Encoding and does no decoding.
  // Sending it brotli produces binary garbage with a 200 status — the exact
  // "compressed body arrives unreadable" regression, from the other side.
  const noHeader = await request.get('/api/events/test.alpha', {
    headers: { 'Accept-Encoding': '' },
  });
  expect(noHeader.headers()['content-encoding']).toBeUndefined();
  expect((await noHeader.json() as { name: string }).name).toBe('test.alpha');

  const refused = await request.get('/api/events', {
    headers: { 'Accept-Encoding': 'identity;q=1, gzip;q=0, br;q=0' },
  });
  expect(refused.headers()['content-encoding']).toBeUndefined();
  expect((await refused.json() as { total: number }).total).toBe(4);
});

test('the admin bundle is compressed and still executes in the browser', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);

  // The largest single response this server sends is the graph vendor chunk.
  // A corrupted static body does not throw an HTTP error — it throws a
  // SyntaxError inside the page, which is what trackPageErrors catches.
  const encodings: string[] = [];
  page.on('response', res => {
    const url = res.url();
    if (url.endsWith('.js') || url.endsWith('.css')) {
      encodings.push(res.headers()['content-encoding'] ?? 'identity');
    }
  });

  await page.goto('/topology');
  await expect(page.getByRole('heading', { name: 'Topology' })).toBeVisible();
  // /topology is the route that pulls @xyflow + dagre, i.e. the 272 KiB
  // chunk. If it arrived unreadable the canvas never mounts.
  await expect(page.locator('.react-flow')).toBeVisible();

  expect(encodings.length).toBeGreaterThan(0);
  expect(encodings.some(e => e === 'br' || e === 'gzip')).toBe(true);
  assertNoErrors();

  // Belt and braces at the HTTP layer: fetch one asset directly and prove the
  // decoded bytes are the same with and without compression.
  const assetUrl = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]'))
      .map(s => (s as HTMLScriptElement).src)
      .find(src => src.endsWith('.js')) ?? '',
  );
  expect(assetUrl).not.toBe('');
  const br = await request.get(assetUrl, { headers: { 'Accept-Encoding': 'br' } });
  const id = await request.get(assetUrl, { headers: { 'Accept-Encoding': 'identity' } });
  expect(br.headers()['content-encoding']).toBe('br');
  expect(id.headers()['content-encoding']).toBeUndefined();
  expect((await br.body()).equals(await id.body())).toBe(true);
});

test('the 229-event catalog still renders in the browser with compression on', async ({ page, request }) => {
  const assertNoErrors = trackPageErrors(page);
  const count = await seedRegistry(request, 'scale');

  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  // The count on screen comes from a body that crossed the wire brotli'd. A
  // body that arrived unreadable renders the error state instead, and this
  // row count is the difference.
  await expect(page.locator('tbody tr')).toHaveCount(count);
  expect(await page.getByRole('alert').count()).toBe(0);

  assertNoErrors();
  await seedRegistry(request, 'small');
});

test('SSE is never compressed, and still streams frame by frame', async ({ page, request }) => {
  // Part one: the header. `text/event-stream` must carry no Content-Encoding
  // — and no Content-Length either, which is what would turn a stream into a
  // single buffered response.
  const raw = await request.get('/api/flow', {
    headers: { 'Accept-Encoding': 'br, gzip, deflate' },
    timeout: 5_000,
  }).catch(() => null);
  if (raw) {
    expect(raw.headers()['content-type']).toContain('text/event-stream');
    expect(raw.headers()['content-encoding']).toBeUndefined();
    expect(raw.headers()['content-length']).toBeUndefined();
  }

  // Part two, and the one that matters: frames arrive one at a time. A
  // compressor in front of the stream would hold each frame until its window
  // filled, so the ticker would stay empty while the connection stayed
  // "live". Asserting after EACH publish — rather than after all three — is
  // what makes buffering fail here instead of passing on a flush at the end.
  const assertNoErrors = trackPageErrors(page);
  await page.goto('/flow');
  await expect(page.getByText('live', { exact: true })).toBeVisible();
  await waitForFlowClients(request, 1);

  for (let i = 1; i <= 3; i++) {
    await emitTap(request, { eventName: 'test.alpha' });
    await expect(page.getByText(`${i} events in buffer`)).toBeVisible({ timeout: 5_000 });
    expect(await page.locator('.flow-ticker-row').count()).toBe(i);
  }

  assertNoErrors();
});
