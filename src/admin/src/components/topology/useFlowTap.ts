// useFlowTap — subscribes to the catalog's GET /api/flow SSE stream.
//
// Returns the latest TapEvents (capped) and an isLive flag so the
// caller can render flow-driven UI. Pausing detaches EventSource;
// resuming re-attaches.

import { useEffect, useRef, useState } from 'react';

export interface TapEvent {
  eventName: string;
  namespace: string;
  producer: string;
  transport: 'signal' | 'durable';
  timestamp: string;
  channel?: string;
  queue?: string;
  envelope?: unknown;
}

export interface FlowTapFilters {
  namespace?: string;
  transport?: 'signal' | 'durable';
  producer?: string;
  eventName?: string;
  sample?: number;
}

export interface FlowTapState {
  isLive: boolean;
  events: TapEvent[];
  lastEvent: TapEvent | null;
  error: string | null;
}

export interface FlowTapHandle extends FlowTapState {
  pause(): void;
  resume(): void;
  clear(): void;
}

const MAX_BUFFER = 200;

/**
 * Is this parsed frame actually a tap event?
 *
 * `JSON.parse` succeeding is not the same as the frame being a TapEvent:
 * `null`, `"a string"` and `{"ok":true}` all parse cleanly. Anything that got
 * into the buffer was then read by the flow ticker as `e.timestamp.slice(...)`
 * and `e.producer`, so one off-shape frame threw during render and took the
 * entire Live Flow view down — graph included — with a blank screen and no
 * way back except a reload.
 *
 * `eventName` and `timestamp` are the two fields every consumer dereferences,
 * so those are what "well-formed" means here. The optional fields (channel,
 * queue, envelope) are genuinely optional and are not checked.
 */
function isTapEvent(value: unknown): value is TapEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.eventName === 'string' && typeof v.timestamp === 'string';
}

/**
 * Open an EventSource on /api/flow with the given filters. The hook
 * keeps a ring buffer of the most recent N tap events. Re-attaches
 * when filters change.
 */
export function useFlowTap(filters: FlowTapFilters, initiallyLive = true): FlowTapHandle {
  const [events, setEvents] = useState<TapEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<TapEvent | null>(null);
  const [isLive, setIsLive] = useState(initiallyLive);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isLive) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    const qs = new URLSearchParams();
    if (filters.namespace) qs.set('namespace', filters.namespace);
    if (filters.transport) qs.set('transport', filters.transport);
    if (filters.producer) qs.set('producer', filters.producer);
    if (filters.eventName) qs.set('eventName', filters.eventName);
    if (filters.sample && filters.sample > 1) qs.set('sample', String(filters.sample));

    const url = `/api/flow${qs.toString() ? `?${qs}` : ''}`;
    const es = new EventSource(url);
    sourceRef.current = es;
    setError(null);

    es.onmessage = (msg) => {
      try {
        const parsed: unknown = JSON.parse(msg.data);
        if (!isTapEvent(parsed)) return;
        const ev = parsed;
        setLastEvent(ev);
        setEvents((prev) => {
          const next = [...prev, ev];
          return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
        });
      } catch {
        // Drop malformed frames silently.
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on its own; only surface an error
      // when the connection is closed for good.
      if (es.readyState === EventSource.CLOSED) {
        setError('SSE connection closed');
      }
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [
    isLive,
    filters.namespace,
    filters.transport,
    filters.producer,
    filters.eventName,
    filters.sample,
  ]);

  return {
    isLive,
    events,
    lastEvent,
    error,
    pause: () => setIsLive(false),
    resume: () => setIsLive(true),
    clear: () => {
      setEvents([]);
      setLastEvent(null);
    },
  };
}
