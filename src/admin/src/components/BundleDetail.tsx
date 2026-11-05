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
import { Link, useParams, useSearchParams } from 'react-router';
import { Banner, Chip, ErrorState, LiveRegion, SkeletonCard, Button } from '@connorhoehnslalom/ui-components/shared';
import { api, isRequired, type FeatureBundleEntry } from '../api';
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

  const crumb = (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to="/bundles">Bundles</Link>
      {' / '}
      <span aria-current="page">{name ? decodeURIComponent(name) : 'Bundle'}</span>
    </nav>
  );

  if (error) {
    return (
      <div className="bundle-detail">
        {crumb}
        <ErrorState
          title="Error loading this bundle"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      </div>
    );
  }

  if (loading || !bundle) {
    return (
      <div className="bundle-detail">
        {crumb}
        <div className="skeleton-stack" aria-busy="true">
          <SkeletonCard height={40} />
          <SkeletonCard height={220} />
          <LiveRegion role="none" message="Loading bundle…" />
        </div>
      </div>
    );
  }

  const required = bundle.events.filter(isRequired).length;
  const optional = bundle.events.length - required;
  const replacement = bundle.deprecated?.replacement
    ? parseReplacement(bundle.deprecated.replacement)
    : null;

  return (
    <div className={`bundle-detail${bundle.deprecated ? ' deprecated' : ''}`}>
      {crumb}

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

      <div className="detail-header chips">
        <h2>{bundle.name}</h2>
        <Chip tone="neutral">v{bundle.version}</Chip>
        <Chip tone={transportTone(bundle.transport)}>{bundle.transport}</Chip>
        <Chip tone="neutral">{bundle.events.length} events</Chip>
        {bundle.deprecated ? <Chip tone="danger">deprecated</Chip> : null}
        <FingerprintChip fingerprint={bundle.fingerprint} />
      </div>

      {bundle.description ? <p className="description">{bundle.description}</p> : null}

      <section className="detail-section full-width" aria-labelledby="bundle-members-heading">
        <h3 id="bundle-members-heading">
          Member events
          <span className="bundle-member-summary">
            {' '}— {required} required, {optional} optional
          </span>
        </h3>
        <table className="data-table bundle-members-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Requirement</th>
              <th scope="col">Pinned schema version</th>
            </tr>
          </thead>
          <tbody>
            {bundle.events.map((ref) => (
              <tr key={ref.name}>
                <th scope="row">
                  <Link to={`/events/${encodeURIComponent(ref.name)}`} className="link-plain medium">
                    {ref.name}
                  </Link>
                </th>
                <td>
                  {isRequired(ref) ? (
                    <Chip tone="info" size="xs">required</Chip>
                  ) : (
                    <Chip tone="neutral" size="xs">optional</Chip>
                  )}
                </td>
                {/* An unpinned member floats to whatever the registry holds —
                    which is a real, different state from "pinned to v1". */}
                <td className="cell-mono">{ref.version !== undefined ? `v${ref.version}` : 'current'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
