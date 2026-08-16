// src/utils/redis-boot-strategy.ts
//
// Bound INITIAL Redis connect attempts so the server's `.catch()` fallbacks
// on every `connect()` call site are actually reachable.
//
// Why: node-redis consults socket.reconnectStrategy on every socket drop,
// INCLUDING failures of the very first connect(). With the default
// always-return-a-number strategy, connect() retries forever and never
// rejects when Redis is down — so the `.catch()` arms in createServer()
// never ran, boot never reached `app.listen()`, and nothing bound :3010.
// Observed as an endless `[server] registry Redis error:` loop with no
// further output.
//
// Fix: until the FIRST successful connect, the strategy returns an Error
// once the attempt budget is exhausted — node-redis then stops retrying and
// the in-flight connect() promise rejects, so the caller's catch/degrade
// path engages within seconds. After markConnected() (called once connect()
// resolves), the strategy reverts to infinite capped backoff, so a transient
// Redis blip POST-boot keeps reconnecting forever and never kills the process.
//
// Ported from websocket-gateway's src/utils/redis-boot-strategy.ts
// (hub#1496, commit 4092a1af) — same failure mode, same remedy. Kept as a
// local copy rather than a shared import: event-catalog must not depend on
// the gateway, and the helper is ~40 lines of pure logic.

export interface BootBoundedReconnectStrategy {
  /** Pass as `socket.reconnectStrategy` to redis.createClient(). */
  reconnectStrategy: (retries: number) => number | Error;
  /**
   * Call once the client's initial connect() has resolved. Permanently
   * switches the strategy to infinite capped backoff for reconnects.
   */
  markConnected: () => void;
}

/** Default total connect attempts during boot (initial attempt included). */
export const DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS = 3;

/** Backoff multiplier: delay = retries * BASE_MS. */
const DEFAULT_BASE_MS = 100;

/** Backoff cap. */
const DEFAULT_MAX_MS = 3_000;

/**
 * Resolve the boot-time connect-attempt budget from the environment.
 * REDIS_BOOT_CONNECT_ATTEMPTS must be a number >= 1; anything else
 * (unset, garbage, 0, negative) falls back to the default of 3.
 */
export function resolveBootConnectAttempts(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.REDIS_BOOT_CONNECT_ATTEMPTS;
  if (raw === undefined || raw === '') return DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_REDIS_BOOT_CONNECT_ATTEMPTS;
  return Math.floor(n);
}

/**
 * Build a reconnect strategy that is bounded until the first successful
 * connect, then infinite.
 *
 * @param opts.bootAttempts - total socket connect attempts allowed during
 *   boot, INCLUDING the initial one (node-redis's `retries` argument counts
 *   re-attempts after the initial connect, starting at 0 — so we give up
 *   when `retries + 1 >= bootAttempts`). Defaults to the env-resolved budget.
 * @param opts.baseMs - backoff multiplier (delay = retries * baseMs).
 * @param opts.maxMs  - backoff cap.
 * @param opts.label  - client name for the give-up error message.
 */
export function createBootBoundedReconnectStrategy(opts: {
  bootAttempts?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
} = {}): BootBoundedReconnectStrategy {
  const {
    bootAttempts = resolveBootConnectAttempts(),
    baseMs = DEFAULT_BASE_MS,
    maxMs = DEFAULT_MAX_MS,
    label,
  } = opts;
  let connectedOnce = false;

  return {
    reconnectStrategy(retries: number): number | Error {
      if (!connectedOnce && retries + 1 >= bootAttempts) {
        // Returning an Error makes node-redis stop reconnecting and reject
        // the pending connect() promise — exactly what the caller's
        // catch/degrade path needs to observe.
        return new Error(
          `Redis initial connect${label ? ` (${label})` : ''} failed after `
          + `${bootAttempts} attempt(s) — giving up so the degraded-mode `
          + 'fallback can engage (REDIS_BOOT_CONNECT_ATTEMPTS to tune)',
        );
      }
      return Math.min(retries * baseMs, maxMs);
    },
    markConnected(): void {
      connectedOnce = true;
    },
  };
}

/**
 * node-redis surfaces socket failures as an AggregateError whose own
 * `.message` is the empty string — which is why the boot loop logged
 * `[server] registry Redis error:` with nothing after it. Dig out something
 * an operator can actually act on: the aggregated causes, then the errno
 * code, then the raw stringification.
 */
export function formatRedisError(err: unknown): string {
  if (err === null || err === undefined) return 'unknown error';

  const e = err as {
    message?: string;
    code?: string;
    errors?: unknown[];
  };

  if (typeof e.message === 'string' && e.message !== '') return e.message;

  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const causes = e.errors
      .map(inner => formatRedisError(inner))
      .filter(m => m !== 'unknown error');
    if (causes.length > 0) {
      // Dedupe — a dual-stack DNS result yields the same ECONNREFUSED twice.
      return [...new Set(causes)].join('; ');
    }
  }

  if (typeof e.code === 'string' && e.code !== '') return e.code;

  const s = String(err);
  return s === '' || s === '[object Object]' ? 'unknown error' : s;
}
