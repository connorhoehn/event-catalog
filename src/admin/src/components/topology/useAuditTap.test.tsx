// The /api/audit SSE tap: what survives the wire and what reaches the view.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { installMockEventSource, MockEventSource } from '../../test/helpers';
import { useAuditTap, type AuditFilters } from './useAuditTap';

const declared = (over: Record<string, unknown> = {}) => ({
  kind: 'event.declared',
  timestamp: '2026-09-07T11:22:33.456Z',
  eventName: 'call:caption:line',
  namespace: 'call',
  version: 1,
  ...over,
});

// Braces matter: a bare arrow would RETURN the class, and vitest treats a
// value returned from beforeEach as a teardown callback — it would then call
// the class without `new`.
beforeEach(() => {
  installMockEventSource();
});
afterEach(() => vi.unstubAllGlobals());

describe('useAuditTap — connection', () => {
  it('opens /api/audit with no query string when unfiltered', () => {
    renderHook(() => useAuditTap({}));
    expect(MockEventSource.latest.url).toBe('/admin-api/audit');
  });

  it('passes every filter through to the server', () => {
    renderHook(() =>
      useAuditTap({ kind: 'event.removed', eventName: 'a:b', namespace: 'a', serviceName: 'svc' }),
    );
    const url = MockEventSource.latest.url;
    expect(url).toContain('kind=event.removed');
    expect(url).toContain('eventName=a%3Ab');
    expect(url).toContain('namespace=a');
    expect(url).toContain('serviceName=svc');
  });

  it('closes the stream on unmount instead of leaking it', () => {
    const { unmount } = renderHook(() => useAuditTap({}));
    const es = MockEventSource.latest;
    unmount();
    expect(es.closed).toBe(true);
  });

  it('reports a permanently-closed connection to the operator', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => MockEventSource.latest.fail());
    expect(result.current.error).toBe('SSE connection closed');
  });
});

describe('useAuditTap — frame handling', () => {
  it('collects well-formed frames oldest-first and tracks the newest', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => {
      MockEventSource.latest.emit(declared({ eventName: 'a:one' }));
      MockEventSource.latest.emit(declared({ eventName: 'a:two' }));
    });
    expect(result.current.events.map((e) => e.eventName)).toEqual(['a:one', 'a:two']);
    expect(result.current.lastEvent?.eventName).toBe('a:two');
  });

  it('drops a truncated frame without taking down the feed', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => {
      MockEventSource.latest.emitRaw('{"kind":"event.dec');
      MockEventSource.latest.emit(declared());
    });
    expect(result.current.events).toHaveLength(1);
  });

  it('drops a frame of an unknown kind rather than letting the renderer throw', () => {
    // AuditView does `kindMeta[event.kind].label`, so a kind from a newer
    // server release used to blank the whole Registry Changes view. One
    // missing row is the failure an operator can live with.
    const { result } = renderHook(() => useAuditTap({}));
    act(() => {
      MockEventSource.latest.emit(declared({ kind: 'event.fingerprint.changed' }));
      MockEventSource.latest.emit(declared());
    });
    expect(result.current.events.map((e) => e.kind)).toEqual(['event.declared']);
  });

  it.each([
    ['a bare array', []],
    ['null', null],
    ['a frame with no eventName', { kind: 'event.declared', timestamp: 'x' }],
    ['a frame with a numeric timestamp', { kind: 'event.declared', timestamp: 1, eventName: 'a' }],
  ])('rejects %s', (_label, frame) => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => MockEventSource.latest.emit(frame));
    expect(result.current.events).toEqual([]);
  });

  it('caps the buffer, keeping the newest events', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => {
      for (let i = 0; i < 205; i += 1) {
        MockEventSource.latest.emit(declared({ eventName: `e:${i}` }));
      }
    });
    expect(result.current.events).toHaveLength(200);
    expect(result.current.events.at(-1)?.eventName).toBe('e:204');
    expect(result.current.events[0]?.eventName).toBe('e:5');
  });
});

describe('useAuditTap — pause, resume and clear', () => {
  it('closes the stream on pause and opens a fresh one on resume', () => {
    const { result } = renderHook(() => useAuditTap({}));
    const first = MockEventSource.latest;
    act(() => result.current.pause());
    expect(first.closed).toBe(true);
    expect(result.current.isLive).toBe(false);
    act(() => result.current.resume());
    expect(result.current.isLive).toBe(true);
    expect(MockEventSource.latest).not.toBe(first);
  });

  it('keeps the buffer across a pause/resume — Clear is the deliberate act', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => MockEventSource.latest.emit(declared()));
    act(() => result.current.pause());
    act(() => result.current.resume());
    expect(result.current.events).toHaveLength(1);
  });

  it('empties the buffer on clear', () => {
    const { result } = renderHook(() => useAuditTap({}));
    act(() => MockEventSource.latest.emit(declared()));
    act(() => result.current.clear());
    expect(result.current.events).toEqual([]);
    expect(result.current.lastEvent).toBeNull();
  });
});

describe('useAuditTap — changing the filter', () => {
  it('DISCARDS rows received under the previous filter', () => {
    // The bug: the server does the filtering, so a filter change opens a new
    // stream — but the rows already received stayed in the buffer and kept
    // rendering. Selecting namespace "ws" left every "pipeline" row on
    // screen, which reads either as a broken filter or, worse, as a ws event
    // that isn't one.
    const { result, rerender } = renderHook((filters: AuditFilters) => useAuditTap(filters), {
      initialProps: {} as AuditFilters,
    });
    act(() => {
      MockEventSource.latest.emit(declared({ namespace: 'pipeline', eventName: 'pipeline:step:started' }));
    });
    expect(result.current.events).toHaveLength(1);

    rerender({ namespace: 'ws' });
    expect(result.current.events).toEqual([]);
    expect(result.current.lastEvent).toBeNull();

    act(() => MockEventSource.latest.emit(declared({ namespace: 'ws', eventName: 'ws:frame' })));
    expect(result.current.events.map((e) => e.eventName)).toEqual(['ws:frame']);
  });

  it('reconnects to the filtered endpoint', () => {
    const { rerender } = renderHook((filters: AuditFilters) => useAuditTap(filters), {
      initialProps: {} as AuditFilters,
    });
    const first = MockEventSource.latest;
    rerender({ kind: 'event.removed' });
    expect(first.closed).toBe(true);
    expect(MockEventSource.latest.url).toContain('kind=event.removed');
  });

  it('does not clear when an unrelated re-render passes an equivalent filter', () => {
    // The filters object is rebuilt inline on every AuditView render, so
    // identity-based comparison would wipe the feed on every keystroke.
    const { result, rerender } = renderHook((filters: AuditFilters) => useAuditTap(filters), {
      initialProps: { namespace: 'ws' } as AuditFilters,
    });
    act(() => MockEventSource.latest.emit(declared({ namespace: 'ws' })));
    rerender({ namespace: 'ws' });
    expect(result.current.events).toHaveLength(1);
  });
});
