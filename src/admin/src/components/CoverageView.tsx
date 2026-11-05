// /coverage — which declared events no FeatureBundle contains.
//
// The audit that prompted this view found 83 of 225 declared events in no
// bundle at all, and nobody could see that without running a script. A flat
// list of 83 names is not much better than the script, so the gaps are
// grouped by namespace: 31 uncovered `client:*` frames is one decision an
// operator can make, not thirty-one.
//
// Two payloads, one diff (see ./bundles/coverage.ts):
//   GET /api/events          — everything declared
//   GET /api/feature-bundles — everything pinnable
// Either failing is an error, not an empty view: "no gaps" and "the registry
// did not answer" must never look the same.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Banner, Chip, EmptyState, ErrorState, LoadingState, ProgressBar, Button } from '@connorhoehnslalom/ui-components/shared';
import { api, type EventEntry, type FeatureBundleEntry } from '../api';
import {
  computeCoverage,
  lookupEvents,
  type CoverageRow,
  type NamespaceCoverage,
} from './bundles/coverage';

const LOOKUP_LIMIT = 50;

/** Fill colour for a coverage bar. The number next to it says the same thing. */
function barColor(covered: number, total: number): string {
  if (total === 0 || covered === total) return 'var(--success)';
  if (covered === 0) return 'var(--error)';
  return 'var(--warning)';
}

/** The bundles covering one event, or the fact that none do. */
function CoverageCell({ row }: { row: CoverageRow }) {
  if (row.bundles.length === 0) {
    return <Chip tone="danger" size="xs">no bundle</Chip>;
  }
  return (
    <span className="coverage-bundle-links">
      {row.bundles.map((b) => (
        <Link
          key={`${b.name}@${b.version}`}
          to={`/bundles/${encodeURIComponent(b.name)}?version=${encodeURIComponent(b.version)}`}
          className={`coverage-bundle-link${b.deprecated ? ' deprecated' : ''}`}
        >
          {b.name}@{b.version}
          {b.deprecated ? ' (deprecated)' : ''}
          {b.required ? '' : ' (optional)'}
        </Link>
      ))}
    </span>
  );
}

export function CoverageView() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [bundles, setBundles] = useState<FeatureBundleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gapsOnly, setGapsOnly] = useState(true);
  const [query, setQuery] = useState('');
  const lookupId = useId();

  const load = useCallback(() => {
    setLoading(true);
    // Both or neither. A partial answer would understate coverage — missing
    // bundles read as missing coverage — and understating it is exactly the
    // wrong direction for a view whose output is "go declare a bundle".
    Promise.all([api.getEvents(), api.getFeatureBundles()])
      .then(([eventsRes, bundlesRes]) => {
        setEvents(eventsRes.events);
        setBundles(bundlesRes.bundles);
        setLoaded(true);
        setError(null);
        // Open the worst namespace so the view answers something on arrival
        // instead of presenting eight closed drawers.
        const worst = computeCoverage(eventsRes.events, bundlesRes.bundles).namespaces[0];
        setExpanded(worst && worst.uncovered > 0 ? new Set([worst.namespace]) : new Set());
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const coverage = useMemo(() => computeCoverage(events, bundles), [events, bundles]);
  const matches = useMemo(
    () => lookupEvents(coverage.rows, query, LOOKUP_LIMIT),
    [coverage.rows, query],
  );

  const visibleGroups = useMemo(
    () => (gapsOnly ? coverage.namespaces.filter((n) => n.uncovered > 0) : coverage.namespaces),
    [coverage.namespaces, gapsOnly],
  );

  const toggle = (namespace: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) next.delete(namespace);
      else next.add(namespace);
      return next;
    });

  const searching = query.trim().length > 0;

  return (
    <div className="coverage-view view-column">
      <div className="view-toolbar">
        <h2>Bundle Coverage</h2>
        <Chip tone="neutral">{coverage.total} events</Chip>
        <Chip tone="success">{coverage.covered} covered</Chip>
        <Chip tone={coverage.uncovered > 0 ? 'danger' : 'success'}>
          {coverage.uncovered} uncovered
        </Chip>
        <Chip tone="info">{coverage.bundleCount} bundles</Chip>
        <div className="view-toolbar-right">
          <Link to="/bundles" className="link-plain medium">All bundles</Link>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>
      </div>

      {error ? (
        <ErrorState
          title="Error loading coverage"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      ) : loading && !loaded ? (
        <LoadingState label="Loading coverage…" />
      ) : (
        <div className="view-scroll">
          <div className="coverage-summary">
            <ProgressBar
              value={coverage.covered}
              max={Math.max(coverage.total, 1)}
              color={barColor(coverage.covered, coverage.total)}
              aria-label={`${coverage.covered} of ${coverage.total} declared events belong to a bundle`}
              className="coverage-bar"
            />
            <p className="coverage-summary-line">
              <strong>{coverage.uncovered}</strong> of {coverage.total} declared events belong to
              no bundle, so no CRD can pin them ({coverage.percent}% covered).
              {coverage.onlyDeprecated > 0 ? (
                <>
                  {' '}
                  <strong>{coverage.onlyDeprecated}</strong> more are only in a deprecated bundle.
                </>
              ) : null}
            </p>
          </div>

          {coverage.dangling.length > 0 ? (
            <Banner variant="warning" layout="stacked" title="Bundles reference events the catalog does not have">
              {coverage.dangling.map((d) => `${d.name}${d.required ? ' (required)' : ''}`).join(', ')}
              . A required member that is not declared makes its bundle fail validation.
            </Banner>
          ) : null}

          <div className="coverage-controls">
            <label className="field-label" htmlFor={lookupId}>
              Is this event covered?
            </label>
            <input
              id={lookupId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Look up an event by name…"
              className="ns-filter-input wide"
            />
            <div role="group" aria-label="Which namespaces to list">
              <Button
                size="sm"
                aria-pressed={gapsOnly}
                variant={gapsOnly ? 'primary' : 'secondary'}
                onClick={() => setGapsOnly(true)}
              >
                Namespaces with gaps
              </Button>
              <Button
                size="sm"
                aria-pressed={!gapsOnly}
                variant={!gapsOnly ? 'primary' : 'secondary'}
                onClick={() => setGapsOnly(false)}
              >
                All namespaces
              </Button>
            </div>
          </div>

          {searching ? (
            <section aria-labelledby="coverage-lookup-heading" className="coverage-lookup">
              <h3 id="coverage-lookup-heading">
                {matches.length === 0
                  ? `No declared event matches “${query}”`
                  : `${matches.length}${matches.length === LOOKUP_LIMIT ? '+' : ''} matching event${matches.length === 1 ? '' : 's'}`}
              </h3>
              {matches.length > 0 ? (
                <table className="data-table coverage-table">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Namespace</th>
                      <th scope="col">Transport</th>
                      <th scope="col">In bundles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((row) => (
                      <tr key={row.name} className={row.covered ? undefined : 'uncovered'}>
                        <th scope="row">
                          <Link to={`/events/${encodeURIComponent(row.name)}`} className="link-plain medium">
                            {row.name}
                          </Link>
                        </th>
                        <td>{row.namespace}</td>
                        <td>
                          <Chip tone={row.transport === 'durable' ? 'warning' : 'info'} size="xs">
                            {row.transport}
                          </Chip>
                        </td>
                        <td><CoverageCell row={row} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : visibleGroups.length === 0 ? (
            <EmptyState
              icon="✅"
              title={gapsOnly ? 'Every namespace is fully covered' : 'No events declared'}
              body={
                gapsOnly
                  ? 'Every declared event belongs to at least one FeatureBundle.'
                  : 'Declare an event to populate the catalog.'
              }
            />
          ) : (
            <ul className="coverage-groups">
              {visibleGroups.map((group) => (
                <CoverageGroup
                  key={group.namespace}
                  group={group}
                  expanded={expanded.has(group.namespace)}
                  onToggle={() => toggle(group.namespace)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CoverageGroup({
  group,
  expanded,
  onToggle,
}: {
  group: NamespaceCoverage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const bodyId = `coverage-body-${group.namespace}`;
  return (
    <li className="coverage-group">
      <h3 className="coverage-group-heading">
        <button
          type="button"
          className="coverage-group-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="ns-card-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="coverage-group-name">{group.namespace}</span>
          <Chip tone={group.uncovered > 0 ? 'danger' : 'success'} size="xs">
            {group.uncovered} uncovered
          </Chip>
          <Chip tone="neutral" size="xs">{group.covered}/{group.total} covered</Chip>
          {group.onlyDeprecated > 0 ? (
            <Chip tone="warning" size="xs">
              {group.onlyDeprecated} only in a deprecated bundle
            </Chip>
          ) : null}
        </button>
      </h3>

      <ProgressBar
        value={group.covered}
        max={Math.max(group.total, 1)}
        size="sm"
        color={barColor(group.covered, group.total)}
        aria-label={`${group.namespace}: ${group.covered} of ${group.total} events belong to a bundle`}
        className="coverage-bar"
      />

      {expanded ? (
        <div id={bodyId} className="coverage-group-body">
          {group.uncoveredEvents.length === 0 ? (
            <p className="coverage-group-empty">
              Every event in this namespace belongs to a bundle.
            </p>
          ) : (
            <table className="data-table coverage-table">
              <thead>
                <tr>
                  <th scope="col">Uncovered event</th>
                  <th scope="col">Transport</th>
                  <th scope="col">Producer</th>
                </tr>
              </thead>
              <tbody>
                {group.uncoveredEvents.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">
                      <Link to={`/events/${encodeURIComponent(row.name)}`} className="link-plain medium">
                        {row.name}
                      </Link>
                    </th>
                    <td>
                      <Chip tone={row.transport === 'durable' ? 'warning' : 'info'} size="xs">
                        {row.transport}
                      </Chip>
                    </td>
                    <td className="cell-mono">{row.producer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </li>
  );
}
