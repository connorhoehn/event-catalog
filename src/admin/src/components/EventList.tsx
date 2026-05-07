import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EventEntry } from '../api';

export function EventList() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [filter, setFilter] = useState<{ transport?: string; producer?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getEvents(filter)
      .then(res => { setEvents(res.events); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  const producers = [...new Set(events.map(e => e.producer))];

  return (
    <div className="event-list">
      <div className="page-header">
        <h2>Registered Events</h2>
        <span className="count">{events.length} events</span>
      </div>

      <div className="filters">
        <select
          value={filter.transport ?? ''}
          onChange={e => setFilter(f => ({ ...f, transport: e.target.value || undefined }))}
        >
          <option value="">All Transports</option>
          <option value="signal">Signal (Ephemeral)</option>
          <option value="durable">Durable (At-Least-Once)</option>
        </select>

        <select
          value={filter.producer ?? ''}
          onChange={e => setFilter(f => ({ ...f, producer: e.target.value || undefined }))}
        >
          <option value="">All Producers</option>
          {producers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading...</div>}

      <table className="events-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Transport</th>
            <th>Producer</th>
            <th>Subscribers</th>
            <th>Publish Rate</th>
            <th>Total</th>
            <th>Errors</th>
            <th>Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {events.map(event => (
            <tr key={event.name} className={event.stats?.errorCount ? 'has-errors' : ''}>
              <td>
                <Link to={`/events/${encodeURIComponent(event.name)}`} className="event-name">
                  {event.name}
                </Link>
                {event.description && <div className="event-desc">{event.description}</div>}
              </td>
              <td><span className={`badge ${event.transport}`}>{event.transport}</span></td>
              <td>{event.producer}</td>
              <td>{event.subscribers.length}</td>
              <td className="mono">{event.stats?.publishRate.toFixed(2)}/s</td>
              <td className="mono">{event.stats?.publishCount.toLocaleString() ?? '0'}</td>
              <td className={`mono ${(event.stats?.errorCount ?? 0) > 0 ? 'text-error' : ''}`}>
                {event.stats?.errorCount ?? 0}
              </td>
              <td>{event.stats?.lastPublishedAt ? timeAgo(event.stats.lastPublishedAt) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {events.length === 0 && !loading && (
        <div className="empty-state">
          No events registered. Services declare events at startup via the SDK.
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
