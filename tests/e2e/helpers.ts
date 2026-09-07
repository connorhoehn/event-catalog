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

/** Wipe DLQ + recorded publishes. The registry fixture is untouched. */
export async function resetServer(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__e2e__/reset');
  expect(res.ok()).toBeTruthy();
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
