import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import {
  Banner,
  Chip,
  DetailPage,
  DetailSection,
  Disclosure,
  EmptyState,
  ErrorState,
  Inline,
  KeyValue,
  LiveRegion,
  SkeletonCard,
  Stack,
  StatStrip,
  type BreadcrumbItem,
  type KeyValueItem,
} from '@connorhoehn/ui-components/shared';
import { api, type EventEntry, type EventStats } from '../api';
import { FingerprintChip } from './FingerprintChip';
import { SchemaDiffToggle } from './SchemaDiff';

interface ObservedProducers {
  declared: string[];
  observed: string[];
  undeclaredProducers: string[];
  deadDeclaredProducers: string[];
  mismatch: boolean;
}

export function EventDetail() {
  const { name } = useParams<{ name: string }>();
  const [event, setEvent] = useState<EventEntry | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [observedProducers, setObservedProducers] = useState<ObservedProducers | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    const decoded = decodeURIComponent(name);

    // Only the event itself is fatal. `/history` reads through the transport,
    // so it 500s whenever Redis or the message queue is down — and because it
    // shared this `Promise.all`'s rejection path, a sick transport replaced
    // the entire detail page (schema, fingerprint, subscribers, all of it,
    // none of which depends on the transport) with "Error loading this
    // event". Its failure is now reported inside the section it belongs to.
    Promise.all([
      api.getEvent(decoded),
      api.getEventHistory(decoded, 20).catch((err: Error) => {
        setHistoryError(err.message);
        return { messages: [] as unknown[], transport: '' };
      }),
      api.getObservedProducers(decoded).catch(() => null),
    ]).then(([eventRes, historyRes, observedRes]) => {
      setEvent(eventRes);
      setStats(eventRes.stats);
      setHistory(historyRes.messages);
      if (observedRes) setObservedProducers(observedRes);
    }).catch(err => setError(err.message));
  }, [name]);

  useEffect(() => {
    if (!name) return;
    const decoded = decodeURIComponent(name);
    const interval = setInterval(() => {
      api.getEventStats(decoded).then(setStats).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [name]);

  // The trail's "Events" crumb is a client-side route change, not a reload.
  const navigate = useNavigate();
  const eventsCrumb: BreadcrumbItem = {
    label: 'Events',
    href: '/events',
    onClick: (e) => {
      e.preventDefault();
      navigate('/events');
    },
  };
  const decodedName = name ? decodeURIComponent(name) : '';

  if (error) {
    return (
      <DetailPage title={decodedName} breadcrumbs={[eventsCrumb, { label: decodedName }]}>
        <ErrorState
          title="Error loading this event"
          description={error}
          action={<Link to="/events">Back to all events</Link>}
        />
      </DetailPage>
    );
  }
  if (!event) {
    return (
      <Stack gap="md" aria-busy="true">
        <SkeletonCard height={40} />
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
        <LiveRegion role="none" message="Loading event…" />
      </Stack>
    );
  }

  const registration: KeyValueItem[] = [
    {
      label: 'Declared Producer',
      value: Array.isArray(event.producer) ? event.producer.join(', ') : event.producer,
    },
  ];
  if (observedProducers && observedProducers.observed.length > 0) {
    registration.push({
      label: 'Observed Producers',
      value: (
        <Inline gap="xs" wrap>
          {observedProducers.observed.map(p => (
            <Chip
              key={p}
              tone={observedProducers.undeclaredProducers.includes(p) ? 'warning' : 'success'}
              size="xs"
              title={observedProducers.undeclaredProducers.includes(p) ? 'Undeclared publisher' : 'Declared publisher'}
            >
              {p}
            </Chip>
          ))}
        </Inline>
      ),
    });
  }
  if (observedProducers && observedProducers.deadDeclaredProducers.length > 0) {
    registration.push({
      label: 'Dead Declared',
      value: (
        <Inline gap="xs" wrap>
          {observedProducers.deadDeclaredProducers.map(p => (
            <Chip key={p} tone="neutral" size="xs" title="Declared but never published">
              {p}
            </Chip>
          ))}
        </Inline>
      ),
    });
  }
  registration.push(
    {
      label: 'Transport',
      value: event.transport === 'signal' ? 'Signal (Redis Pub/Sub — Ephemeral)' : 'Durable (Message Queue — At-Least-Once)',
    },
    { label: 'Registered', value: new Date(event.metadata.createdAt).toLocaleString() },
    { label: 'Subscribers', value: event.subscribers.length > 0 ? event.subscribers.join(', ') : 'None' },
  );
  if (event.tags && event.tags.length > 0) {
    registration.push({
      label: 'Tags',
      value: (
        <Inline gap="xs" wrap>
          {event.tags.map(t => (
            <Chip key={t} tone="purple" size="xs">{t}</Chip>
          ))}
        </Inline>
      ),
    });
  }

  return (
    <DetailPage
      title={event.name}
      breadcrumbs={[eventsCrumb, { label: event.name }]}
      description={event.description || undefined}
      badge={
        <Inline gap="xs" wrap align="center">
          <Chip tone={event.transport === 'signal' ? 'info' : 'warning'}>
            {event.transport}
          </Chip>
          {event.namespace ? <Chip tone="purple">{event.namespace}</Chip> : null}
          {event.version ? <Chip tone="neutral">v{event.version}</Chip> : null}
          <FingerprintChip fingerprint={event.schemaFingerprint} />
          {event.deprecation ? <Chip tone="danger">deprecated</Chip> : null}
          {observedProducers?.mismatch ? (
            <Chip tone="warning" title={`Undeclared: ${observedProducers.undeclaredProducers.join(', ') || 'none'} | Dead declared: ${observedProducers.deadDeclaredProducers.join(', ') || 'none'}`}>
              producer mismatch
            </Chip>
          ) : null}
        </Inline>
      }
    >
      {event.deprecation && (
        <Banner variant="warning" layout="stacked" title="Deprecated">
          on {new Date(event.deprecation.deprecatedAt).toLocaleString()}
          {event.deprecation.by ? ` by ${event.deprecation.by}` : ''}
          {event.deprecation.reason && <div>{event.deprecation.reason}</div>}
        </Banner>
      )}

      <DetailSection title="Live Metrics" first variant="heading">
        {/* Repolled every two seconds. Announcing each poll would make the
            page unusable, so the numbers themselves are NOT a live region;
            a coalesced summary is spoken at most once every 15s instead. */}
        <LiveRegion
          throttleMs={15_000}
          message={
            stats
              ? `Metrics update: ${stats.publishRate.toFixed(2)} per second, ${stats.publishCount} total, ${stats.errorCount} errors.`
              : ''
          }
        />
        <StatStrip
          aria-label="Live metrics"
          items={[
            { label: 'Publish Rate', value: stats ? `${stats.publishRate.toFixed(2)}/s` : '—' },
            { label: 'Total Published', value: stats ? stats.publishCount.toLocaleString() : '—' },
            { label: 'Subscribers', value: stats ? stats.subscriberCount : '—' },
            {
              label: 'Errors',
              value: stats ? stats.errorCount : '—',
              tone: (stats?.errorCount ?? 0) > 0 ? 'danger' : 'default',
            },
            ...(stats?.queueDepth !== undefined ? [{ label: 'Queue Depth', value: stats.queueDepth }] : []),
          ]}
        />
      </DetailSection>

      <DetailSection title="Schema" variant="heading">
        <pre className="schema-viewer">
          {JSON.stringify(event.schema, null, 2)}
        </pre>
      </DetailSection>

      {event.schemaHistory && event.schemaHistory.length > 0 ? (
        <DetailSection title={`Schema History (${event.schemaHistory.length})`} variant="heading">
          <Stack gap="sm">
            {event.schemaHistory.map((h) => (
              <Inline key={h.version} gap="sm" align="center" wrap>
                <Chip tone="neutral">v{h.version}</Chip>
                <FingerprintChip fingerprint={h.fingerprint} label="" />
                <span className="schema-history-time">
                  {new Date(h.updatedAt).toLocaleString()}
                </span>
                <SchemaDiffToggle before={h.schema} after={event.schema} />
              </Inline>
            ))}
          </Stack>
        </DetailSection>
      ) : null}

      <DetailSection title="Registration" variant="heading">
        <KeyValue items={registration} aria-label="Registration" />
      </DetailSection>

      <DetailSection title={`Recent Messages (${history.length})`} variant="heading">
        {historyError ? (
          <ErrorState
            title="Couldn't load recent messages"
            description={historyError}
          />
        ) : history.length === 0 ? (
          <EmptyState title="No recent messages captured." />
        ) : (
          <Stack gap="xs">
            {history.map((msg, i) => (
              <Disclosure
                key={i}
                summary={
                  <>
                    Message #{history.length - i}
                    {(msg as Record<string, unknown>).metadata
                      ? ` — ${new Date(((msg as Record<string, unknown>).metadata as Record<string, unknown>).timestamp as number).toLocaleTimeString()}`
                      : null
                    }
                  </>
                }
              >
                <pre>{JSON.stringify(msg, null, 2)}</pre>
              </Disclosure>
            ))}
          </Stack>
        )}
      </DetailSection>
    </DetailPage>
  );
}
