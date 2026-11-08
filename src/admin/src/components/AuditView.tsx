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
import { Link } from 'react-router';
import { Chip, Banner, LiveRegion, Button, FormField, Inline, PageFrame, Select } from '@connorhoehn/ui-components/shared';
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

  const kindOptions = [
    { value: '', label: 'all' },
    ...(Object.keys(kindMeta) as AuditEventKind[]).map((k) => ({ value: k, label: k })),
  ];
  const namespaceOptions = [
    { value: '', label: 'all' },
    ...[...namespaces].sort().map((ns) => ({ value: ns, label: ns })),
  ];

  return (
    <PageFrame
      title="Registry Changes"
      className="audit-view"
      badge={
        <Inline gap="sm">
          <Chip tone={tap.isLive ? 'success' : 'neutral'}>{tap.isLive ? 'live' : 'paused'}</Chip>
          <Chip tone="neutral">{tap.events.length} events</Chip>
          {tap.error && (
            <span role="status">
              <Chip tone="warning">{tap.error}</Chip>
            </span>
          )}
        </Inline>
      }
      actions={
        <Inline gap="sm" align="center">
          <FormField label="kind" layout="inline">
            {(w) => (
              <Select
                id={w.id}
                size="sm"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as AuditEventKind | '')}
                options={kindOptions}
              />
            )}
          </FormField>
          <FormField label="namespace" layout="inline">
            {(w) => (
              <Select
                id={w.id}
                size="sm"
                value={namespaceFilter}
                onChange={(e) => setNamespaceFilter(e.target.value)}
                options={namespaceOptions}
              />
            )}
          </FormField>
          {tap.isLive ? (
            <Button variant="secondary" size="sm" onClick={tap.pause}>Pause</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={tap.resume}>Resume</Button>
          )}
          <Button variant="ghost" size="sm" onClick={tap.clear}>Clear</Button>
        </Inline>
      }
    >
      {tap.events.length === 0 ? (
        <Banner variant="info">
          Waiting for the next registry mutation. Try declaring an event via{' '}
          <code>POST /api/events</code> in another shell.
        </Banner>
      ) : (
        <div className="view-scroll tight">
          {/* Registry mutations are rare — seconds to hours apart — so unlike
              the flow ticker this feed can afford to announce, and a schema
              changing under an operator mid-incident is worth hearing. Still
              polite, and still coalesced, in case a deploy declares fifty
              events at once. */}
          <LiveRegion
            throttleMs={3_000}
            message={
              newestFirst[0]
                ? `Registry change: ${kindMeta[newestFirst[0].kind].label} ${newestFirst[0].eventName}.`
                : ''
            }
          />
          <ul className="audit-list" aria-live="off" aria-label="Registry changes, newest first">
            {newestFirst.map((ev, i) => (
              <li key={`${ev.timestamp}-${i}`}>
                <AuditRow event={ev} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageFrame>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const meta = kindMeta[event.kind];
  return (
    <div className="audit-row">
      <span className="audit-time">
        {event.timestamp.slice(11, 23)}
      </span>
      <Chip tone={meta.tone}>{meta.label}</Chip>
      {event.namespace ? <Chip tone="purple">{event.namespace}</Chip> : null}
      <Link to={`/events/${encodeURIComponent(event.eventName)}`} className="link-plain semibold">
        {event.eventName}
      </Link>
      {event.version !== undefined ? (
        <Chip tone="neutral">v{event.version}</Chip>
      ) : null}
      {event.serviceName ? (
        <span className="audit-service">by {event.serviceName}</span>
      ) : null}
      {event.violations && event.violations.length > 0 ? (
        <Chip tone="warning">{event.violations.length} compat warn</Chip>
      ) : null}
    </div>
  );
}
