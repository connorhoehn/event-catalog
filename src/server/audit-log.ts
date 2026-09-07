// src/server/audit-log.ts
//
// wave23-a — persistent audit log. The wave22-d auditEmitter is
// process-local; SSE clients miss everything fired before they
// connected. This wraps the emitter with a Redis-backed capped
// list so operators can scroll back, and so the /api/audit SSE
// can replay the last N events on connect.
//
// Storage: a single Redis list at `event-catalog:audit-log` with
// LPUSH on every emit + LTRIM to cap. Read via LRANGE on connect.
// Survives catalog restarts; lost on Redis loss (acceptable for an
// audit feed — DLQ + registry remain authoritative).

import type { RedisClientType } from 'redis';
import { auditEmitter, type AuditEvent } from './audit-emitter.js';

const REDIS_KEY = 'event-catalog:audit-log';

/** Cap the persisted log so it doesn't grow unbounded. */
const DEFAULT_CAP = 1000;

export interface AuditLogOptions {
  redis: RedisClientType;
  cap?: number;
}

/**
 * Wires the in-memory auditEmitter to a capped Redis list. Returns
 * an object with `recent(limit)` for HTTP queries and a `stop()` to
 * detach the listener on shutdown. Idempotent — calling twice
 * registers two listeners (caller's responsibility).
 */
export function startAuditLog(opts: AuditLogOptions): {
  recent(limit?: number): Promise<AuditEvent[]>;
  stop(): void;
} {
  const cap = opts.cap ?? DEFAULT_CAP;
  const redis = opts.redis;

  const handler = async (event: AuditEvent): Promise<void> => {
    try {
      await redis.lPush(REDIS_KEY, JSON.stringify(event));
      // LTRIM to keep the list at most `cap` long. The 0..cap-1
      // slice keeps the most recent entries (since we LPUSH).
      await redis.lTrim(REDIS_KEY, 0, cap - 1);
    } catch {
      // Swallow — Redis hiccup shouldn't block the audit emit.
      // The emitter already delivered to live SSE listeners.
    }
  };

  auditEmitter.on('audit', handler);

  return {
    async recent(limit?: number): Promise<AuditEvent[]> {
      const n = Math.max(1, Math.min(cap, limit ?? 50));
      try {
        const raw = await redis.lRange(REDIS_KEY, 0, n - 1);
        // LPUSH means index 0 is most recent; reverse so caller gets
        // chronological order (oldest → newest).
        const parsed: AuditEvent[] = [];
        for (const r of raw) {
          try {
            parsed.push(JSON.parse(r) as AuditEvent);
          } catch {
            // Drop unparseable entries silently.
          }
        }
        return parsed.reverse();
      } catch (err) {
        // Do NOT return [] here. An empty array is indistinguishable from
        // "no audit history", so a Redis failure rendered as a confident
        // "nothing has happened" — the same lie the DLQ list used to tell
        // during a DynamoDB outage. Let the caller decide how to surface it.
        throw new Error(
          `audit history unavailable: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    },
    stop(): void {
      auditEmitter.off('audit', handler);
    },
  };
}
