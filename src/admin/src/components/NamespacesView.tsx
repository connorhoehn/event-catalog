// wave25-b — Namespaces browser.
//
// One-glance grid of every namespace in the catalog with rollup
// counts. Click a namespace card to drill into the events it owns,
// each with a deprecation chip + a deep-link to /events/:name.
//
// Data is one round-trip: GET /api/namespaces/summary?detail=full.
// We keep the full payload client-side and just toggle which
// namespace is "expanded" — namespace counts rarely top a few dozen
// so re-fetching on each click would be wasteful.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
import { Button } from '@ui/components/ui/Button';
import { api } from '../api';

interface NamespaceRow {
  namespace: string;
  eventCount: number;
  deprecatedCount: number;
  producerCount: number;
  subscriberCount: number;
  signalCount: number;
  durableCount: number;
  events?: Array<{ name: string; transport: string; version: number; deprecated: boolean }>;
}

export function NamespacesView() {
  const [rows, setRows] = useState<NamespaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    api.getNamespacesSummary('full')
      .then(res => {
        setRows(res.items);
        setError(null);
      })
      .catch(err => setError((err as Error).message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.namespace.toLowerCase().includes(q));
  }, [rows, search]);

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;

  return (
    <div className="namespaces-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
        <h2 style={{ margin: 0 }}>Namespaces</h2>
        <Chip tone="info">{rows.length} total</Chip>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by namespace…"
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            border: '1px solid #cbd5e1',
            borderRadius: 4,
            fontSize: 13,
            width: 220,
          }}
        />
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="📂"
          title="No namespaces"
          body={search ? `No namespace matches "${search}".` : 'Declare an event to populate the catalog.'}
        />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(row => {
              const isExpanded = expanded === row.namespace;
              return (
                <div
                  key={row.namespace}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    background: 'white',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : row.namespace)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{row.namespace}</strong>
                      <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <Chip tone="neutral">{row.eventCount} events</Chip>
                      {row.signalCount > 0 ? <Chip tone="info">{row.signalCount} signal</Chip> : null}
                      {row.durableCount > 0 ? <Chip tone="warning">{row.durableCount} durable</Chip> : null}
                      {row.deprecatedCount > 0 ? <Chip tone="danger">{row.deprecatedCount} deprecated</Chip> : null}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {row.producerCount} producer{row.producerCount === 1 ? '' : 's'} · {row.subscriberCount} subscriber{row.subscriberCount === 1 ? '' : 's'}
                    </div>
                  </button>

                  {isExpanded && row.events && (
                    <div style={{ padding: '0 14px 12px', borderTop: '1px solid #f1f5f9' }}>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {row.events.map(ev => (
                          <li
                            key={ev.name}
                            style={{
                              padding: '6px 0',
                              borderBottom: '1px solid #f8fafc',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: 13,
                            }}
                          >
                            <Link to={`/events/${encodeURIComponent(ev.name)}`} style={{ color: '#0f172a' }}>
                              {ev.name}
                            </Link>
                            <Chip tone={ev.transport === 'signal' ? 'info' : 'warning'} size="xs">
                              {ev.transport}
                            </Chip>
                            <Chip tone="neutral" size="xs">v{ev.version}</Chip>
                            {ev.deprecated ? <Chip tone="danger" size="xs">deprecated</Chip> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
