// Shared test doubles for the admin unit suite.
//
// Two things the admin UI talks to that jsdom does not provide: `fetch`
// (every view polls the catalog API) and `EventSource` (the flow + audit
// taps). Both are faked here rather than per-file so a test reads as
// "what does the server say" rather than "how do I wire a mock".

import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

/** One canned answer for a route. */
export interface RouteResponse {
  status?: number;
  /** JSON body. Ignored when `text` is set. */
  body?: unknown;
  /** Raw text body, for the Prometheus endpoint. */
  text?: string;
  /** Reject the fetch outright — a network failure, not an HTTP error. */
  networkError?: string;
}

export type RouteTable = Record<string, RouteResponse | (() => RouteResponse)>;

/**
 * Install a `fetch` that answers from a route table keyed by the path the
 * component asks for, matched as a prefix so query strings don't have to be
 * spelled out. An unmatched path is a test bug, so it throws loudly rather
 * than resolving to something bland the component would render as "empty".
 */
export function mockFetch(routes: RouteTable) {
  const calls: string[] = [];
  // `init` is unused here but present in the signature so tests can assert on
  // the request body a component sent (`fn.mock.calls[n][1]`).
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
    if (!key) {
      throw new Error(`unmocked fetch: ${url}`);
    }
    const entry = routes[key]!;
    const res = typeof entry === 'function' ? entry() : entry;
    if (res.networkError) throw new Error(res.networkError);
    const status = res.status ?? 200;
    const payload = res.text ?? JSON.stringify(res.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(payload),
      text: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

/**
 * Minimal EventSource stand-in. Tests drive it by calling `emit`, which is
 * what an SSE frame arriving on the wire looks like from the component's
 * side; `emitRaw` sends a body the component has to survive parsing.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  readyState = MockEventSource.OPEN;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }

  /** Deliver one well-formed JSON frame. */
  emit(data: unknown): void {
    this.emitRaw(JSON.stringify(data));
  }

  /**
   * Deliver a raw body — use for malformed / truncated frames.
   *
   * A closed EventSource dispatches nothing, so neither does this. Faking
   * delivery after close would test the mock rather than the hook.
   */
  emitRaw(data: string): void {
    if (this.closed) return;
    this.onmessage?.({ data });
  }

  /** Simulate a permanently-closed connection. */
  fail(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.({});
  }

  static get latest(): MockEventSource {
    const last = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!last) throw new Error('no EventSource was opened');
    return last;
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}

export function installMockEventSource(): typeof MockEventSource {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource);
  return MockEventSource;
}

/** Render inside a router — several views use <Link>. */
export function renderWithRouter(ui: ReactElement, options?: RenderOptions) {
  return render(<MemoryRouter>{ui}</MemoryRouter>, options);
}
