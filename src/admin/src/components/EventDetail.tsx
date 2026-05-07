import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type EventEntry, type EventStats } from '../api';

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

  // Poll stats every 2s for live updates
  useEffect(() => {
    if (!name) return;
    const decoded = decodeURIComponent(name);
    const interval = setInterval(() => {
      api.getEventStats(decoded).then(setStats).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [name]);

  if (error) return <div className="error">Error: {error}</div>;
  if (!event) return <div className="loading">Loading...</div>;

  return (
    <div className="event-detail">
      <div className="breadcrumb">
        <Link to="/events">Events</Link> / {event.name}
      </div>

      <div className="detail-header">
        <h2>{event.name}</h2>
        <span className={`badge ${event.transport}`}>{event.transport}</span>
      </div>

      {event.description && <p className="description">{event.description}</p>}

      <div className="detail-grid">
        {/* Live Stats */}
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
              <div className={`metric-value ${(stats?.errorCount ?? 0) > 0 ? 'text-error' : ''}`}>
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

        {/* Schema */}
        <section className="detail-section">
          <h3>Schema</h3>
          <pre className="schema-viewer">
            {JSON.stringify(event.schema, null, 2)}
          </pre>
        </section>

        {/* Registration Info */}
        <section className="detail-section">
          <h3>Registration</h3>
          <dl className="info-list">
            <dt>Producer</dt>
            <dd>{event.producer}</dd>
            <dt>Transport</dt>
            <dd>{event.transport === 'signal' ? 'Signal (Redis Pub/Sub — Ephemeral)' : 'Durable (Message Queue — At-Least-Once)'}</dd>
            <dt>Registered</dt>
            <dd>{new Date(event.metadata.createdAt).toLocaleString()}</dd>
            <dt>Subscribers</dt>
            <dd>{event.subscribers.length > 0 ? event.subscribers.join(', ') : 'None'}</dd>
            {event.tags && event.tags.length > 0 && (
              <>
                <dt>Tags</dt>
                <dd>{event.tags.map(t => <span key={t} className="tag">{t}</span>)}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Recent Messages */}
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
                    {(msg as Record<string, unknown>).metadata &&
                      ` — ${new Date(((msg as Record<string, unknown>).metadata as Record<string, unknown>).timestamp as number).toLocaleTimeString()}`
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
