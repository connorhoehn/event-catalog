// src/server/routes/limits.ts
//
// Per-collection caps on operator-supplied JSON, and the guards that
// enforce them.
//
// The 1 MiB body cap (`REQUEST_BODY_LIMITS` in ../index.ts) bounds the
// bytes of a single request, not the amount of work or state one request
// creates. `{"name":"a","transport":"signal"}` is ~35 bytes, so one
// in-budget POST /api/events/bulk carried ~30 000 declarations —
// verified: a 20 000-element body was accepted in full and left 20 000
// entries in the registry, each with its own Redis hash field, six
// distributed-core metric handles and a rate-history ring buffer. The
// body cap is an OOM guard for the parse; these are the guards for what
// happens after it.
//
// Every ceiling here is set well above real platform usage — the
// committed registry snapshot holds 194 events across every service —
// so they bound abuse without constraining legitimate callers.

import type { Response } from '../http-router.js';
import { badRequest } from './_shared.js';

/** Max declarations accepted by one POST /api/events/bulk. */
export const MAX_BULK_EVENTS = 1000;

/** Max names accepted by one POST /api/events/bulk/deprecate. */
export const MAX_BULK_DEPRECATE_NAMES = 1000;

/**
 * Max ids accepted by one POST /api/transports/durable/dlq/replay.
 * Each id costs a DynamoDB read plus a message-queue POST, run
 * sequentially inside the request, so this also bounds how long a single
 * request can occupy the server.
 */
export const MAX_DLQ_REPLAY_IDS = 100;

/** Max entries accepted by one POST /api/freshness. */
export const MAX_FRESHNESS_EVENTS = 5000;

/** Max pinned events accepted by one PUT /api/manifests/:consumerName. */
export const MAX_MANIFEST_EVENTS = 5000;

/** Max entries returned by GET /api/audit/recent and replayed by ?replay=. */
export const MAX_AUDIT_QUERY_LIMIT = 1000;

/**
 * Max length of an event name. Names index the registry map, Redis hash
 * fields, Prometheus label values and derived queue names; nothing
 * legitimate is near this.
 */
export const MAX_EVENT_NAME_LENGTH = 512;

/**
 * Max length of a consumer name. It is a Redis hash field in
 * `event-catalog:manifests` and comes straight off the URL path.
 */
export const MAX_CONSUMER_NAME_LENGTH = 256;

/**
 * Object keys that JavaScript treats specially on assignment. An event
 * name is used as a key in the plain-object responses built by
 * `GET /api/fingerprints` and `GET /api/metrics/history`; `__proto__`
 * there does not create an own property, it hits the prototype setter.
 *
 * Verified before the fix: declaring an event literally named
 * `__proto__` returned 201, the event appeared in `GET /api/events`, and
 * both `GET /api/fingerprints` and `GET /api/metrics/history` returned
 * `{}` — the event was invisible to exactly the endpoint that CI drift
 * checks (`event-catalog drift`, `ec-bundle-diff`) compare against.
 *
 * The response builders now use null-prototype maps as well, so this
 * list is the belt to that braces: a name that cannot be represented
 * honestly as an object key is rejected at the write boundary rather
 * than silently misreported at every read.
 */
export const RESERVED_EVENT_NAMES: readonly string[] = [
  '__proto__',
  'constructor',
  'prototype',
];

/**
 * Validate an event name supplied over HTTP. Returns an error string, or
 * null when the name is acceptable.
 *
 * Deliberately narrow: event names across the platform use `.`, `:`, `-`
 * and `_` in a variety of shapes, and this is not the place to impose a
 * naming grammar (the CLI linter owns that). It rejects only what is
 * actively unsafe — control characters, which corrupt log lines and SSE
 * frames; unbounded length; and the reserved keys above.
 */
export function validateEventName(name: string): string | null {
  if (name.length > MAX_EVENT_NAME_LENGTH) {
    return `name must be ≤ ${MAX_EVENT_NAME_LENGTH} characters`;
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'name must not contain control characters';
  }
  if (RESERVED_EVENT_NAMES.includes(name)) {
    return `name must not be one of: ${RESERVED_EVENT_NAMES.join(', ')}`;
  }
  return null;
}

/**
 * Guard an array-valued body field against an element ceiling. Writes a
 * 400 and returns false when `value` is over `max`; the caller returns
 * immediately on false.
 */
export function withinArrayLimit(
  res: Response,
  value: readonly unknown[],
  max: number,
  field: string,
): boolean {
  if (value.length > max) {
    badRequest(res, `${field} must contain at most ${max} entries (got ${value.length})`);
    return false;
  }
  return true;
}

/**
 * Build a plain object safe to use with attacker-influenced keys.
 *
 * `{}` inherits `Object.prototype`, so `obj['__proto__'] = x` runs the
 * prototype setter instead of creating an own property: a string value
 * is silently discarded and an object value re-parents the map. A
 * null-prototype object has no such accessor, so every key round-trips
 * through `JSON.stringify` as written.
 */
export function keySafeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
