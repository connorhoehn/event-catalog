// tests/audit-log.test.ts
//
// wave23-a — persistent audit log. Verifies that startAuditLog
// pushes audit events to Redis, returns them in chronological
// order on recent(), respects the cap, and detaches cleanly on
// stop().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startAuditLog } from '../src/server/audit-log.js';
import { auditEmitter, type AuditEvent } from '../src/server/audit-emitter.js';

function makeMockRedis() {
  const store: string[] = [];
  return {
    store,
    lPush: vi.fn(async (_key: string, value: string) => {
      store.unshift(value);
      return store.length;
    }),
    lTrim: vi.fn(async (_key: string, start: number, end: number) => {
      const next = store.slice(start, end + 1);
      store.length = 0;
      store.push(...next);
      return 'OK';
    }),
    lRange: vi.fn(async (_key: string, start: number, end: number) => {
      return store.slice(start, end + 1);
    }),
  };
}

function sample(name: string, kind: AuditEvent['kind'] = 'event.declared'): AuditEvent {
  return {
    kind,
    timestamp: `2026-05-15T14:00:0${(name.length % 10)}.000Z`,
    eventName: name,
    namespace: 'pipeline',
    version: 1,
    fingerprint: 'a'.repeat(64),
  };
}

describe('startAuditLog (wave23-a)', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let log: ReturnType<typeof startAuditLog>;

  beforeEach(() => {
    auditEmitter.removeAllListeners('audit');
    redis = makeMockRedis();
    log = startAuditLog({ redis: redis as never });
  });
  afterEach(() => {
    log.stop();
  });

  it('LPUSHes every emitted audit event to Redis', async () => {
    auditEmitter.publish(sample('a.x'));
    auditEmitter.publish(sample('b.y', 'event.removed'));
    // The handler is async — wait a microtask.
    await new Promise((r) => setImmediate(r));
    expect(redis.lPush).toHaveBeenCalledTimes(2);
    expect(redis.store).toHaveLength(2);
  });

  it('LTRIMs to the configured cap', async () => {
    log.stop();
    const r = makeMockRedis();
    const small = startAuditLog({ redis: r as never, cap: 3 });
    for (let i = 0; i < 5; i++) auditEmitter.publish(sample(`e${i}`));
    await new Promise((r) => setImmediate(r));
    expect(r.lTrim).toHaveBeenCalledWith('event-catalog:audit-log', 0, 2);
    expect(r.store.length).toBeLessThanOrEqual(3);
    small.stop();
  });

  it('recent(N) returns events in chronological order (oldest → newest)', async () => {
    auditEmitter.publish(sample('first'));
    auditEmitter.publish(sample('second'));
    auditEmitter.publish(sample('third'));
    await new Promise((r) => setImmediate(r));
    const out = await log.recent(10);
    expect(out.map((e) => e.eventName)).toEqual(['first', 'second', 'third']);
  });

  it('recent(N) caps at the requested limit even if more are stored', async () => {
    for (let i = 0; i < 10; i++) auditEmitter.publish(sample(`evt-${i}`));
    await new Promise((r) => setImmediate(r));
    const out = await log.recent(3);
    // The 3 most recent in chronological order.
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.eventName)).toEqual(['evt-7', 'evt-8', 'evt-9']);
  });

  it('recent() defaults to 50 when no limit provided', async () => {
    for (let i = 0; i < 60; i++) auditEmitter.publish(sample(`evt-${i}`));
    await new Promise((r) => setImmediate(r));
    const out = await log.recent();
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it('Redis lPush failure does not crash the emit', async () => {
    redis.lPush.mockRejectedValueOnce(new Error('redis down'));
    expect(() => auditEmitter.publish(sample('a.x'))).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('recent() rejects on a Redis read failure rather than reporting an empty history', async () => {
    // [] would be indistinguishable from "nothing has been audited", which
    // is the answer an operator is least able to act on during an incident.
    redis.lRange.mockRejectedValueOnce(new Error('redis down'));
    await expect(log.recent(5)).rejects.toThrow(/audit history unavailable/i);
  });

  it('stop() detaches the listener so later emits do not push', async () => {
    log.stop();
    auditEmitter.publish(sample('a.x'));
    await new Promise((r) => setImmediate(r));
    expect(redis.lPush).not.toHaveBeenCalled();
  });

  it('drops unparseable entries in recent() rather than throwing', async () => {
    auditEmitter.publish(sample('valid'));
    await new Promise((r) => setImmediate(r));
    // Inject a bad entry directly.
    redis.store.unshift('not json {{');
    const out = await log.recent(10);
    expect(out.map((e) => e.eventName)).toEqual(['valid']);
  });
});
