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
import {
  Button,
  Card,
  CatalogGrid,
  Chip,
  CollectionPage,
  EmptyState,
  ErrorState,
  Inline,
  Input,
  LoadingState,
} from '@connorhoehnslalom/ui-components/shared';
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

  const isEmpty = !error && !(loading && rows.length === 0) && filtered.length === 0;

  return (
    // The heading stays put in every state — bailing out to a bare banner
    // used to leave the view with no heading at all.
    <CollectionPage
      title="Namespaces"
      gutter="page"
      badge={<Chip tone="info">{rows.length} total</Chip>}
      headerActions={<Button variant="ghost" size="sm" onClick={load}>Refresh</Button>}
      toolbar={{
        label: 'Namespace controls',
        layout: 'cards',
        search: {
          value: search,
          onChange: setSearch,
          placeholder: 'Filter by namespace…',
          'aria-label': 'Filter by namespace',
        },
      }}
      error={
        error ? (
          <ErrorState
            title="Error loading namespaces"
            description={error}
            action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
          />
        ) : undefined
      }
      isEmpty={isEmpty}
      empty={
        <EmptyState
          icon="📂"
          title="No namespaces"
          body={search ? `No namespace matches "${search}".` : 'Declare an event to populate the catalog.'}
        />
      }
    >
      {loading && rows.length === 0 ? (
        <LoadingState label="Loading namespaces…" />
      ) : (
        <CatalogGrid columns={3}>
          {filtered.map(row => {
            const isExpanded = expanded === row.namespace;
            return (
              <Card key={row.namespace} className="ns-card">
                <Button
                  variant="ghost"
                  fullWidth
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
                  <Inline gap="xs" wrap>
                    <Chip tone="neutral">{row.eventCount} events</Chip>
                    {row.signalCount > 0 ? <Chip tone="info">{row.signalCount} signal</Chip> : null}
                    {row.durableCount > 0 ? <Chip tone="warning">{row.durableCount} durable</Chip> : null}
                    {row.deprecatedCount > 0 ? <Chip tone="danger">{row.deprecatedCount} deprecated</Chip> : null}
                  </Inline>
                  <div className="ns-card-meta">
                    {row.producerCount} producer{row.producerCount === 1 ? '' : 's'} · {row.subscriberCount} subscriber{row.subscriberCount === 1 ? '' : 's'}
                  </div>
                </Button>

                {isExpanded && row.events && (
                  <div className="ns-card-body" id={`ns-body-${row.namespace}`}>
                    {/* wave26-f — namespace-level bulk actions */}
                    <Inline gap="sm" wrap role="group" aria-label={`Bulk actions for the ${row.namespace} namespace`}>
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
                    </Inline>
                    {bulkNs === row.namespace && (
                      <Inline gap="sm" wrap align="center">
                        <label className="sr-only" htmlFor={bulkReasonId}>
                          Reason for deprecating the whole namespace
                        </label>
                        <Input
                          id={bulkReasonId}
                          type="text"
                          size="sm"
                          placeholder="Reason for deprecating entire namespace"
                          value={bulkReason}
                          onChange={e => setBulkReason(e.target.value)}
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
                      </Inline>
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
              </Card>
            );
          })}
        </CatalogGrid>
      )}
    </CollectionPage>
  );
}
