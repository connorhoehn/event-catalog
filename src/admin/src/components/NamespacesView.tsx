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

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Chip, EmptyState, ErrorState, LoadingState, Button } from '@connorhoehnslalom/ui-components/shared';
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
  // Third state. `rows` starts empty, so the first paint used to be the
  // "No namespaces — declare an event to populate the catalog" card: a
  // request still in flight was reported to the operator as a finding.
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // wave26-f — per-namespace bulk action state
  const [bulkNs, setBulkNs] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const searchId = useId();
  const bulkReasonId = useId();

  const load = useCallback(() => {
    setLoading(true);
    api.getNamespacesSummary('full')
      .then(res => {
        setRows(res.items);
        setError(null);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.namespace.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="namespaces-view view-column">
      {/* The heading stays put in every state — bailing out to a bare banner
          used to leave the view with no <h2> at all. */}
      <div className="view-toolbar">
        <h2>Namespaces</h2>
        <Chip tone="info">{rows.length} total</Chip>
        <label className="sr-only" htmlFor={searchId}>Filter by namespace</label>
        <input
          id={searchId}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by namespace…"
          className="ns-filter-input"
        />
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>

      {error ? (
        <ErrorState
          title="Error loading namespaces"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      ) : loading && rows.length === 0 ? (
        <LoadingState label="Loading namespaces…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📂"
          title="No namespaces"
          body={search ? `No namespace matches "${search}".` : 'Declare an event to populate the catalog.'}
        />
      ) : (
        <div className="view-scroll">
          <div className="ns-grid">
            {filtered.map(row => {
              const isExpanded = expanded === row.namespace;
              return (
                <div key={row.namespace} className="ns-card">
                  <button
                    type="button"
                    className="ns-card-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={`ns-body-${row.namespace}`}
                    onClick={() => setExpanded(isExpanded ? null : row.namespace)}
                  >
                    <div className="ns-card-title">
                      <strong className="ns-card-name">{row.namespace}</strong>
                      <span className="ns-card-caret" aria-hidden="true">
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    </div>
                    <div className="ns-card-chips">
                      <Chip tone="neutral">{row.eventCount} events</Chip>
                      {row.signalCount > 0 ? <Chip tone="info">{row.signalCount} signal</Chip> : null}
                      {row.durableCount > 0 ? <Chip tone="warning">{row.durableCount} durable</Chip> : null}
                      {row.deprecatedCount > 0 ? <Chip tone="danger">{row.deprecatedCount} deprecated</Chip> : null}
                    </div>
                    <div className="ns-card-meta">
                      {row.producerCount} producer{row.producerCount === 1 ? '' : 's'} · {row.subscriberCount} subscriber{row.subscriberCount === 1 ? '' : 's'}
                    </div>
                  </button>

                  {isExpanded && row.events && (
                    <div className="ns-card-body" id={`ns-body-${row.namespace}`}>
                      {/* wave26-f — namespace-level bulk actions */}
                      <div className="ns-bulk-actions" role="group" aria-label={`Bulk actions for the ${row.namespace} namespace`}>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => { setBulkNs(row.namespace); setBulkMsg(null); }}
                        >
                          Deprecate namespace
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            const names = row.events!.map(e => e.name);
                            window.open(api.bulkExportUrl(names), '_blank');
                          }}
                        >
                          Export namespace JSON
                        </Button>
                      </div>
                      {bulkNs === row.namespace && (
                        <div className="ns-bulk-confirm">
                          <label className="sr-only" htmlFor={bulkReasonId}>
                            Reason for deprecating the whole namespace
                          </label>
                          <input
                            id={bulkReasonId}
                            type="text"
                            placeholder="Reason for deprecating entire namespace"
                            value={bulkReason}
                            onChange={e => setBulkReason(e.target.value)}
                            className="ns-bulk-input"
                          />
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={async () => {
                              const names = row.events!.map(e => e.name);
                              try {
                                const res = await api.bulkDeprecate(names, { reason: bulkReason || undefined });
                                setBulkMsg(`Deprecated ${res.total}/${names.length} event(s).`);
                                setBulkNs(null);
                                load();
                              } catch (err) {
                                setBulkMsg(`Error: ${(err as Error).message}`);
                              }
                            }}
                          >
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setBulkNs(null)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                      {bulkMsg && <div role="status" className="bulk-msg">{bulkMsg}</div>}
                      <ul className="ns-event-list">
                        {row.events.map(ev => (
                          <li key={ev.name} className="ns-event-row">
                            <Link to={`/events/${encodeURIComponent(ev.name)}`} className="link-plain">
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
