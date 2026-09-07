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

// ─── Per-publish frame memo ──────────────────────────────────────────────
//
// Every open /api/flow stream that passes its filter writes the SAME
// bytes for a given tap event, because the frame is just the serialized
// event — no per-stream content at all. The route used to call
// `JSON.stringify(event)` inside its listener, so one publish observed
// by 250 admin streams serialized the identical object 250 times: at
// ~0.34µs per stringify that is ~84µs of pure duplicate work per event,
// scaling linearly with how many operators happen to have the flow view
// open. Serializing once and handing every stream the same string
// removes all of it.
//
// A one-slot memo rather than a WeakMap: within a single `publish()` all
// listeners run synchronously back-to-back on the same object, so one
// slot hits every time, costs one reference compare, and allocates
// nothing. `publish()` clears the slot before emitting, so even a caller
// that reused and mutated a TapEvent object between publishes gets a
// fresh serialization — staleness is not reachable.

let framedEvent: TapEvent | null = null;
let framedText = '';

/**
 * The SSE `data:` frame for a tap event, serialized at most once per
 * `tapEmitter.publish()` no matter how many streams ask for it.
 */
export function tapFrame(event: TapEvent): string {
  if (framedEvent === event) return framedText;
  framedEvent = event;
  framedText = `data: ${JSON.stringify(event)}\n\n`;
  return framedText;
}

class TapEmitter extends EventEmitter {
  publish(event: TapEvent): void {
    // Invalidate before the emit, not after: a re-published object must
    // never serve the frame it had on its previous publish.
    framedEvent = null;
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
