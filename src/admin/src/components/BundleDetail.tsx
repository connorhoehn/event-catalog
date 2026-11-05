// /bundles/:name — one FeatureBundle and everything a CRD pin depends on.
//
// The member list is the point: which events the bundle claims, which of them
// are REQUIRED (a missing required member is what makes `ec-lint-crd` reject
// the pin), and where each one lives in the catalog.
//
// Deprecation is treated as the loudest thing on the page. An operator who
// arrives here from a CRD they are about to pin has one question — "is this
// still the bundle to use?" — and the answer has to survive being skimmed, so
// it is an alert banner naming the replacement, a chip in the header, and a
// class on the wrapper, not a colour.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Banner,
  Button,
  Chip,
  DataTable,
  DetailPage,
  ErrorState,
  Inline,
  LiveRegion,
  PageSection,
  SkeletonCard,
  Stack,
  type BreadcrumbItem,
} from '@connorhoehnslalom/ui-components/shared';
import { api, isRequired, type FeatureBundleEntry, type BundleEventRef } from '../api';
import { FingerprintChip } from './FingerprintChip';
import { transportTone } from './BundlesView';

/**
 * A replacement is written the way a CRD pins one — `name@version`. Split it
 * so the operator can click through instead of retyping the name into the
 * URL bar; anything that does not parse is left as plain text rather than
 * guessed at.
 */
export function parseReplacement(replacement: string): { name: string; version?: string } | null {
  const trimmed = replacement.trim();
  if (!trimmed) return null;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return { name: trimmed };
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) };
}

export function BundleDetail() {
  const { name } = useParams<{ name: string }>();
  const [params] = useSearchParams();
  const version = params.get('version') ?? undefined;

  const [bundle, setBundle] = useState<FeatureBundleEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!name) return;
    setLoading(true);
    api.getFeatureBundle(decodeURIComponent(name), version)
      .then((res) => {
        setBundle(res);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [name, version]);

  useEffect(() => { load(); }, [load]);

  const navigate = useNavigate();
  const displayName = name ? decodeURIComponent(name) : 'Bundle';
  // The trail navigates client-side; the href is there for open-in-new-tab.
  const crumbs: BreadcrumbItem[] = [
    {
      label: 'Bundles',
      href: '/bundles',
      onClick: (e) => {
        e.preventDefault();
        navigate('/bundles');
      },
    },
    { label: displayName },
  ];

  if (error) {
    return (
      <DetailPage className="bundle-detail" title="Bundle" breadcrumbs={crumbs}>
        <ErrorState
          title="Error loading this bundle"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      </DetailPage>
    );
  }

  if (loading || !bundle) {
    return (
      <DetailPage className="bundle-detail" title="Bundle" breadcrumbs={crumbs}>
        <Stack gap="md" aria-busy="true">
          <SkeletonCard height={40} />
          <SkeletonCard height={220} />
          <LiveRegion role="none" message="Loading bundle…" />
        </Stack>
      </DetailPage>
    );
  }

  const required = bundle.events.filter(isRequired).length;
  const optional = bundle.events.length - required;
  const replacement = bundle.deprecated?.replacement
    ? parseReplacement(bundle.deprecated.replacement)
    : null;

  return (
    <DetailPage
      className={`bundle-detail${bundle.deprecated ? ' deprecated' : ''}`}
      title={bundle.name}
      breadcrumbs={crumbs}
      description={bundle.description || undefined}
      badge={
        <Inline gap="xs" align="center" wrap>
          <Chip tone="neutral">v{bundle.version}</Chip>
          <Chip tone={transportTone(bundle.transport)}>{bundle.transport}</Chip>
          <Chip tone="neutral">{bundle.events.length} events</Chip>
          {bundle.deprecated ? <Chip tone="danger">deprecated</Chip> : null}
          <FingerprintChip fingerprint={bundle.fingerprint} />
        </Inline>
      }
    >
      <Stack gap="md">
        {bundle.deprecated ? (
          <Banner
            variant="error"
            layout="stacked"
            title={`Deprecated bundle — do not pin a new CRD to ${bundle.name}@${bundle.version}`}
            className="bundle-deprecation-banner"
          >
            Deprecated since {bundle.deprecated.since}.{' '}
            {replacement ? (
              <>
                Use{' '}
                <Link
                  to={`/bundles/${encodeURIComponent(replacement.name)}${replacement.version ? `?version=${encodeURIComponent(replacement.version)}` : ''}`}
                  className="link-plain semibold"
                >
                  {bundle.deprecated.replacement}
                </Link>{' '}
                instead.
              </>
            ) : (
              'No replacement was named — check with the owning service before pinning.'
            )}
          </Banner>
        ) : null}

        <PageSection title={`Member events — ${required} required, ${optional} optional`} size="md">
          <DataTable<BundleEventRef>
            data={bundle.events}
            keyField={(ref) => ref.name}
            onRowClick={(ref) => navigate(`/events/${encodeURIComponent(ref.name)}`)}
            columns={[
              {
                key: 'name',
                header: 'Event',
                render: (ref) => (
                  <Link to={`/events/${encodeURIComponent(ref.name)}`} className="link-plain medium">
                    {ref.name}
                  </Link>
                ),
              },
              {
                key: 'requirement',
                header: 'Requirement',
                render: (ref) =>
                  isRequired(ref) ? (
                    <Chip tone="info" size="xs">required</Chip>
                  ) : (
                    <Chip tone="neutral" size="xs">optional</Chip>
                  ),
              },
              {
                // An unpinned member floats to whatever the registry holds —
                // which is a real, different state from "pinned to v1".
                key: 'version',
                header: 'Pinned schema version',
                className: 'cell-mono',
                render: (ref) => (ref.version !== undefined ? `v${ref.version}` : 'current'),
              },
            ]}
          />
        </PageSection>
      </Stack>
    </DetailPage>
  );
}
