// tests/server-tap-frame.test.ts
//
// `GET /api/flow`'s listener used to call `JSON.stringify(event)` itself,
// so one observed publish watched by N admin streams serialized the same
// object N times — ~84µs of duplicate work per event at the 250-stream
// cap, scaling linearly with how many operators had the flow view open.
// `tapFrame()` serializes once per `tapEmitter.publish()` and hands every
// stream the identical string.
//
// The memo is a single slot keyed on object identity, so the risk it
// carries is staleness: a caller that reuses one TapEvent object across
// publishes must not be served the frame from its previous publish.
// `publish()` clears the slot before emitting; these tests pin that,
// plus the property the optimization exists for — every stream in one
// fan-out gets the same string, and it is the same string the old
// inline `JSON.stringify` produced.

import { describe, it, expect, afterEach } from 'vitest';
import { tapEmitter, tapFrame, type TapEvent } from '../src/server/tap-emitter.js';

function sampleEvent(overrides: Partial<TapEvent> = {}): TapEvent {
  return {
    eventName: 'pipeline:step:completed',
    namespace: 'pipeline',
    producer: 'pipeline-worker',
    transport: 'signal',
    timestamp: '2026-09-07T00:00:00.000Z',
    channel: 'events:pipeline:step:completed',
    envelope: { payload: { stepId: 'step-1' } },
    ...overrides,
  };
}

afterEach(() => {
  tapEmitter.removeAllListeners('publish');
});

describe('tapFrame', () => {
  it('produces exactly the frame the route used to build inline', () => {
    const event = sampleEvent();
    expect(tapFrame(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('returns the identical string instance to every listener in one publish', () => {
    const event = sampleEvent();
    const frames: string[] = [];
    for (let i = 0; i < 5; i++) {
      tapEmitter.on('publish', (e: TapEvent) => frames.push(tapFrame(e)));
    }

    tapEmitter.publish(event);

    expect(frames).toHaveLength(5);
    // Same VALUE for all five, and — the point of the memo — the same
    // instance, i.e. `JSON.stringify` ran once rather than five times.
    for (const frame of frames) expect(frame).toBe(frames[0]);
    expect(frames.every((f) => Object.is(f, frames[0]))).toBe(true);
  });

  it('serializes distinct events distinctly', () => {
    const a = sampleEvent({ eventName: 'a:one' });
    const b = sampleEvent({ eventName: 'b:two' });
    expect(tapFrame(a)).toContain('"a:one"');
    expect(tapFrame(b)).toContain('"b:two"');
    // Going back to `a` must not return `b`'s frame.
    expect(tapFrame(a)).toContain('"a:one"');
  });
});

describe('tapFrame — invalidation', () => {
  it('re-serializes a REUSED object that was mutated between publishes', () => {
    // Neither producer (MetricsObserver's signal subscription, nor the
    // durable poll) reuses a TapEvent object today — both build a fresh
    // literal. But a one-slot identity memo would silently serve a stale
    // frame if one ever did, so `publish()` invalidates before emitting.
    const event = sampleEvent({ eventName: 'reused:event' });
    const seen: string[] = [];
    tapEmitter.on('publish', (e: TapEvent) => seen.push(tapFrame(e)));

    tapEmitter.publish(event);
    event.timestamp = '2026-09-07T00:00:01.000Z';
    event.producer = 'a-different-producer';
    tapEmitter.publish(event);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('"2026-09-07T00:00:00.000Z"');
    expect(seen[0]).toContain('"pipeline-worker"');
    expect(seen[1]).toContain('"2026-09-07T00:00:01.000Z"');
    expect(seen[1]).toContain('"a-different-producer"');
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('does not leak one publish’s frame into the next event', () => {
    const seen: string[] = [];
    tapEmitter.on('publish', (e: TapEvent) => seen.push(tapFrame(e)));

    tapEmitter.publish(sampleEvent({ eventName: 'first:event' }));
    tapEmitter.publish(sampleEvent({ eventName: 'second:event' }));

    expect(seen[0]).toContain('"first:event"');
    expect(seen[0]).not.toContain('"second:event"');
    expect(seen[1]).toContain('"second:event"');
    expect(seen[1]).not.toContain('"first:event"');
  });

  it('serializes lazily — nothing is stringified when no stream is open', () => {
    // With no listeners the frame is never requested, so a publish on an
    // idle server (the common case) costs an emit and nothing else.
    let stringifyCalls = 0;
    const event = sampleEvent();
    Object.defineProperty(event, 'toJSON', {
      enumerable: false,
      value(this: TapEvent) {
        stringifyCalls++;
        return { ...this, toJSON: undefined };
      },
    });

    tapEmitter.publish(event);
    expect(stringifyCalls).toBe(0);

    tapEmitter.on('publish', (e: TapEvent) => tapFrame(e));
    tapEmitter.publish(event);
    expect(stringifyCalls).toBe(1);
  });
});
