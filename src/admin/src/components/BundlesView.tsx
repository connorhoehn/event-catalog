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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  Chip,
  CollectionPage,
  EmptyState,
  ErrorState,
  LoadingState,
  type DataTableColumn,
} from '@connorhoehnslalom/ui-components/shared';
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
  const navigate = useNavigate();

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

  const columns: DataTableColumn<FeatureBundleEntry>[] = [
    {
      key: 'name',
      header: 'Bundle',
      render: (bundle) => (
        <>
          <Link to={bundleHref(bundle)} className="link-plain semibold">
            {bundle.name}
          </Link>
          {bundle.description ? <div className="event-desc">{bundle.description}</div> : null}
        </>
      ),
    },
    { key: 'version', header: 'Version', className: 'cell-mono' },
    {
      key: 'transport',
      header: 'Transport',
      render: (bundle) => (
        <Chip tone={transportTone(bundle.transport)} size="xs">
          {bundle.transport}
        </Chip>
      ),
    },
    {
      key: 'events',
      header: 'Events',
      className: 'cell-mono',
      render: (bundle) => (
        <>
          {bundle.events.length}
          <span className="bundle-required-note"> ({bundle.events.filter(isRequired).length} required)</span>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      /* Not colour alone: a deprecated row carries the word, the date and
         the replacement in this cell. */
      render: (bundle) =>
        bundle.deprecated ? (
          <span className="bundle-status">
            <Chip tone="danger" size="xs">deprecated</Chip>
            <span className="bundle-deprecated-meta">
              since {bundle.deprecated.since}
              {bundle.deprecated.replacement ? ` — use ${bundle.deprecated.replacement}` : ''}
            </span>
          </span>
        ) : (
          <Chip tone="success" size="xs">active</Chip>
        ),
    },
    {
      key: 'fingerprint',
      header: 'Fingerprint',
      render: (bundle) => <FingerprintChip fingerprint={bundle.fingerprint} label="" />,
    },
  ];

  // Three states, kept apart: an error is never an empty inventory, and an
  // in-flight first load is never "no bundles registered".
  const firstLoad = loading && bundles.length === 0 && !error;

  return (
    <CollectionPage
      className="bundles-view"
      title="Feature Bundles"
      gutter="page"
      headerActions={
        <>
          <Link to="/coverage" className="link-plain medium">
            Coverage gaps
          </Link>
          <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
        </>
      }
      toolbar={{
        label: 'Bundle controls',
        search: {
          value: search,
          onChange: setSearch,
          placeholder: 'Filter bundles…',
          'aria-label': 'Filter bundles by name or description',
        },
        summary: (
          <>
            <Chip tone="info">{bundles.length} total</Chip>
            {deprecatedCount > 0 ? <Chip tone="danger">{deprecatedCount} deprecated</Chip> : null}
          </>
        ),
      }}
      error={
        error ? (
          <ErrorState
            title="Error loading bundles"
            description={error}
            action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
          />
        ) : undefined
      }
      empty={
        <EmptyState
          icon="📦"
          title="No bundles registered"
          body={
            search
              ? `No bundle matches "${search}".`
              : 'The catalog server registered no FeatureBundles at boot. Bundles are declared in src/declarations/bundles and must be registered into the server’s bundle registry before a CRD can pin one.'
          }
        />
      }
      table={
        firstLoad
          ? undefined
          : {
              data: filtered,
              columns,
              keyField: (bundle) => `${bundle.name}@${bundle.version}`,
              onRowClick: (bundle) => navigate(bundleHref(bundle)),
            }
      }
    >
      {firstLoad ? <LoadingState label="Loading bundles…" /> : null}
    </CollectionPage>
  );
}
