// Bundle coverage — which declared events belong to no FeatureBundle.
//
// This is a pure diff of two authoritative payloads, kept out of the view so
// it can be tested against the whole catalog rather than through the DOM:
//
//   GET /api/events           — every declared event
//   GET /api/feature-bundles  — every registered bundle, with its members
//
// It is a set difference, not an estimate: a bundle member IS an event name,
// so "covered" needs no heuristic. The one thing the client cannot know is a
// bundle the server never registered — see the note on `dangling` below.
//
// Why an operator cares: a CRD can only pin a bundle. An event in no bundle
// is an event no deployment can adopt as a unit, and an event whose only
// bundle is deprecated is worse — it looks pinnable right up until the pin is
// rejected. Both are surfaced here rather than left to be discovered by a
// script.

import { isRequired, type BundleEventRef, type EventEntry, type FeatureBundleEntry } from '../../api';

/** A bundle that contains a given event, flattened for display. */
export interface CoveringBundle {
  name: string;
  version: string;
  /** False only when the member was declared `required: false`. */
  required: boolean;
  deprecated: boolean;
}

/** One declared event with its bundle membership resolved. */
export interface CoverageRow {
  name: string;
  namespace: string;
  transport: string;
  producer: string;
  bundles: CoveringBundle[];
  /** In at least one bundle, deprecated or not. */
  covered: boolean;
  /** In at least one bundle, and every one of them is deprecated. */
  onlyDeprecated: boolean;
}

/** Rollup for one namespace, which is how the gaps are made legible. */
export interface NamespaceCoverage {
  namespace: string;
  total: number;
  covered: number;
  uncovered: number;
  /** Covered, but only by deprecated bundles — a gap in waiting. */
  onlyDeprecated: number;
  /** The events with no bundle at all, in catalog order. */
  uncoveredEvents: CoverageRow[];
}

/** A bundle member that names an event the registry does not have. */
export interface DanglingMember {
  name: string;
  bundles: CoveringBundle[];
  /** True when at least one bundle needs it — i.e. that bundle cannot validate. */
  required: boolean;
}

export interface Coverage {
  total: number;
  covered: number;
  uncovered: number;
  onlyDeprecated: number;
  /** Percentage of declared events in at least one bundle, 0–100, rounded. */
  percent: number;
  bundleCount: number;
  /** Every event, name-sorted — the lookup index behind the search box. */
  rows: CoverageRow[];
  /** Namespaces with the biggest gaps first, then alphabetical. */
  namespaces: NamespaceCoverage[];
  dangling: DanglingMember[];
}

/**
 * The namespace to file an event under. The server populates `namespace` on
 * every entry, so the fallback only fires against a stale or partial payload —
 * but it fires the way the registry's own `resolveNamespace` does (first
 * segment before a `.` or `:`), so a fallback row lands in the same group as
 * its siblings instead of in a bucket of its own.
 */
export function namespaceOf(event: Pick<EventEntry, 'name' | 'namespace'>): string {
  if (event.namespace) return event.namespace;
  const match = /^([^.:]+)[.:]/.exec(event.name);
  return match ? match[1]! : 'unnamespaced';
}

function producerOf(producer: EventEntry['producer']): string {
  return Array.isArray(producer) ? producer.join(', ') : producer;
}

/**
 * Diff the catalog against the bundle registry.
 *
 * Both arguments are whole payloads; nothing is fetched here and nothing is
 * memoised — at 226 events and 18 bundles this is a couple of map builds, and
 * a view that recomputes on every render is easier to reason about than one
 * with a stale cache.
 */
export function computeCoverage(
  events: EventEntry[],
  bundles: FeatureBundleEntry[],
): Coverage {
  // eventName -> the bundles that name it.
  const membership = new Map<string, CoveringBundle[]>();
  for (const bundle of bundles) {
    const deprecated = bundle.deprecated !== undefined;
    for (const ref of bundle.events as BundleEventRef[]) {
      const list = membership.get(ref.name) ?? [];
      list.push({
        name: bundle.name,
        version: bundle.version,
        required: isRequired(ref),
        deprecated,
      });
      membership.set(ref.name, list);
    }
  }

  const rows: CoverageRow[] = events.map((event) => {
    const bundlesFor = membership.get(event.name) ?? [];
    return {
      name: event.name,
      namespace: namespaceOf(event),
      transport: event.transport,
      producer: producerOf(event.producer),
      bundles: bundlesFor,
      covered: bundlesFor.length > 0,
      onlyDeprecated: bundlesFor.length > 0 && bundlesFor.every((b) => b.deprecated),
    };
  });

  const groups = new Map<string, NamespaceCoverage>();
  for (const row of rows) {
    let group = groups.get(row.namespace);
    if (!group) {
      group = {
        namespace: row.namespace,
        total: 0,
        covered: 0,
        uncovered: 0,
        onlyDeprecated: 0,
        uncoveredEvents: [],
      };
      groups.set(row.namespace, group);
    }
    group.total += 1;
    if (row.covered) {
      group.covered += 1;
      if (row.onlyDeprecated) group.onlyDeprecated += 1;
    } else {
      group.uncovered += 1;
      group.uncoveredEvents.push(row);
    }
  }

  // A member naming an event the registry does not hold. The catalog is the
  // authority on what exists, so this is a real finding — a required one is a
  // bundle that cannot pass `POST /api/feature-bundles/validate`.
  const declared = new Set(events.map((e) => e.name));
  const dangling: DanglingMember[] = [];
  for (const [name, bundlesFor] of membership) {
    if (declared.has(name)) continue;
    dangling.push({
      name,
      bundles: bundlesFor,
      required: bundlesFor.some((b) => b.required),
    });
  }
  dangling.sort((a, b) => a.name.localeCompare(b.name));

  const covered = rows.filter((r) => r.covered).length;
  const onlyDeprecated = rows.filter((r) => r.onlyDeprecated).length;

  return {
    total: rows.length,
    covered,
    uncovered: rows.length - covered,
    onlyDeprecated,
    percent: rows.length === 0 ? 0 : Math.round((covered / rows.length) * 100),
    bundleCount: bundles.length,
    rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    // Biggest gap first: the point of the view is to be read top-down and
    // stopped at, not scrolled through alphabetically.
    namespaces: [...groups.values()].sort(
      (a, b) => b.uncovered - a.uncovered || a.namespace.localeCompare(b.namespace),
    ),
    dangling,
  };
}

/** Case-insensitive substring match over event names, for the lookup box. */
export function lookupEvents(rows: CoverageRow[], query: string, limit = 50): CoverageRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) => r.name.toLowerCase().includes(q)).slice(0, limit);
}
