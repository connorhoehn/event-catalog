import { describe, it, expect } from 'vitest';
import { decodeTime, ulid } from 'ulid';
import { eventId, nowIso } from '../src/utils/hot-path';
import { Registry } from '../src/registry/index';
import type { EventDeclaration } from '../src/types/index';

/**
 * Guards for the publish hot-path optimizations. Every one of these is a
 * "the fast version must be indistinguishable from the slow version" test —
 * the point of the optimizations was speed, not new behaviour.
 */

function decl(over: Partial<EventDeclaration> & { name: string }): EventDeclaration {
  return {
    transport: 'signal',
    producer: 'test-service',
    description: 'test declaration',
    schema: { type: 'object' },
    ...over,
  } as EventDeclaration;
}

describe('eventId() — pooled-PRNG ULID', () => {
  it('matches the shape of ulid() from the ulid package', () => {
    const mine = eventId();
    const theirs = ulid();
    expect(mine).toHaveLength(theirs.length);
    expect(mine).toHaveLength(26);
    expect(mine).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes the current time in the leading 10 characters', () => {
    const before = Date.now();
    const id = eventId();
    const after = Date.now();
    const t = decodeTime(id);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('is unique across a large batch (pool refills do not repeat)', () => {
    const n = 50_000; // > the 4096-byte pool, so it wraps many times
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(eventId());
    expect(seen.size).toBe(n);
  });

  it('sorts lexicographically by time', async () => {
    const first = eventId();
    await new Promise((r) => setTimeout(r, 5));
    const second = eventId();
    expect(first < second).toBe(true);
  });

  it('spreads across the base32 alphabet in the random section', () => {
    // A broken PRNG (e.g. always returning 0) would collapse to one char.
    const chars = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      for (const c of eventId().slice(10)) chars.add(c);
    }
    expect(chars.size).toBeGreaterThan(20);
  });
});

describe('nowIso() — per-millisecond memoized ISO string', () => {
  it('returns exactly what new Date().toISOString() would', () => {
    for (let i = 0; i < 200; i++) {
      const cached = nowIso();
      const direct = new Date().toISOString();
      // Same millisecond ⇒ identical; a tick boundary in between is the
      // only legal difference, and then cached must be the earlier one.
      expect(cached <= direct).toBe(true);
      expect(cached).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('advances once the clock does', async () => {
    const first = nowIso();
    await new Promise((r) => setTimeout(r, 5));
    expect(nowIso()).not.toBe(first);
  });
});

describe('Registry.resolve() — alias index', () => {
  it('resolves an alias to its canonical entry with the alias record', () => {
    const r = new Registry();
    r.declare(decl({ name: 'pipeline:run:started', aliases: [{ name: 'pipeline.run.started', until: '2027-01-01' }] }));
    const hit = r.resolve('pipeline.run.started');
    expect(hit?.entry.name).toBe('pipeline:run:started');
    expect(hit?.viaAlias).toEqual({ name: 'pipeline.run.started', until: '2027-01-01' });
  });

  it('prefers a canonical name over an identically-named alias', () => {
    const r = new Registry();
    r.declare(decl({ name: 'a:one', aliases: [{ name: 'b:two' }] }));
    r.declare(decl({ name: 'b:two' }));
    const hit = r.resolve('b:two');
    expect(hit?.entry.name).toBe('b:two');
    expect(hit?.viaAlias).toBeUndefined();
  });

  it('sees aliases declared after the index was already built', () => {
    const r = new Registry();
    r.declare(decl({ name: 'first:event', aliases: [{ name: 'first.old' }] }));
    expect(r.resolve('first.old')?.entry.name).toBe('first:event'); // builds the index
    r.declare(decl({ name: 'second:event', aliases: [{ name: 'second.old' }] }));
    expect(r.resolve('second.old')?.entry.name).toBe('second:event');
  });

  it('forgets an alias once its event is removed', () => {
    const r = new Registry();
    r.declare(decl({ name: 'gone:event', aliases: [{ name: 'gone.old' }] }));
    expect(r.resolve('gone.old')).toBeDefined();
    r.remove('gone:event');
    expect(r.resolve('gone.old')).toBeUndefined();
  });

  it('forgets every alias on clear()', () => {
    const r = new Registry();
    r.declare(decl({ name: 'x:event', aliases: [{ name: 'x.old' }] }));
    expect(r.resolve('x.old')).toBeDefined();
    r.clear();
    expect(r.resolve('x.old')).toBeUndefined();
  });

  it('returns undefined for an unknown name', () => {
    const r = new Registry();
    r.declare(decl({ name: 'known:event', aliases: [{ name: 'known.old' }] }));
    expect(r.resolve('never:declared')).toBeUndefined();
  });
});

describe('Registry.list() — single-pass filtering', () => {
  const build = (): Registry => {
    const r = new Registry();
    r.declare(decl({ name: 'pipeline:run:started', transport: 'signal', producer: 'core', tags: ['hot', 'run'] }));
    r.declare(decl({ name: 'pipeline:run:failed', transport: 'durable', producer: ['core', 'worker'], tags: ['run'] }));
    r.declare(decl({ name: 'gateway:frame:sent', transport: 'signal', producer: 'gateway', tags: ['hot'] }));
    r.addSubscriber('pipeline:run:started', 'audit-worker');
    return r;
  };

  it('returns everything with no filter', () => {
    expect(build().list()).toHaveLength(3);
  });

  it('ANDs every criterion together', () => {
    const r = build();
    expect(r.list({ transport: 'signal' }).map(e => e.name))
      .toEqual(['pipeline:run:started', 'gateway:frame:sent']);
    expect(r.list({ namespace: 'pipeline' }).map(e => e.name))
      .toEqual(['pipeline:run:started', 'pipeline:run:failed']);
    expect(r.list({ transport: 'signal', namespace: 'pipeline', tag: 'hot' }).map(e => e.name))
      .toEqual(['pipeline:run:started']);
    expect(r.list({ transport: 'durable', tag: 'hot' })).toEqual([]);
  });

  it('matches a producer given as either a string or an array', () => {
    const r = build();
    expect(r.list({ producer: 'gateway' }).map(e => e.name)).toEqual(['gateway:frame:sent']);
    expect(r.list({ producer: 'worker' }).map(e => e.name)).toEqual(['pipeline:run:failed']);
    expect(r.list({ producer: 'core' }).map(e => e.name))
      .toEqual(['pipeline:run:started', 'pipeline:run:failed']);
    expect(r.list({ producer: 'nobody' })).toEqual([]);
  });

  it('filters by subscriber', () => {
    const r = build();
    expect(r.list({ subscriber: 'audit-worker' }).map(e => e.name)).toEqual(['pipeline:run:started']);
    expect(r.list({ subscriber: 'ghost' })).toEqual([]);
  });

  it('preserves declaration order', () => {
    expect(build().list({ transport: 'signal' }).map(e => e.name))
      .toEqual(['pipeline:run:started', 'gateway:frame:sent']);
  });
});
