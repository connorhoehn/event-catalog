// src/server/audit-emitter.ts
//
// wave22-d — process-internal emitter for registry MUTATION events
// (declarations, version bumps, subscriber add/remove). Mirror of
// `tap-emitter.ts` (wave19-d) but for the slow path: when an
// operator declares a new event or a consumer subscribes, the audit
// emitter publishes a structured AuditEvent that the
// `GET /api/audit` SSE endpoint streams to admin UI clients.
//
// Wired from `Registry.declare()` and the subscriber routes; the
// emitter itself is a tiny EventEmitter with no Redis hop, keeping
// the audit feed honest about what THIS server saw.

import { EventEmitter } from 'node:events';

export type AuditEventKind =
  | 'event.declared'        // new event added to the registry
  | 'event.version.bumped'  // schema changed, version incremented
  | 'event.removed'         // explicit DELETE /api/events/:name
  | 'event.deprecated'      // wave25-a — marked deprecated
  | 'event.undeprecated'    // wave25-a — un-marked
  | 'event.poisoned'        // wave26-e — failure threshold breached
  | 'event.poison.cleared'  // wave26-e — operator dismissed poison state
  | 'subscriber.added'
  | 'subscriber.removed';

export interface AuditEvent {
  kind: AuditEventKind;
  /** ISO 8601 timestamp at observation. */
  timestamp: string;
  /** Event name the mutation applies to. */
  eventName: string;
  /** Namespace from the canonical RegistryEntry (when known). */
  namespace?: string;
  /** Version number on event.declared / event.version.bumped. */
  version?: number;
  /** sha256 fingerprint when relevant (declared / version-bumped). */
  fingerprint?: string;
  /** Service name on subscriber.added / subscriber.removed. */
  serviceName?: string;
  /** Compat-violation list when a version bump landed in warn mode. */
  violations?: string[];
  /** wave25-a — operator-supplied reason on event.deprecated. */
  reason?: string;
  /** wave25-a — `by` field on event.deprecated (who marked it). */
  by?: string;
}

export interface AuditFilter {
  kind?: AuditEventKind;
  eventName?: string;
  namespace?: string;
  serviceName?: string;
}

export function matchesAuditFilter(event: AuditEvent, filter: AuditFilter): boolean {
  if (filter.kind && event.kind !== filter.kind) return false;
  if (filter.eventName && event.eventName !== filter.eventName) return false;
  if (filter.namespace && event.namespace !== filter.namespace) return false;
  if (filter.serviceName && event.serviceName !== filter.serviceName) return false;
  return true;
}

class AuditEmitter extends EventEmitter {
  publish(event: AuditEvent): void {
    this.emit('audit', event);
  }
}

/** Module-singleton audit emitter. setMaxListeners(0) for SSE clients. */
export const auditEmitter = new AuditEmitter();
auditEmitter.setMaxListeners(0);
