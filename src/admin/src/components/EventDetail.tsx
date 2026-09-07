import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import ErrorState from '@ui/components/shared/ErrorState';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import LiveRegion from '@ui/components/shared/LiveRegion';
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

  if (error) {
    return (
      <div className="event-detail">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/events">Events</Link>
        </nav>
        <ErrorState
          title="Error loading this event"
          description={error}
          action={<Link to="/events">Back to all events</Link>}
        />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="skeleton-stack" aria-busy="true">
        <SkeletonCard height={40} />
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
        <LiveRegion role="none" message="Loading event…" />
      </div>
    );
  }

  return (
    <div className="event-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/events">Events</Link> / <span aria-current="page">{event.name}</span>
      </nav>

      <div className="detail-header chips">
        <h2>{event.name}</h2>
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
      </div>

      {event.description && <p className="description">{event.description}</p>}

      {event.deprecation && (
        <div className="deprecation-notice">
          <strong>Deprecated</strong>
          <span className="deprecation-meta">
            on {new Date(event.deprecation.deprecatedAt).toLocaleString()}
            {event.deprecation.by ? ` by ${event.deprecation.by}` : ''}
          </span>
          {event.deprecation.reason && (
            <div className="deprecation-reason">{event.deprecation.reason}</div>
          )}
        </div>
      )}

      <div className="detail-grid">
        <section className="detail-section">
          <h3>Live Metrics</h3>
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
          <div className="metrics-grid">
            <div className="metric">
              <div className="metric-value">{stats ? `${stats.publishRate.toFixed(2)}/s` : '—'}</div>
              <div className="metric-label">Publish Rate</div>
            </div>
            <div className="metric">
              <div className="metric-value">{stats ? stats.publishCount.toLocaleString() : '—'}</div>
              <div className="metric-label">Total Published</div>
            </div>
            <div className="metric">
              <div className="metric-value">{stats ? stats.subscriberCount : '—'}</div>
              <div className="metric-label">Subscribers</div>
            </div>
            <div className="metric">
              <div className={`metric-value${(stats?.errorCount ?? 0) > 0 ? ' text-error' : ''}`}>
                {stats ? stats.errorCount : '—'}
              </div>
              <div className="metric-label">Errors</div>
            </div>
            {stats?.queueDepth !== undefined && (
              <div className="metric">
                <div className="metric-value">{stats.queueDepth}</div>
                <div className="metric-label">Queue Depth</div>
              </div>
            )}
          </div>
        </section>

        <section className="detail-section">
          <h3>Schema</h3>
          <pre className="schema-viewer">
            {JSON.stringify(event.schema, null, 2)}
          </pre>
        </section>

        {event.schemaHistory && event.schemaHistory.length > 0 ? (
          <section className="detail-section">
            <h3>Schema History ({event.schemaHistory.length})</h3>
            <ul className="schema-history">
              {event.schemaHistory.map((h) => (
                <li key={h.version}>
                  <div className="schema-history-row">
                    <Chip tone="neutral">v{h.version}</Chip>
                    <FingerprintChip fingerprint={h.fingerprint} label="" />
                    <span className="schema-history-time">
                      {new Date(h.updatedAt).toLocaleString()}
                    </span>
                    <SchemaDiffToggle before={h.schema} after={event.schema} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="detail-section">
          <h3>Registration</h3>
          <dl className="info-list">
            <dt>Declared Producer</dt>
            <dd>{Array.isArray(event.producer) ? event.producer.join(', ') : event.producer}</dd>
            {observedProducers && observedProducers.observed.length > 0 ? (
              <>
                <dt>Observed Producers</dt>
                <dd className="chip-row">
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
                </dd>
              </>
            ) : null}
            {observedProducers && observedProducers.deadDeclaredProducers.length > 0 ? (
              <>
                <dt>Dead Declared</dt>
                <dd className="chip-row">
                  {observedProducers.deadDeclaredProducers.map(p => (
                    <Chip key={p} tone="neutral" size="xs" title="Declared but never published">
                      {p}
                    </Chip>
                  ))}
                </dd>
              </>
            ) : null}
            <dt>Transport</dt>
            <dd>{event.transport === 'signal' ? 'Signal (Redis Pub/Sub — Ephemeral)' : 'Durable (Message Queue — At-Least-Once)'}</dd>
            <dt>Registered</dt>
            <dd>{new Date(event.metadata.createdAt).toLocaleString()}</dd>
            <dt>Subscribers</dt>
            <dd>{event.subscribers.length > 0 ? event.subscribers.join(', ') : 'None'}</dd>
            {event.tags && event.tags.length > 0 ? (
              <>
                <dt>Tags</dt>
                <dd>
                  {event.tags.map(t => (
                    <Chip key={t} tone="purple" size="xs" className="tag-chip">{t}</Chip>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="detail-section full-width">
          <h3>Recent Messages ({history.length})</h3>
          {historyError ? (
            <ErrorState
              title="Couldn't load recent messages"
              description={historyError}
            />
          ) : history.length === 0 ? (
            <div className="empty-state">No recent messages captured.</div>
          ) : (
            <div className="message-list">
              {history.map((msg, i) => (
                <details key={i} className="message-item">
                  <summary>
                    Message #{history.length - i}
                    {(msg as Record<string, unknown>).metadata
                      ? ` — ${new Date(((msg as Record<string, unknown>).metadata as Record<string, unknown>).timestamp as number).toLocaleTimeString()}`
                      : null
                    }
                  </summary>
                  <pre>{JSON.stringify(msg, null, 2)}</pre>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
