// The SSE tap's buffering / pause / resume / clear / malformed-frame logic.
//
// Tested at the hook rather than through FlowView because this is where all
// the state lives; FlowView.test.tsx covers what the operator actually sees.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFlowTap, type TapEvent } from './useFlowTap';
import { installMockEventSource, MockEventSource } from '../../test/helpers';

const tap = (over: Partial<TapEvent> = {}): TapEvent => ({
  eventName: 'call:caption:line',
  namespace: 'call',
  producer: 'platform-api',
  transport: 'signal',
  timestamp: '2026-09-07T11:22:33.456Z',
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  MockEventSource.reset();
});

describe('useFlowTap — stream URL', () => {
  it('opens an unfiltered stream when no filters are set', () => {
    installMockEventSource();
    renderHook(() => useFlowTap({}));
    expect(MockEventSource.latest.url).toBe('/api/flow');
  });

  it('passes namespace and transport filters through to the server', () => {
    installMockEventSource();
    renderHook(() => useFlowTap({ namespace: 'call', transport: 'durable' }));
    expect(MockEventSource.latest.url).toBe('/api/flow?namespace=call&transport=durable');
  });

  it('omits sample=1, which is the server default and means "everything"', () => {
    installMockEventSource();
    renderHook(() => useFlowTap({ sample: 1 }));
    expect(MockEventSource.latest.url).toBe('/api/flow');
  });

  it('sends the sample knob when it is actually sampling', () => {
    installMockEventSource();
    renderHook(() => useFlowTap({ sample: 25 }));
    expect(MockEventSource.latest.url).toBe('/api/flow?sample=25');
  });

  it('reopens the stream when a filter changes and closes the old one', () => {
    installMockEventSource();
    const { rerender } = renderHook(({ ns }: { ns: string }) => useFlowTap({ namespace: ns }), {
      initialProps: { ns: 'call' },
    });
    const first = MockEventSource.latest;
    rerender({ ns: 'pipeline' });
    expect(first.closed).toBe(true);
    expect(MockEventSource.latest.url).toBe('/api/flow?namespace=pipeline');
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('closes the stream on unmount so a navigated-away view stops consuming', () => {
    installMockEventSource();
    const { unmount } = renderHook(() => useFlowTap({}));
    const es = MockEventSource.latest;
    unmount();
    expect(es.closed).toBe(true);
  });
});

describe('useFlowTap — buffering', () => {
  it('accumulates events in arrival order', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      MockEventSource.latest.emit(tap({ eventName: 'a' }));
      MockEventSource.latest.emit(tap({ eventName: 'b' }));
    });
    expect(result.current.events.map((e) => e.eventName)).toEqual(['a', 'b']);
    expect(result.current.lastEvent?.eventName).toBe('b');
  });

  it('caps the buffer at 200 and keeps the NEWEST, not the oldest', () => {
    // A ring buffer that drops from the wrong end shows an operator a
    // frozen picture of five minutes ago while the flow races on.
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      for (let i = 0; i < 250; i++) MockEventSource.latest.emit(tap({ eventName: `e${i}` }));
    });
    expect(result.current.events).toHaveLength(200);
    expect(result.current.events[0]!.eventName).toBe('e50');
    expect(result.current.events.at(-1)!.eventName).toBe('e249');
  });
});

describe('useFlowTap — malformed frames', () => {
  it('drops an unparseable frame without losing the buffer', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      MockEventSource.latest.emit(tap({ eventName: 'good' }));
      MockEventSource.latest.emitRaw('{"eventName":"trunc');
      MockEventSource.latest.emit(tap({ eventName: 'after' }));
    });
    expect(result.current.events.map((e) => e.eventName)).toEqual(['good', 'after']);
  });

  it('drops a frame that parses but is not a tap event', () => {
    // Valid JSON with the wrong shape used to enter the buffer and then blow
    // up the ticker on `timestamp.slice(...)`, taking the whole view down.
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      MockEventSource.latest.emitRaw('null');
      MockEventSource.latest.emitRaw('"a string"');
      MockEventSource.latest.emitRaw('{"hello":"world"}');
      MockEventSource.latest.emitRaw('{"eventName":"x"}'); // no timestamp
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.lastEvent).toBeNull();
  });

  it('accepts a frame missing only the optional fields', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      MockEventSource.latest.emitRaw(
        JSON.stringify({ eventName: 'x', timestamp: '2026-09-07T00:00:00.000Z' }),
      );
    });
    expect(result.current.events).toHaveLength(1);
  });
});

describe('useFlowTap — pause / resume / clear', () => {
  it('drops the connection on pause so no more frames arrive', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    const es = MockEventSource.latest;
    act(() => {
      es.emit(tap({ eventName: 'before' }));
      result.current.pause();
    });
    expect(result.current.isLive).toBe(false);
    // Pausing has to close the socket, not just stop rendering: a "paused"
    // view that still holds an open stream keeps the server fanning every
    // event out to a client nobody is looking at.
    expect(es.closed).toBe(true);
    act(() => es.emit(tap({ eventName: 'after-pause' })));
    expect(result.current.events.map((e) => e.eventName)).toEqual(['before']);
  });

  it('keeps the buffer across a pause — pausing is not clearing', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => MockEventSource.latest.emit(tap({ eventName: 'kept' })));
    act(() => result.current.pause());
    expect(result.current.events.map((e) => e.eventName)).toEqual(['kept']);
  });

  it('opens a fresh connection on resume and appends to the existing buffer', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => MockEventSource.latest.emit(tap({ eventName: 'one' })));
    act(() => result.current.pause());
    act(() => result.current.resume());
    expect(result.current.isLive).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    act(() => MockEventSource.latest.emit(tap({ eventName: 'two' })));
    expect(result.current.events.map((e) => e.eventName)).toEqual(['one', 'two']);
  });

  it('clear empties both the buffer and lastEvent without dropping the stream', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => MockEventSource.latest.emit(tap()));
    act(() => result.current.clear());
    expect(result.current.events).toEqual([]);
    expect(result.current.lastEvent).toBeNull();
    expect(result.current.isLive).toBe(true);
    expect(MockEventSource.latest.closed).toBe(false);
    // And the stream keeps working afterwards.
    act(() => MockEventSource.latest.emit(tap({ eventName: 'later' })));
    expect(result.current.events.map((e) => e.eventName)).toEqual(['later']);
  });

  it('starts paused when asked to', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}, false));
    expect(result.current.isLive).toBe(false);
    expect(MockEventSource.instances).toHaveLength(0);
  });
});

describe('useFlowTap — connection errors', () => {
  it('stays quiet on a transient error EventSource will retry itself', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => {
      MockEventSource.latest.readyState = MockEventSource.CONNECTING;
      MockEventSource.latest.onerror?.({});
    });
    expect(result.current.error).toBeNull();
  });

  it('reports an error once the connection is closed for good', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => MockEventSource.latest.fail());
    expect(result.current.error).toBe('SSE connection closed');
  });

  it('clears a stale error when the stream is reopened', () => {
    installMockEventSource();
    const { result } = renderHook(() => useFlowTap({}));
    act(() => MockEventSource.latest.fail());
    expect(result.current.error).toBe('SSE connection closed');
    act(() => result.current.pause());
    act(() => result.current.resume());
    expect(result.current.error).toBeNull();
  });
});
