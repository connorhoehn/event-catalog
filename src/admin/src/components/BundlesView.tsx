// /bundles — the FeatureBundle inventory.
//
// A bundle is what a deployment actually adopts: a named, versioned,
// fingerprinted set of events that a Kubernetes CRD pins to and `ec-lint-crd`
// validates against. Until now none of that was visible in the admin at all —
// the only way to see which bundles existed was to read
// `src/declarations/bundles` or curl the server.
//
// One round-trip: GET /api/feature-bundles returns every bundle with its
// members, so the member count and the required count are read off the
// payload rather than fetched per row.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import ErrorState from '@ui/components/shared/ErrorState';
import LoadingState from '@ui/components/shared/LoadingState';
import { Button } from '@ui/components/ui/Button';
import { api, isRequired, type FeatureBundleEntry } from '../api';
import { FingerprintChip } from './FingerprintChip';

/** Bundle transports include `both`, which events never do. */
export function transportTone(transport: FeatureBundleEntry['transport']) {
  if (transport === 'signal') return 'info' as const;
  if (transport === 'durable') return 'warning' as const;
  return 'purple' as const;
}

/** `/bundles/chat?version=1.0.0` — the version is part of the identity. */
export function bundleHref(bundle: FeatureBundleEntry): string {
  return `/bundles/${encodeURIComponent(bundle.name)}?version=${encodeURIComponent(bundle.version)}`;
}

export function BundlesView() {
  const [bundles, setBundles] = useState<FeatureBundleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Three states, not two. An empty `bundles` while the request is in flight
  // is not "this deployment has no bundles" — that conclusion sends an
  // operator to look for a registration bug that may not exist.
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const searchId = useId();

  const load = useCallback(() => {
    setLoading(true);
    api.getFeatureBundles()
      .then((res) => {
        setBundles(res.bundles);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q),
    );
  }, [bundles, search]);

  const deprecatedCount = bundles.filter((b) => b.deprecated).length;

  return (
    <div className="bundles-view view-column">
      <div className="view-toolbar">
        <h2>Feature Bundles</h2>
        <Chip tone="info">{bundles.length} total</Chip>
        {deprecatedCount > 0 ? <Chip tone="danger">{deprecatedCount} deprecated</Chip> : null}
        <label className="sr-only" htmlFor={searchId}>Filter bundles by name or description</label>
        <input
          id={searchId}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter bundles…"
          className="ns-filter-input"
        />
        <div className="view-toolbar-right">
          <Link to="/coverage" className="link-plain medium">
            Coverage gaps
          </Link>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </div>
      </div>

      {error ? (
        <ErrorState
          title="Error loading bundles"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      ) : loading && bundles.length === 0 ? (
        <LoadingState label="Loading bundles…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No bundles registered"
          body={
            search
              ? `No bundle matches "${search}".`
              : 'The catalog server registered no FeatureBundles at boot. Bundles are declared in src/declarations/bundles and must be registered into the server’s bundle registry before a CRD can pin one.'
          }
        />
      ) : (
        <div className="view-scroll tight">
          <table className="data-table bundles-table">
            <thead>
              <tr>
                <th scope="col">Bundle</th>
                <th scope="col">Version</th>
                <th scope="col">Transport</th>
                <th scope="col">Events</th>
                <th scope="col">Status</th>
                <th scope="col">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bundle) => {
                const required = bundle.events.filter(isRequired).length;
                return (
                  <tr
                    key={`${bundle.name}@${bundle.version}`}
                    /* Not colour alone: the row also carries a "deprecated"
                       chip and the replacement in the Status cell. */
                    className={bundle.deprecated ? 'bundle-row deprecated' : 'bundle-row'}
                  >
                    <th scope="row">
                      <Link to={bundleHref(bundle)} className="link-plain semibold">
                        {bundle.name}
                      </Link>
                      {bundle.description ? (
                        <div className="event-desc">{bundle.description}</div>
                      ) : null}
                    </th>
                    <td className="cell-mono">{bundle.version}</td>
                    <td>
                      <Chip tone={transportTone(bundle.transport)} size="xs">
                        {bundle.transport}
                      </Chip>
                    </td>
                    <td className="cell-mono">
                      {bundle.events.length}
                      <span className="bundle-required-note"> ({required} required)</span>
                    </td>
                    <td>
                      {bundle.deprecated ? (
                        <span className="bundle-status">
                          <Chip tone="danger" size="xs">deprecated</Chip>
                          <span className="bundle-deprecated-meta">
                            since {bundle.deprecated.since}
                            {bundle.deprecated.replacement
                              ? ` — use ${bundle.deprecated.replacement}`
                              : ''}
                          </span>
                        </span>
                      ) : (
                        <Chip tone="success" size="xs">active</Chip>
                      )}
                    </td>
                    <td>
                      <FingerprintChip fingerprint={bundle.fingerprint} label="" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
