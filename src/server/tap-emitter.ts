// src/server/tap-emitter.ts
//
// Phase E8 — live flow tap.
//
// Process-internal EventEmitter that publishes a per-event "I saw this
// flow" notification. The SSE endpoint at GET /api/flow listens on this
// emitter and streams filtered events to admin-UI clients.
//
// Wired from `MetricsObserver`'s existing signal subscription path
// (which already sees every signal envelope flowing through declared
// channels). Durable observations are coarser — emitted from the
// polling loop when `sent` counters rise — and carry no payload.

import { EventEmitter } from 'node:events';

export interface TapEvent {
  /** Canonical event name as declared in the registry. */
  eventName: string;
  /** Namespace from the RegistryEntry (auto-derived or explicit). */
  namespace: string;
  /** First authoritative producer from the declaration. */
  producer: string;
  transport: 'signal' | 'durable';
  /** ISO 8601 timestamp at observation (catalog server wall clock). */
  timestamp: string;
  /** Redis channel pattern (signal-only). */
  channel?: string;
  /** Message-queue queue name (durable-only). */
  queue?: string;
  /**
   * Full inner envelope payload when available (signal taps deliver
   * this; durable polls do not — only the publish count rises).
   */
  envelope?: unknown;
}

export interface TapFilter {
  eventName?: string;
  transport?: 'signal' | 'durable';
  producer?: string;
  namespace?: string;
}

/**
 * Apply a TapFilter to a TapEvent. Exported for testability — the route
 * uses the same predicate.
 */
export function matchesTapFilter(event: TapEvent, filter: TapFilter): boolean {
  if (filter.eventName && event.eventName !== filter.eventName) return false;
  if (filter.transport && event.transport !== filter.transport) return false;
  if (filter.producer && event.producer !== filter.producer) return false;
  if (filter.namespace && event.namespace !== filter.namespace) return false;
  return true;
}

class TapEmitter extends EventEmitter {
  publish(event: TapEvent): void {
    this.emit('publish', event);
  }
}

/**
 * Module-singleton tap emitter. Both the producer side (MetricsObserver
 * + durable poll) and the consumer side (SSE route handler) import this
 * one instance — process-local, no Redis round-trip, no broadcast amp.
 *
 * setMaxListeners(0) — every SSE client adds one listener; we don't
 * want Node's default warning at 10.
 */
export const tapEmitter = new TapEmitter();
tapEmitter.setMaxListeners(0);
