// wave22-e — Admin UI registry-changes panel.
//
// Live feed of AuditEvents from /api/audit SSE. Renders newest-first
// in a virtualizable list (cap at 200). Kind-coded chips help the
// operator scan: green = added, red = removed, blue = bumped,
// neutral = subscriber state.
//
// Companion to /flow (the fast path, message-level). This is the
// slow path — registry mutations that change *what's declared*,
// not *what's flowing*.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import { Button } from '@ui/components/ui/Button';
import { useAuditTap, type AuditEvent, type AuditEventKind } from './topology/useAuditTap';

const kindMeta: Record<AuditEventKind, { label: string; tone: 'success' | 'danger' | 'info' | 'neutral'; verb: string }> = {
  'event.declared':       { label: 'declared',     tone: 'success', verb: 'declared' },
  'event.version.bumped': { label: 'version bump', tone: 'info',    verb: 'bumped to v' },
  'event.removed':        { label: 'removed',      tone: 'danger',  verb: 'removed' },
  'subscriber.added':     { label: 'subscriber +', tone: 'neutral', verb: 'subscribed' },
  'subscriber.removed':   { label: 'subscriber −', tone: 'neutral', verb: 'unsubscribed' },
};

export function AuditView() {
  const [kindFilter, setKindFilter] = useState<AuditEventKind | ''>('');
  const [namespaceFilter, setNamespaceFilter] = useState('');

  const tap = useAuditTap({
    kind: kindFilter || undefined,
    namespace: namespaceFilter || undefined,
  });

  const newestFirst = [...tap.events].reverse();
  const namespaces = new Set<string>();
  for (const e of tap.events) if (e.namespace) namespaces.add(e.namespace);

  return (
    <div className="audit-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <h2 style={{ margin: 0 }}>Registry Changes</h2>
        <Chip tone={tap.isLive ? 'success' : 'neutral'}>{tap.isLive ? 'live' : 'paused'}</Chip>
        <Chip tone="neutral">{tap.events.length} events</Chip>
        {tap.error && <Chip tone="warning">{tap.error}</Chip>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#475569' }}>kind</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as AuditEventKind | '')}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
          >
            <option value="">all</option>
            <option value="event.declared">event.declared</option>
            <option value="event.version.bumped">event.version.bumped</option>
            <option value="event.removed">event.removed</option>
            <option value="subscriber.added">subscriber.added</option>
            <option value="subscriber.removed">subscriber.removed</option>
          </select>

          <label style={{ fontSize: 12, color: '#475569', marginLeft: 8 }}>namespace</label>
          <select
            value={namespaceFilter}
            onChange={(e) => setNamespaceFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }}
          >
            <option value="">all</option>
            {[...namespaces].sort().map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>

          {tap.isLive ? (
            <Button variant="secondary" size="sm" onClick={tap.pause}>Pause</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={tap.resume}>Resume</Button>
          )}
          <Button variant="ghost" size="sm" onClick={tap.clear}>Clear</Button>
        </div>
      </div>

      {tap.events.length === 0 ? (
        <Banner variant="info">
          Waiting for the next registry mutation. Try declaring an event via{' '}
          <code>POST /api/events</code> in another shell.
        </Banner>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {newestFirst.map((ev, i) => (
            <AuditRow key={`${ev.timestamp}-${i}`} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const meta = kindMeta[event.kind];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid #f1f5f9',
        fontSize: 13,
      }}
    >
      <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', fontSize: 11, minWidth: 90 }}>
        {event.timestamp.slice(11, 23)}
      </span>
      <Chip tone={meta.tone}>{meta.label}</Chip>
      {event.namespace ? <Chip tone="purple">{event.namespace}</Chip> : null}
      <Link to={`/events/${encodeURIComponent(event.eventName)}`} style={{ fontWeight: 600, color: '#0f172a' }}>
        {event.eventName}
      </Link>
      {event.version !== undefined ? (
        <Chip tone="neutral">v{event.version}</Chip>
      ) : null}
      {event.serviceName ? (
        <span style={{ color: '#475569', fontSize: 12 }}>by {event.serviceName}</span>
      ) : null}
      {event.violations && event.violations.length > 0 ? (
        <Chip tone="warning">{event.violations.length} compat warn</Chip>
      ) : null}
    </div>
  );
}
