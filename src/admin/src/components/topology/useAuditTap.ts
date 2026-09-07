// useAuditTap — subscribes to /api/audit SSE for registry mutation
// events. Companion to useFlowTap (which streams the fast path); this
// streams the slow path: declarations, version bumps, removals,
// subscriber add/remove. Powers the admin UI's registry-changes
// panel.

import { useEffect, useRef, useState } from 'react';

export type AuditEventKind =
  | 'event.declared'
  | 'event.version.bumped'
  | 'event.removed'
  | 'subscriber.added'
  | 'subscriber.removed';

export interface AuditEvent {
  kind: AuditEventKind;
  timestamp: string;
  eventName: string;
  namespace?: string;
  version?: number;
  fingerprint?: string;
  serviceName?: string;
  violations?: string[];
}

export interface AuditFilters {
  kind?: AuditEventKind;
  eventName?: string;
  namespace?: string;
  serviceName?: string;
}

export interface AuditTapHandle {
  isLive: boolean;
  events: AuditEvent[];
  lastEvent: AuditEvent | null;
  error: string | null;
  pause(): void;
  resume(): void;
  clear(): void;
}

const MAX_BUFFER = 200;

const KNOWN_KINDS = new Set<string>([
  'event.declared',
  'event.version.bumped',
  'event.removed',
  'subscriber.added',
  'subscriber.removed',
]);

/**
 * Same guard as useFlowTap's, plus `kind`.
 *
 * A frame that parses but is off-shape used to reach the renderer, which does
 * `kindMeta[event.kind].label` and `event.timestamp.slice(...)` — an unknown
 * kind from a newer server, or a stray non-object frame, threw during render
 * and blanked the whole Registry Changes view. Unknown kinds are dropped here
 * rather than rendered, which is the failure an operator can recover from:
 * one missing row instead of no page.
 */
function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eventName === 'string' &&
    typeof v.timestamp === 'string' &&
    typeof v.kind === 'string' &&
    KNOWN_KINDS.has(v.kind)
  );
}

export function useAuditTap(filters: AuditFilters, initiallyLive = true): AuditTapHandle {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<AuditEvent | null>(null);
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
    if (filters.kind) qs.set('kind', filters.kind);
    if (filters.eventName) qs.set('eventName', filters.eventName);
    if (filters.namespace) qs.set('namespace', filters.namespace);
    if (filters.serviceName) qs.set('serviceName', filters.serviceName);
    const url = `/api/audit${qs.toString() ? `?${qs}` : ''}`;
    const es = new EventSource(url);
    sourceRef.current = es;
    setError(null);

    es.onmessage = (msg) => {
      try {
        const parsed: unknown = JSON.parse(msg.data);
        if (!isAuditEvent(parsed)) return;
        const ev = parsed;
        setLastEvent(ev);
        setEvents((prev) => {
          const next = [...prev, ev];
          return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
        });
      } catch {
        /* drop malformed frame */
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setError('SSE connection closed');
      }
    };
    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [isLive, filters.kind, filters.eventName, filters.namespace, filters.serviceName]);

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
