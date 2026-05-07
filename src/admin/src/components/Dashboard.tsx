import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EventEntry, type HealthStatus } from '../api';

export function Dashboard() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getEvents(),
      api.getHealth(),
    ]).then(([eventsRes, healthRes]) => {
      setEvents(eventsRes.events);
      setHealth(healthRes);
    }).catch(err => setError(err.message));
  }, []);

  if (error) return <div className="error">Failed to load: {error}</div>;

  const signalEvents = events.filter(e => e.transport === 'signal');
  const durableEvents = events.filter(e => e.transport === 'durable');
  const totalPublishes = events.reduce((sum, e) => sum + (e.stats?.publishCount ?? 0), 0);
  const totalErrors = events.reduce((sum, e) => sum + (e.stats?.errorCount ?? 0), 0);
  const producers = [...new Set(events.map(e => e.producer))];

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{events.length}</div>
          <div className="stat-label">Registered Events</div>
        </div>
        <div className="stat-card signal">
          <div className="stat-value">{signalEvents.length}</div>
          <div className="stat-label">Signal (Ephemeral)</div>
        </div>
        <div className="stat-card durable">
          <div className="stat-value">{durableEvents.length}</div>
          <div className="stat-label">Durable (At-Least-Once)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{producers.length}</div>
          <div className="stat-label">Services</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalPublishes.toLocaleString()}</div>
          <div className="stat-label">Total Publishes</div>
        </div>
        <div className="stat-card error">
          <div className="stat-value">{totalErrors}</div>
          <div className="stat-label">Errors</div>
        </div>
      </div>

      {health && (
        <div className="transport-status">
          <h3>Transport Status</h3>
          <div className="status-row">
            <span className={`status-dot ${health.redis === 'connected' ? 'green' : 'red'}`} />
            <span>Redis (Signal): {health.redis}</span>
          </div>
          <div className="status-row">
            <span className={`status-dot ${health.messageQueue === 'connected' ? 'green' : 'red'}`} />
            <span>Message Queue (Durable): {health.messageQueue}</span>
          </div>
          <div className="status-row">
            <span>Uptime: {formatUptime(health.uptime)}</span>
          </div>
        </div>
      )}

      <div className="recent-events">
        <h3>Recently Active Events</h3>
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Transport</th>
              <th>Producer</th>
              <th>Rate</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {events
              .filter(e => e.stats?.lastPublishedAt)
              .sort((a, b) => (b.stats?.lastPublishedAt ?? '').localeCompare(a.stats?.lastPublishedAt ?? ''))
              .slice(0, 10)
              .map(e => (
                <tr key={e.name}>
                  <td><Link to={`/events/${encodeURIComponent(e.name)}`}>{e.name}</Link></td>
                  <td><span className={`badge ${e.transport}`}>{e.transport}</span></td>
                  <td>{e.producer}</td>
                  <td>{e.stats?.publishRate.toFixed(1)}/s</td>
                  <td>{e.stats?.lastPublishedAt ? timeAgo(e.stats.lastPublishedAt) : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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
