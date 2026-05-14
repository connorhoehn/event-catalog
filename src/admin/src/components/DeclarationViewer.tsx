import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
import { api, type EventEntry } from '../api';

/**
 * Read-only event declaration viewer. Shows the full registry list,
 * an inline payload-schema view, and per-event version history. No
 * editing affordances by design — declarations are owned by producer
 * services, not the admin UI.
 */
export function DeclarationViewer() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getEvents()
      .then(res => { setEvents(res.events); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const current = selected ? events.find(e => e.name === selected) ?? null : null;

  return (
    <div className="declaration-viewer">
      <div className="page-header">
        <h2>Event Declarations</h2>
        <Chip tone="neutral">{events.length} declared</Chip>
      </div>

      {error && <Banner variant="error">{error}</Banner>}

      {!loading && events.length === 0 && (
        <EmptyState
          icon="DECL"
          title="No event declarations"
          body="Services declare events at startup. None have been registered yet."
        />
      )}

      {events.length > 0 && (
        <div className="declaration-grid">
          <ul className="declaration-list">
            {events.map(event => (
              <li
                key={event.name}
                className={selected === event.name ? 'selected' : ''}
                onClick={() => setSelected(event.name)}
              >
                <div className="decl-name">{event.name}</div>
                <div className="decl-meta">
                  <Chip tone={event.transport === 'signal' ? 'info' : 'warning'} size="xs">
                    {event.transport}
                  </Chip>
                  {typeof event.version === 'number' && (
                    <Chip tone="purple" size="xs">v{event.version}</Chip>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {current && (
            <div className="declaration-detail">
              <div className="declaration-detail-header">
                <h3>{current.name}</h3>
                <Link to={`/events/${encodeURIComponent(current.name)}`}>full details &rarr;</Link>
              </div>

              {current.description && <p className="description">{current.description}</p>}

              <dl className="info-list">
                <dt>Producer</dt>
                <dd>{Array.isArray(current.producer) ? current.producer.join(', ') : current.producer}</dd>
                <dt>Transport</dt>
                <dd>{current.transport}</dd>
                <dt>Current Version</dt>
                <dd>v{current.version ?? 1}</dd>
                <dt>Subscribers</dt>
                <dd>{current.subscribers.length > 0 ? current.subscribers.join(', ') : '(none)'}</dd>
              </dl>

              <section className="detail-section">
                <h4>Payload Schema (current)</h4>
                <pre className="schema-viewer">{JSON.stringify(current.schema, null, 2)}</pre>
              </section>

              <section className="detail-section">
                <h4>Version History</h4>
                {!current.schemaHistory || current.schemaHistory.length === 0 ? (
                  <div className="empty-state">First version — no prior schemas recorded.</div>
                ) : (
                  <ol className="schema-history">
                    {current.schemaHistory.slice().reverse().map(h => (
                      <li key={h.version}>
                        <div className="history-header">
                          <Chip tone="neutral" size="xs">v{h.version}</Chip>
                          <span className="history-date">{h.updatedAt}</span>
                        </div>
                        <details>
                          <summary>schema snapshot</summary>
                          <pre className="schema-viewer">{JSON.stringify(h.schema, null, 2)}</pre>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
