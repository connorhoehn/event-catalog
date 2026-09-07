// wave24-d — Subscribers panel.
//
// Surfaces the wave24-b /api/subscribers + /api/heartbeat plumbing
// in the admin UI. Operators can spot stale consumers (services that
// missed their heartbeat window) and see which events they were
// subscribed to.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import ErrorState from '@ui/components/shared/ErrorState';
import LoadingState from '@ui/components/shared/LoadingState';
import { Button } from '@ui/components/ui/Button';
import { api } from '../api';

type Filter = 'all' | 'fresh' | 'stale';

const FRESH_THRESHOLD_S = 5 * 60;     // 5 min
const STALE_THRESHOLD_S = 30 * 60;    // 30 min

interface Row {
  eventName: string;
  serviceName: string;
  lastSeenAt: string;
  ageSeconds: number;
}

function ageOf(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Heartbeat freshness. The word is the cue — the tone only reinforces it,
 *  so the column still reads correctly in greyscale or with a colour-vision
 *  deficiency. */
function statusChip(ageSeconds: number) {
  if (ageSeconds <= FRESH_THRESHOLD_S) return <Chip tone="success">fresh</Chip>;
  if (ageSeconds <= STALE_THRESHOLD_S) return <Chip tone="warning">aging</Chip>;
  return <Chip tone="danger">stale</Chip>;
}

export function SubscribersView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(Date.now());
  // Without this the first paint is "No subscribers in this view" — an empty
  // catalog and an in-flight request looked identical, and the first is a
  // conclusion an operator acts on.
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getSubscribers()
      .then((res) => {
        const t = Date.now();
        setRows(res.subscribers.map((s) => ({ ...s, ageSeconds: ageOf(s.lastSeenAt, t) })));
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const liveRows = useMemo(() => {
    return rows.map((r) => ({ ...r, ageSeconds: ageOf(r.lastSeenAt, now) }));
  }, [rows, now]);

  const filtered = useMemo(() => {
    if (filter === 'all') return liveRows;
    if (filter === 'fresh') return liveRows.filter((r) => r.ageSeconds <= FRESH_THRESHOLD_S);
    // Must match what `statusChip` calls stale, and therefore the "N stale"
    // count in the toolbar. This was `> FRESH_THRESHOLD_S`, i.e. "not fresh",
    // so the stale filter also listed every aging row: the chip said 2 stale
    // and the table under it showed 9 — an operator chasing dead consumers
    // was handed seven live ones.
    return liveRows.filter((r) => r.ageSeconds > STALE_THRESHOLD_S);
  }, [liveRows, filter]);

  const counts = useMemo(() => {
    let fresh = 0, aging = 0, stale = 0;
    for (const r of liveRows) {
      if (r.ageSeconds <= FRESH_THRESHOLD_S) fresh += 1;
      else if (r.ageSeconds <= STALE_THRESHOLD_S) aging += 1;
      else stale += 1;
    }
    return { fresh, aging, stale };
  }, [liveRows]);

  return (
    <div className="subscribers-view view-column">
      <div className="view-toolbar">
        <h2>Subscribers</h2>
        <Chip tone="success">{counts.fresh} fresh</Chip>
        <Chip tone="warning">{counts.aging} aging</Chip>
        <Chip tone="danger">{counts.stale} stale</Chip>

        {/* A toggle group: `aria-pressed` is what tells a screen reader which
            filter is currently on. Before, the only signal was the button's
            fill colour. */}
        <div className="view-toolbar-right" role="group" aria-label="Freshness filter">
          <Button aria-pressed={filter === 'all'} variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>all</Button>
          <Button aria-pressed={filter === 'fresh'} variant={filter === 'fresh' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('fresh')}>fresh</Button>
          <Button aria-pressed={filter === 'stale'} variant={filter === 'stale' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('stale')}>stale</Button>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>
      </div>

      {error ? (
        <ErrorState
          title="Error loading subscribers"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      ) : loading && rows.length === 0 ? (
        <LoadingState label="Loading subscribers…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No subscribers in this view"
          body={
            filter === 'all'
              ? 'No consumers have registered yet. Subscribers appear here when a service calls catalog.subscribe(...).'
              : `No ${filter} subscribers — try a different filter.`
          }
        />
      ) : (
        <div className="view-scroll tight">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Event</th>
                <th scope="col">Service</th>
                <th scope="col">Last seen</th>
                <th scope="col">Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.eventName}-${r.serviceName}-${i}`}>
                  <td>{statusChip(r.ageSeconds)}</td>
                  <td>
                    <Link to={`/events/${encodeURIComponent(r.eventName)}`} className="link-plain medium">
                      {r.eventName}
                    </Link>
                  </td>
                  <td className="cell-mono">{r.serviceName}</td>
                  <td className="cell-timestamp">{new Date(r.lastSeenAt).toLocaleString()}</td>
                  <td className="cell-mono">{formatAge(r.ageSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
