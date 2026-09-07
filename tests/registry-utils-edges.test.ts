// tests/registry-utils-edges.test.ts
//
// Remaining edge branches in src/registry, src/utils and src/types that the
// topic-specific suites (registry.test.ts, schema-compat.test.ts,
// validating-publisher.test.ts, envelopes.test.ts) leave uncovered — chiefly
// re-declaration merge semantics, validation error shaping, subscriber
// pruning when no heartbeat was ever recorded, and the runtime envelope
// guards' non-object rejection.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { checkBackwardCompat, checkForwardCompat } from '../src/registry/schema-compat.js';
import { computeSchemaFingerprint } from '../src/registry/fingerprint.js';
import {
  createValidatingPublisher,
  createPublisher,
  ValidationError,
} from '../src/utils/validating-publisher.js';
import { InMemoryDLQStore } from '../src/dlq/DLQStore.js';
import { DLQManager } from '../src/dlq/DLQManager.js';
import {
  isBroadcastEnvelope,
  isDirectMessageEnvelope,
  isChannelMessageEnvelope,
} from '../src/types/envelopes.js';
import type { EventDeclaration } from '../src/types/index.js';

function decl(overrides: Partial<EventDeclaration> = {}): EventDeclaration {
  return {
    name: 'orders:created',
    transport: 'signal',
    producer: 'svc-a',
    schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
    ...overrides,
  } as EventDeclaration;
}

describe('Registry.declare — re-declaration merge semantics', () => {
  it('an explicit compatMode on a re-declaration overrides the stored value', () => {
    const r = new Registry();
    r.declare(decl({ compatMode: 'warn' } as Partial<EventDeclaration>));
    expect(r.get('orders:created')!.compatMode).toBe('warn');

    r.declare(decl({ compatMode: 'strict' } as Partial<EventDeclaration>));
    expect(r.get('orders:created')!.compatMode).toBe('strict');
  });

  it('an omitted compatMode on a re-declaration is sticky — it does not reset to undefined', () => {
    const r = new Registry();
    r.declare(decl({ compatMode: 'strict' } as Partial<EventDeclaration>));
    r.declare(decl());

    // A boot that re-registers without the flag must not silently disable
    // per-event enforcement.
    expect(r.get('orders:created')!.compatMode).toBe('strict');
  });

  it('backfills a missing producer but never overwrites an existing one', () => {
    const r = new Registry();
    r.declare(decl({ producer: undefined } as unknown as Partial<EventDeclaration>));
    expect(r.get('orders:created')!.producer).toBeUndefined();

    r.declare(decl({ producer: 'svc-a' }));
    expect(r.get('orders:created')!.producer).toBe('svc-a');

    r.declare(decl({ producer: 'svc-b' }));
    expect(r.get('orders:created')!.producer).toBe('svc-a');
  });

  it('a schema-less declaration still gets the fingerprint of {} and defaults version 1', () => {
    const r = new Registry();
    r.declare({ name: 'bulk:entry', transport: 'signal', producer: 'svc-a' } as EventDeclaration);

    const entry = r.get('bulk:entry')!;
    expect(entry.version).toBe(1);
    expect(entry.schemaFingerprint).toBe(computeSchemaFingerprint({}));
    // No schema ⇒ nothing to validate against, so anything passes.
    expect(r.validate('bulk:entry', { anything: true })).toEqual({ valid: true });
  });
});

describe('Registry.validate — error shaping', () => {
  it('reports a path for a nested field error and omits an empty path at the root', () => {
    const r = new Registry();
    r.declare(decl({
      schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          customer: { type: 'object', properties: { id: { type: 'number' } } },
        },
        required: ['orderId'],
      },
    }));

    const missingRoot = r.validate('orders:created', {});
    expect(missingRoot.valid).toBe(false);
    expect(missingRoot.errors!.length).toBeGreaterThan(0);
    // `path: ''` must be normalised to undefined, not surfaced as an empty string.
    for (const e of missingRoot.errors!) {
      expect(e.path === undefined || e.path.length > 0).toBe(true);
      expect(e.message).toBeTypeOf('string');
    }

    const nested = r.validate('orders:created', { orderId: 'o-1', customer: { id: 'not-a-number' } });
    expect(nested.valid).toBe(false);
    expect(nested.errors!.some(e => (e.path ?? '').includes('customer'))).toBe(true);
  });

  it('rejects a payload for an event that was never declared', () => {
    const r = new Registry();
    expect(r.validate('never:declared', {})).toEqual({
      valid: false,
      errors: [{ message: 'Event "never:declared" is not declared' }],
    });
  });
});

describe('Registry.checkSchemaCompat / clear', () => {
  it('treats an unknown event as compatible — a brand-new event cannot break anything', () => {
    const r = new Registry();
    expect(r.checkSchemaCompat('never:declared', { type: 'object' })).toEqual({
      compatible: true,
      violations: [],
    });
  });

  it('clear() empties the registry and makes previously declared events unresolvable', () => {
    const r = new Registry();
    r.declare(decl());
    expect(r.size()).toBe(1);

    r.clear();

    expect(r.size()).toBe(0);
    expect(r.get('orders:created')).toBeUndefined();
    expect(r.resolve('orders:created')).toBeUndefined();
    expect(r.list()).toEqual([]);
  });
});

describe('Registry.pruneStaleSubscribers', () => {
  it('prunes a subscriber that never recorded a heartbeat', () => {
    const r = new Registry();
    r.declare(decl());
    // addSubscriber stamps a heartbeat; simulate a subscriber list hydrated
    // from Redis, where no in-process heartbeat exists at all.
    r.get('orders:created')!.subscribers.push('ghost-svc');

    const pruned = r.pruneStaleSubscribers(60_000);

    expect(pruned).toEqual([{ eventName: 'orders:created', serviceName: 'ghost-svc' }]);
    expect(r.get('orders:created')!.subscribers).toEqual([]);
  });

  it('keeps a subscriber whose heartbeat is inside the TTL and prunes only the stale one', () => {
    const r = new Registry();
    r.declare(decl());
    r.addSubscriber('orders:created', 'fresh-svc');
    r.get('orders:created')!.subscribers.push('ghost-svc');

    const pruned = r.pruneStaleSubscribers(60_000);

    expect(pruned.map(p => p.serviceName)).toEqual(['ghost-svc']);
    expect(r.get('orders:created')!.subscribers).toEqual(['fresh-svc']);

    // Advancing past the TTL prunes the remaining one too.
    const later = r.pruneStaleSubscribers(60_000, Date.now() + 120_000);
    expect(later.map(p => p.serviceName)).toEqual(['fresh-svc']);
    expect(r.get('orders:created')!.subscribers).toEqual([]);
  });
});

describe('schema-compat — schemas without a declared type', () => {
  it('a type-less schema is treated as "any" and does not report a type narrowing', () => {
    // getType() falls back to 'any'; without that fallback the compare
    // would read `undefined` and mis-report every untyped property.
    const oldSchema = { type: 'object', properties: { a: {} } };
    const newSchema = { type: 'object', properties: { a: {} } };

    expect(checkBackwardCompat(oldSchema, newSchema)).toEqual({ compatible: true, violations: [] });
    expect(checkForwardCompat(oldSchema, newSchema)).toEqual({ compatible: true, violations: [] });
  });

  it('narrowing an untyped property to a concrete type is flagged', () => {
    const result = checkBackwardCompat(
      { type: 'object', properties: { a: {} } },
      { type: 'object', properties: { a: { type: 'string' } } },
    );
    expect(result.compatible).toBe(false);
    expect(result.violations.join(' ')).toContain('a');
  });
});

describe('createValidatingPublisher / createPublisher', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefixes the field path onto each error message handed to onValidationError', async () => {
    const r = new Registry();
    r.declare(decl({
      schema: {
        type: 'object',
        properties: { customer: { type: 'object', properties: { id: { type: 'number' } } } },
      },
    }));

    const seen: string[][] = [];
    const publish = createValidatingPublisher<unknown>(r, 'orders:created', async () => {}, {
      mode: 'warn',
      onValidationError: (_n, errors) => { seen.push(errors); },
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await publish({ customer: { id: 'nope' } });

    expect(seen).toHaveLength(1);
    // Path-carrying errors must read "<path>: <message>", not a bare message.
    expect(seen[0]!.some(e => e.includes(': '))).toBe(true);
  });

  it('createPublisher builds its own registry when none is supplied — and validates nothing', async () => {
    const published: unknown[] = [];
    const publish = createPublisher<unknown>('orders:created', async p => { published.push(p); }, {
      mode: 'strict',
    });

    // An empty ad-hoc registry has no declaration, so validate() reports
    // "not declared" and strict mode must throw rather than pass through.
    await expect(publish({ orderId: 'o-1' })).rejects.toBeInstanceOf(ValidationError);
    expect(published).toEqual([]);
  });

  it('createPublisher does not forward the `registry` key into the publisher options', async () => {
    const r = new Registry();
    r.declare(decl());
    const published: unknown[] = [];

    const publish = createPublisher<unknown>('orders:created', async p => { published.push(p); }, {
      registry: r,
      mode: 'strict',
    });

    await expect(publish({ orderId: 'o-1' })).resolves.toBeUndefined();
    await expect(publish({ nope: true })).rejects.toBeInstanceOf(ValidationError);
    expect(published).toEqual([{ orderId: 'o-1' }]);
  });

  it('strict mode with a DLQ routes the bad payload instead of throwing, and still publishes good ones', async () => {
    const r = new Registry();
    r.declare(decl());
    const store = new InMemoryDLQStore();
    const dlq = new DLQManager(store);
    const published: unknown[] = [];

    const publish = createValidatingPublisher<unknown>(r, 'orders:created', async p => {
      published.push(p);
    }, { mode: 'strict', dlq });

    await expect(publish({ nope: true })).resolves.toBeUndefined();
    await expect(publish({ orderId: 'o-1' })).resolves.toBeUndefined();

    expect(published).toEqual([{ orderId: 'o-1' }]);
    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventName: 'orders:created',
      reason: 'VALIDATION_FAILED',
      payload: { nope: true },
    });
  });
});

describe('envelope runtime guards — non-object rejection', () => {
  const notObjects = [null, undefined, 'broadcast', 42, true, Symbol('x')];

  it('every guard rejects null and non-object inputs without throwing', () => {
    for (const v of notObjects) {
      expect(isBroadcastEnvelope(v)).toBe(false);
      expect(isDirectMessageEnvelope(v)).toBe(false);
      expect(isChannelMessageEnvelope(v)).toBe(false);
    }
  });

  it('isBroadcastEnvelope accepts a null excludeClientId but rejects a non-string one', () => {
    const base = {
      type: 'broadcast',
      fromNode: 'node-a',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { hello: 'world' },
    };

    expect(isBroadcastEnvelope({ ...base, excludeClientId: null })).toBe(true);
    expect(isBroadcastEnvelope({ ...base, excludeClientId: 'c-1' })).toBe(true);
    expect(isBroadcastEnvelope({ ...base, excludeClientId: 42 })).toBe(false);
    // `message` is required even though its shape is unconstrained.
    expect(isBroadcastEnvelope({ ...base, message: undefined, excludeClientId: null })).toBe(true);
    const { message: _drop, ...noMessage } = base;
    expect(isBroadcastEnvelope({ ...noMessage, excludeClientId: null })).toBe(false);
  });

  it('a wrong discriminator makes an otherwise well-shaped envelope fail its guard', () => {
    const broadcast = {
      type: 'direct',
      fromNode: 'node-a',
      timestamp: '2026-01-01T00:00:00.000Z',
      excludeClientId: null,
      message: {},
    };
    expect(isBroadcastEnvelope(broadcast)).toBe(false);
  });
});
