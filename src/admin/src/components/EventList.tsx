import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import ErrorState from '@ui/components/shared/ErrorState';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import LiveRegion from '@ui/components/shared/LiveRegion';
import Sparkline from '@ui/components/shared/Sparkline';
import { Button } from '@ui/components/ui/Button';
import { api, type EventEntry } from '../api';

/** 60s publish-rate trend. Delegates the SVG to the shared Sparkline; the
 *  only local concern is the "not enough samples yet" dash.
 *
 *  `baseline="zero"` matters here: rates are magnitudes, so a steady 100/s that
 *  ticks to 102/s must look steady. Min-based scaling would draw that as a
 *  full-height climb, identical to a rate that actually tripled. */
function RateSparkline({ data, label }: { data: number[]; label: string }) {
  if (data.length < 2) {
    return <span className="sparkline-empty">no samples yet</span>;
  }
  // The drawing itself carries no text, so it needs a role and a name or a
  // screen-reader user hears an empty cell. The exact numbers live in the
  // "Publish Rate" column next door; the trend is what this summarises.
  return (
    <span role="img" aria-label={`60 second publish-rate trend for ${label}`}>
      <Sparkline data={data} width={52} height={16} color="var(--blue-500)" baseline="zero" />
    </span>
  );
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
  const transportFilterId = useId();
  const producerFilterId = useId();
  const bulkReasonId = useId();

  const load = useCallback(() => {
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

  useEffect(() => { load(); }, [load]);

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

      {/* Both selects were unlabelled: the only clue to what they filtered was
          the currently-selected option, which a screen reader reads as a bare
          value with no question attached to it. */}
      <div className="filters">
        <label className="field-label" htmlFor={transportFilterId}>Transport</label>
        <select
          id={transportFilterId}
          value={filter.transport ?? ''}
          onChange={e => setFilter(f => ({ ...f, transport: e.target.value || undefined }))}
        >
          <option value="">All Transports</option>
          <option value="signal">Signal (Ephemeral)</option>
          <option value="durable">Durable (At-Least-Once)</option>
        </select>

        <label className="field-label" htmlFor={producerFilterId}>Producer</label>
        <select
          id={producerFilterId}
          value={filter.producer ?? ''}
          onChange={e => setFilter(f => ({ ...f, producer: e.target.value || undefined }))}
        >
          <option value="">All Producers</option>
          {producers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* wave26-f — bulk actions toolbar (only visible when events are selected) */}
      {selected.size > 0 && (
        <div className="bulk-bar" role="group" aria-label={`Bulk actions for ${selected.size} selected events`}>
          <Chip tone="info" size="xs">{selected.size} selected</Chip>
          <label className="sr-only" htmlFor={bulkReasonId}>Deprecation reason</label>
          <input
            id={bulkReasonId}
            type="text"
            placeholder="Deprecation reason (required for deprecate)"
            value={bulkReason}
            onChange={e => setBulkReason(e.target.value)}
            className="bulk-bar-input"
          />
          <Button variant="danger" size="sm" onClick={handleBulkDeprecate} disabled={bulkPending}>
            {bulkPending ? 'Deprecating…' : 'Deprecate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleBulkExport}>
            Export JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* The outcome of a bulk action is the one thing here the operator did
          ask for and must not miss, so it is announced.

          It lives OUTSIDE the toolbar because a successful deprecate clears
          the selection, and the toolbar only renders while something is
          selected — so the success message was mounted and unmounted in the
          same commit and no operator ever saw it. Deprecating forty events
          gave exactly as much feedback as deprecating none; only the two
          failure paths, which leave the selection intact, showed anything. */}
      {bulkResult && (
        <p
          role="status"
          className={`bulk-result${bulkResult.startsWith('Error') ? ' error' : ''}`}
        >
          {bulkResult}
        </p>
      )}

      {loading && (
        <div className="skeleton-stack tight" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} height={48} />
          ))}
          <LiveRegion role="none" message="Loading events…" />
        </div>
      )}

      {/* Failed is not the same as empty. Until now a 500 rendered the error
          banner and then "No events registered" below it, which reads as
          "the registry is fine, it is just empty". */}
      {!loading && error && (
        <ErrorState
          title="Error loading events"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      )}

      {!loading && !error && (
        <table className="events-table">
          <thead>
            <tr>
              <th scope="col" className="col-select">
                <input
                  type="checkbox"
                  aria-label="Select all events"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
              <th scope="col">Name</th>
              <th scope="col">Transport</th>
              <th scope="col">Producer</th>
              <th scope="col">Subscribers</th>
              <th scope="col">Sparkline (60s)</th>
              <th scope="col">Publish Rate</th>
              <th scope="col">Total</th>
              <th scope="col">Errors</th>
              <th scope="col">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {events.map(event => (
              <tr key={event.name} className={event.stats?.errorCount ? 'has-errors' : ''}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${event.name}`}
                    checked={selected.has(event.name)}
                    onChange={() => toggleOne(event.name)}
                  />
                </td>
                <th scope="row">
                  <Link to={`/events/${encodeURIComponent(event.name)}`} className="event-name">
                    {event.name}
                  </Link>
                  {event.description && <div className="event-desc">{event.description}</div>}
                </th>
                <td>
                  <Chip tone={event.transport === 'signal' ? 'info' : 'warning'} size="xs">
                    {event.transport}
                  </Chip>
                </td>
                <td>{Array.isArray(event.producer) ? event.producer.join(', ') : event.producer}</td>
                <td>{event.subscribers.length}</td>
                <td><RateSparkline data={rateHistory[event.name] ?? []} label={event.name} /></td>
                {/* An event with no stats yet rendered a bare "/s". */}
                <td className="mono">
                  {event.stats ? `${event.stats.publishRate.toFixed(2)}/s` : '—'}
                </td>
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

      {events.length === 0 && !loading && !error && (
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
