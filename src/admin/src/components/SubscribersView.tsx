// wave24-d — Subscribers panel.
//
// Surfaces the wave24-b /api/subscribers + /api/heartbeat plumbing
// in the admin UI. Operators can spot stale consumers (services that
// missed their heartbeat window) and see which events they were
// subscribed to.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
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

  const load = useCallback(() => {
    api.getSubscribers()
      .then((res) => {
        const t = Date.now();
        setRows(res.subscribers.map((s) => ({ ...s, ageSeconds: ageOf(s.lastSeenAt, t) })));
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
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
    return liveRows.filter((r) => r.ageSeconds > FRESH_THRESHOLD_S);
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

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;

  return (
    <div className="subscribers-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
        <h2 style={{ margin: 0 }}>Subscribers</h2>
        <Chip tone="success">{counts.fresh} fresh</Chip>
        <Chip tone="warning">{counts.aging} aging</Chip>
        <Chip tone="danger">{counts.stale} stale</Chip>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>all</Button>
          <Button variant={filter === 'fresh' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('fresh')}>fresh</Button>
          <Button variant={filter === 'stale' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('stale')}>stale</Button>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Event</th>
                <th style={{ padding: '6px 8px' }}>Service</th>
                <th style={{ padding: '6px 8px' }}>Last seen</th>
                <th style={{ padding: '6px 8px' }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.eventName}-${r.serviceName}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{statusChip(r.ageSeconds)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Link to={`/events/${encodeURIComponent(r.eventName)}`} style={{ color: '#0f172a', fontWeight: 500 }}>
                      {r.eventName}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.serviceName}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11, color: '#64748b' }}>{new Date(r.lastSeenAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{formatAge(r.ageSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
