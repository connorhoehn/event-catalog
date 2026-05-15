import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import { api, type EventEntry, type EventStats } from '../api';
import { FingerprintChip } from './FingerprintChip';
import { SchemaDiffToggle } from './SchemaDiff';

export function EventDetail() {
  const { name } = useParams<{ name: string }>();
  const [event, setEvent] = useState<EventEntry | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    const decoded = decodeURIComponent(name);

    Promise.all([
      api.getEvent(decoded),
      api.getEventHistory(decoded, 20),
    ]).then(([eventRes, historyRes]) => {
      setEvent(eventRes);
      setStats(eventRes.stats);
      setHistory(historyRes.messages);
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

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;
  if (!event) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard height={40} />
        <SkeletonCard height={200} />
        <SkeletonCard height={200} />
      </div>
    );
  }

  return (
    <div className="event-detail">
      <div className="breadcrumb">
        <Link to="/events">Events</Link> / {event.name}
      </div>

      <div className="detail-header" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{event.name}</h2>
        <Chip tone={event.transport === 'signal' ? 'info' : 'warning'}>
          {event.transport}
        </Chip>
        {event.namespace ? <Chip tone="purple">{event.namespace}</Chip> : null}
        {event.version ? <Chip tone="neutral">v{event.version}</Chip> : null}
        <FingerprintChip fingerprint={event.schemaFingerprint} />
      </div>

      {event.description && <p className="description">{event.description}</p>}

      <div className="detail-grid">
        <section className="detail-section">
          <h3>Live Metrics</h3>
          <div className="metrics-grid">
            <div className="metric">
              <div className="metric-value">{stats?.publishRate.toFixed(2)}/s</div>
              <div className="metric-label">Publish Rate</div>
            </div>
            <div className="metric">
              <div className="metric-value">{stats?.publishCount.toLocaleString()}</div>
              <div className="metric-label">Total Published</div>
            </div>
            <div className="metric">
              <div className="metric-value">{stats?.subscriberCount}</div>
              <div className="metric-label">Subscribers</div>
            </div>
            <div className="metric">
              <div className="metric-value" style={(stats?.errorCount ?? 0) > 0 ? { color: 'var(--error)' } : undefined}>
                {stats?.errorCount}
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
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {event.schemaHistory.map((h) => (
                <li key={h.version} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Chip tone="neutral">v{h.version}</Chip>
                    <FingerprintChip fingerprint={h.fingerprint} label="" />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
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
            <dt>Producer</dt>
            <dd>{Array.isArray(event.producer) ? event.producer.join(', ') : event.producer}</dd>
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
                    <Chip key={t} tone="purple" size="xs" style={{ marginRight: 4 }}>{t}</Chip>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="detail-section full-width">
          <h3>Recent Messages ({history.length})</h3>
          {history.length === 0 ? (
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
