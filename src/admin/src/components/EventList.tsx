import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  Checkbox,
  Chip,
  CollectionPage,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LiveRegion,
  SkeletonCard,
  Sparkline,
  Stack,
  type DataTableColumn,
} from '@connorhoehn/ui-components/shared';
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
      <Sparkline data={data} width={52} height={16} color="var(--color-info)" baseline="zero" />
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
  const bulkReasonId = useId();
  const navigate = useNavigate();

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

  const columns: DataTableColumn<EventEntry>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label="Select all events"
          checked={allSelected}
          onChange={toggleAll}
        />
      ),
      width: '2.5rem',
      render: event => (
        <Checkbox
          aria-label={`Select ${event.name}`}
          checked={selected.has(event.name)}
          onChange={() => toggleOne(event.name)}
        />
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: event => (
        <>
          <Link to={`/events/${encodeURIComponent(event.name)}`} className="event-name">
            {event.name}
          </Link>
          {event.description && <div className="event-desc">{event.description}</div>}
        </>
      ),
    },
    {
      key: 'transport',
      header: 'Transport',
      render: event => (
        <Chip tone={event.transport === 'signal' ? 'info' : 'warning'} size="xs">
          {event.transport}
        </Chip>
      ),
    },
    {
      key: 'producer',
      header: 'Producer',
      render: event => (Array.isArray(event.producer) ? event.producer.join(', ') : event.producer),
    },
    { key: 'subscribers', header: 'Subscribers', numeric: true, render: event => event.subscribers.length },
    {
      key: 'sparkline',
      header: 'Sparkline (60s)',
      render: event => <RateSparkline data={rateHistory[event.name] ?? []} label={event.name} />,
    },
    // An event with no stats yet rendered a bare "/s".
    {
      key: 'rate',
      header: 'Publish Rate',
      numeric: true,
      render: event => (event.stats ? `${event.stats.publishRate.toFixed(2)}/s` : '—'),
    },
    {
      key: 'total',
      header: 'Total',
      numeric: true,
      render: event => event.stats?.publishCount.toLocaleString() ?? '0',
    },
    {
      key: 'errors',
      header: 'Errors',
      numeric: true,
      render: event => (
        <span className={(event.stats?.errorCount ?? 0) > 0 ? 'text-error' : undefined}>
          {event.stats?.errorCount ?? 0}
        </span>
      ),
    },
    {
      key: 'lastSeen',
      header: 'Last Seen',
      render: event => (event.stats?.lastPublishedAt ? timeAgo(event.stats.lastPublishedAt) : 'never'),
    },
  ];

  const producerOptions = [
    { value: '', label: 'All Producers' },
    ...producers.map(p => ({ value: p, label: p })),
  ];

  return (
    <CollectionPage
      title="Registered Events"
      gutter="page"
      badge={<Chip tone="neutral">{events.length} events</Chip>}
      toolbar={{
        label: 'Event controls',
        // Both filters carry their label (they were once unlabelled, and a
        // screen reader read the selected option as a bare value).
        filters: [
          {
            id: 'transport',
            label: 'Transport',
            value: filter.transport ?? '',
            onChange: v => setFilter(f => ({ ...f, transport: v || undefined })),
            options: [
              { value: '', label: 'All Transports' },
              { value: 'signal', label: 'Signal (Ephemeral)' },
              { value: 'durable', label: 'Durable (At-Least-Once)' },
            ],
          },
          {
            id: 'producer',
            label: 'Producer',
            value: filter.producer ?? '',
            onChange: v => setFilter(f => ({ ...f, producer: v || undefined })),
            options: producerOptions,
          },
        ],
        // wave26-f — bulk actions, drawn in place of the filters while
        // something is selected.
        selection: {
          count: selected.size,
          onClear: () => setSelected(new Set()),
          actions: (
            <>
              <label className="sr-only" htmlFor={bulkReasonId}>Deprecation reason</label>
              <Input
                id={bulkReasonId}
                type="text"
                size="sm"
                placeholder="Deprecation reason (required for deprecate)"
                value={bulkReason}
                onChange={e => setBulkReason(e.target.value)}
              />
              <Button variant="danger" size="sm" onClick={handleBulkDeprecate} disabled={bulkPending}>
                {bulkPending ? 'Deprecating…' : 'Deprecate'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleBulkExport}>
                Export JSON
              </Button>
            </>
          ),
        },
      }}
      error={
        // Failed is not the same as empty. A 500 once rendered the error
        // banner and then "No events registered" below it, which reads as
        // "the registry is fine, it is just empty".
        !loading && error ? (
          <ErrorState
            title="Error loading events"
            description={error}
            action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
          />
        ) : undefined
      }
      empty={
        <EmptyState
          icon="📡"
          title="No events registered"
          body="Services declare events at startup via the SDK. Once a service connects, its events will appear here."
        />
      }
      isEmpty={!loading && events.length === 0}
    >
      {/* The outcome of a bulk action is the one thing here the operator did
          ask for and must not miss, so it is announced.

          It lives OUTSIDE the selection toolbar because a successful
          deprecate clears the selection, and the toolbar only shows the bulk
          actions while something is selected — so a message inside it would
          be mounted and unmounted in the same commit. */}
      {bulkResult && (
        <p
          role="status"
          className={`bulk-result${bulkResult.startsWith('Error') ? ' error' : ''}`}
        >
          {bulkResult}
        </p>
      )}
      {loading && (
        <Stack gap="sm" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} height={48} />
          ))}
          <LiveRegion role="none" message="Loading events…" />
        </Stack>
      )}
      {!loading && !error && (
        <DataTable
          striped
          data={events}
          columns={columns}
          keyField={event => event.name}
          onRowClick={event => navigate(`/events/${encodeURIComponent(event.name)}`)}
        />
      )}
    </CollectionPage>
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
