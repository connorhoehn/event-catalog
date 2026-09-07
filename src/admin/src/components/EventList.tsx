import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import Banner from '@ui/components/shared/Banner';
import Sparkline from '@ui/components/shared/Sparkline';
import { api, type EventEntry } from '../api';

/** 60s publish-rate trend. Delegates the SVG to the shared Sparkline; the
 *  only local concern is the "not enough samples yet" dash. */
function RateSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="sparkline-empty">—</span>;
  return <Sparkline data={data} width={52} height={16} color="var(--blue-500)" />;
}

export function EventList() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [rateHistory, setRateHistory] = useState<Record<string, number[]>>({});
  const [filter, setFilter] = useState<{ transport?: string; producer?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // wave26-f — bulk selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getEvents(filter),
      api.getMetricsHistory().catch(() => ({} as Record<string, number[]>)),
    ])
      .then(([eventsRes, history]) => {
        setEvents(eventsRes.events);
        setRateHistory(history);
        setError(null);
        setSelected(new Set());
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  const producers = [...new Set(events.flatMap(e => Array.isArray(e.producer) ? e.producer : [e.producer]))];

  const allSelected = events.length > 0 && selected.size === events.length;
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(events.map(e => e.name)));
    }
  };
  const toggleOne = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectedNames = [...selected];

  const handleBulkDeprecate = async () => {
    if (!bulkReason.trim()) { setBulkResult('Please enter a deprecation reason.'); return; }
    setBulkPending(true);
    setBulkResult(null);
    try {
      const res = await api.bulkDeprecate(selectedNames, { reason: bulkReason });
      setBulkResult(`Deprecated ${res.total} event(s).${res.notFound.length > 0 ? ` Not found: ${res.notFound.join(', ')}.` : ''}`);
      setSelected(new Set());
      // Refresh list
      const eventsRes = await api.getEvents(filter);
      setEvents(eventsRes.events);
    } catch (err) {
      setBulkResult(`Error: ${(err as Error).message}`);
    } finally {
      setBulkPending(false);
    }
  };

  const handleBulkExport = () => {
    const url = api.bulkExportUrl(selectedNames);
    window.open(url, '_blank');
  };

  return (
    <div className="event-list">
      <div className="page-header">
        <h2>Registered Events</h2>
        <Chip tone="neutral">{events.length} events</Chip>
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

      {/* wave26-f — bulk actions toolbar (only visible when events are selected) */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <Chip tone="info" size="xs">{selected.size} selected</Chip>
          <input
            type="text"
            placeholder="Deprecation reason (required for deprecate)"
            value={bulkReason}
            onChange={e => setBulkReason(e.target.value)}
            className="bulk-bar-input"
          />
          <button
            onClick={handleBulkDeprecate}
            disabled={bulkPending}
            className="btn-solid danger"
          >
            Deprecate
          </button>
          <button
            onClick={handleBulkExport}
            className="btn-solid info"
          >
            Export JSON
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="btn-outline-muted"
          >
            Clear
          </button>
          {bulkResult && (
            <span className={`bulk-result${bulkResult.startsWith('Error') ? ' error' : ''}`}>
              {bulkResult}
            </span>
          )}
        </div>
      )}

      {error && <Banner variant="error">{error}</Banner>}
      {loading && (
        <div className="skeleton-stack tight">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} height={48} />
          ))}
        </div>
      )}

      {!loading && (
        <table className="events-table">
          <thead>
            <tr>
              <th className="col-select">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
              </th>
              <th>Name</th>
              <th>Transport</th>
              <th>Producer</th>
              <th>Subscribers</th>
              <th>Sparkline (60s)</th>
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
                  <input
                    type="checkbox"
                    checked={selected.has(event.name)}
                    onChange={() => toggleOne(event.name)}
                  />
                </td>
                <td>
                  <Link to={`/events/${encodeURIComponent(event.name)}`} className="event-name">
                    {event.name}
                  </Link>
                  {event.description && <div className="event-desc">{event.description}</div>}
                </td>
                <td>
                  <Chip tone={event.transport === 'signal' ? 'info' : 'warning'} size="xs">
                    {event.transport}
                  </Chip>
                </td>
                <td>{Array.isArray(event.producer) ? event.producer.join(', ') : event.producer}</td>
                <td>{event.subscribers.length}</td>
                <td><RateSparkline data={rateHistory[event.name] ?? []} /></td>
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
      )}

      {events.length === 0 && !loading && (
        <EmptyState
          icon="📡"
          title="No events registered"
          body="Services declare events at startup via the SDK. Once a service connects, its events will appear here."
        />
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
