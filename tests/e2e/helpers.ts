// Shared helpers for the e2e specs.
//
// Everything here talks to the `/__e2e__` control plane in test-server.ts.
// Not a spec file — playwright.config.ts only collects `*.spec.ts`.

import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TapInput {
  eventName?: string;
  namespace?: string;
  producer?: string;
  transport?: 'signal' | 'durable';
  timestamp?: string;
  envelope?: unknown;
  /** Emit the same event N times. */
  count?: number;
}

/** Wipe DLQ + recorded publishes and restore the four-event fixture. */
export async function resetServer(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__e2e__/reset');
  expect(res.ok()).toBeTruthy();
}

/**
 * Swap the server's registry between the four-event fixture and the real
 * ~225 declarations from `src/declarations`.
 *
 * The specs share one server process and run serially, so a spec that seeds
 * `scale` MUST restore `small` in an `afterAll` — every other spec asserts
 * exact counts against the small fixture. `resetServer` restores it too, so a
 * crashed scale spec cannot poison the rest of the suite.
 */
export async function seedRegistry(
  request: APIRequestContext,
  mode: 'small' | 'scale',
): Promise<number> {
  const res = await request.post('/__e2e__/registry', { data: { mode } });
  expect(res.ok(), `failed to seed the ${mode} registry`).toBeTruthy();
  return (await res.json()).events as number;
}

/**
 * Block until the server sees `expected` SSE clients on the flow tap.
 *
 * This is the linchpin of the flow specs: `tapEmitter` has no replay buffer,
 * so an event published before the browser's EventSource has attached is
 * simply lost. Polling the real listener count removes the race without a
 * single arbitrary sleep.
 */
export async function waitForFlowClients(
  request: APIRequestContext,
  expected = 1,
  timeoutMs = 15_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get('/__e2e__/flow/clients');
        if (!res.ok()) return -1;
        return (await res.json()).clients as number;
      },
      { timeout: timeoutMs, message: `expected ${expected} SSE client(s) on /api/flow` },
    )
    .toBe(expected);
}

/** Publish through the real tap emitter — the same call MetricsObserver makes. */
export async function emitTap(request: APIRequestContext, input: TapInput = {}): Promise<void> {
  const res = await request.post('/__e2e__/tap', { data: input });
  expect(res.ok()).toBeTruthy();
}

export interface SeededDlqEntry {
  id: string;
  eventName: string;
  error: string;
  attempts: number;
  deadAt: string;
}

export async function seedDlq(
  request: APIRequestContext,
  input: { eventName?: string; error?: string; attempts?: number; payload?: unknown } = {},
): Promise<SeededDlqEntry> {
  const res = await request.post('/__e2e__/dlq', { data: input });
  expect(res.status()).toBe(201);
  return (await res.json()) as SeededDlqEntry;
}

/** What the durable transport stub was actually handed, newest last. */
export async function publishedToDurable(
  request: APIRequestContext,
): Promise<Array<{ queue: string; eventName: string; payload: unknown }>> {
  const res = await request.get('/__e2e__/durable/published');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).published;
}

/** Sever every live `GET /api/flow` response from the server side. */
export async function killFlowStreams(request: APIRequestContext): Promise<number> {
  const res = await request.post('/__e2e__/flow/kill');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).killed as number;
}

/** Arm a one-shot failure on the next durable publish. */
export async function armDurableFailure(request: APIRequestContext, message: string): Promise<void> {
  const res = await request.post('/__e2e__/durable/fail-next', { data: { message } });
  expect(res.ok()).toBeTruthy();
}

// ─── FeatureBundles ─────────────────────────────────────────────────────────

export interface BundleMemberRef {
  name: string;
  version?: number;
  required?: boolean;
}

export interface ServerBundle {
  name: string;
  version: string;
  fingerprint: string;
  transport: 'signal' | 'durable' | 'both';
  description?: string;
  events: BundleMemberRef[];
  deprecated?: { since: string; replacement?: string };
}

export interface ServerEvent {
  name: string;
  namespace?: string;
  transport: string;
  producer: string | string[];
}

/**
 * A bundle member is required unless it says otherwise — the same asymmetry
 * `src/admin/src/api.ts#isRequired` encodes, restated here so the spec does
 * not read its expectations out of the code under test.
 */
export function memberIsRequired(ref: BundleMemberRef): boolean {
  return ref.required !== false;
}

/** What `GET /api/feature-bundles` actually holds right now. */
export async function fetchBundles(request: APIRequestContext): Promise<{
  bundles: ServerBundle[];
  total: number;
}> {
  const res = await request.get('/api/feature-bundles');
  expect(res.ok(), 'GET /api/feature-bundles failed').toBeTruthy();
  return (await res.json()) as { bundles: ServerBundle[]; total: number };
}

/** What `GET /api/events` actually holds right now. */
export async function fetchEvents(request: APIRequestContext): Promise<ServerEvent[]> {
  const res = await request.get('/api/events');
  expect(res.ok(), 'GET /api/events failed').toBeTruthy();
  return ((await res.json()) as { events: ServerEvent[] }).events;
}

/**
 * Point `/api/feature-bundles` at the declared bundles (`real`) or at a
 * registry that genuinely holds none (`empty`).
 *
 * The whole reason this switch exists: an empty registry and a broken one
 * looked identical in the admin for months. A spec has to be able to produce
 * each state on the real server to prove they no longer do.
 */
export async function setBundleRegistry(
  request: APIRequestContext,
  mode: 'real' | 'empty',
): Promise<number> {
  const res = await request.post('/__e2e__/bundles', { data: { mode } });
  expect(res.ok(), `failed to switch the bundle registry to ${mode}`).toBeTruthy();
  return (await res.json()).total as number;
}

/** Make `/api/feature-bundles*` fail until called again with `null`. */
export async function failBundles(
  request: APIRequestContext,
  message: string | null,
): Promise<void> {
  const res = await request.post('/__e2e__/bundles/fail', { data: { message } });
  expect(res.ok()).toBeTruthy();
}

/**
 * Start collecting uncaught page errors. Returned callback asserts none were
 * raised — this is what turns "the view white-screened" from a confusing
 * locator timeout into a named failure.
 */
export function trackPageErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  return () => {
    expect(errors, `uncaught errors on ${page.url()}`).toEqual([]);
  };
}
