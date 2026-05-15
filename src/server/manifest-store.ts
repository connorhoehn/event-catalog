// src/server/manifest-store.ts
//
// wave23-b — consumer manifest pinning. A "manifest" is a consumer's
// declaration of which events it depends on and at which fingerprints
// it last verified them. The catalog stores these per consumer; when
// a publisher's schema drifts, the catalog can tell each pinned
// consumer whether it's still compatible.
//
// Storage: a single Redis hash at `event-catalog:manifests` keyed by
// consumerName, value is JSON-encoded ManifestEntry. Hash semantics
// give us atomic per-consumer write + scan.
//
// Gating (rejecting POST /api/events that would break a pinned
// consumer) is intentionally a follow-up wave — this primitive just
// stores + reports.

import type { RedisClientType } from 'redis';

const REDIS_KEY = 'event-catalog:manifests';

export interface ManifestEvent {
  /** Canonical event name (post-alias-resolution by the consumer). */
  name: string;
  /** sha256 fingerprint the consumer last verified against. */
  fingerprint: string;
}

export interface ManifestEntry {
  consumerName: string;
  events: ManifestEvent[];
  /** ISO 8601 — when the manifest was last written. */
  updatedAt: string;
}

export interface ManifestDriftReport {
  consumerName: string;
  updatedAt: string;
  /** One row per pinned event. */
  events: Array<{
    name: string;
    pinnedFingerprint: string;
    currentFingerprint: string | null;
    status: 'fresh' | 'stale' | 'unknown';
  }>;
  /** Convenience counters. */
  summary: { fresh: number; stale: number; unknown: number };
}

export interface ManifestStore {
  put(entry: { consumerName: string; events: ManifestEvent[] }): Promise<ManifestEntry>;
  get(consumerName: string): Promise<ManifestEntry | null>;
  list(): Promise<ManifestEntry[]>;
  remove(consumerName: string): Promise<boolean>;
  /**
   * Compare every pinned manifest against the current registry's
   * fingerprints (passed in by the route — keeps this module
   * registry-agnostic for testability).
   */
  driftReport(currentFingerprints: Map<string, string>): Promise<ManifestDriftReport[]>;
}

export class RedisManifestStore implements ManifestStore {
  constructor(private readonly redis: RedisClientType) {}

  async put(entry: { consumerName: string; events: ManifestEvent[] }): Promise<ManifestEntry> {
    const stored: ManifestEntry = {
      consumerName: entry.consumerName,
      events: entry.events.slice(),
      updatedAt: new Date().toISOString(),
    };
    await this.redis.hSet(REDIS_KEY, entry.consumerName, JSON.stringify(stored));
    return stored;
  }

  async get(consumerName: string): Promise<ManifestEntry | null> {
    const raw = await this.redis.hGet(REDIS_KEY, consumerName);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ManifestEntry;
    } catch {
      return null;
    }
  }

  async list(): Promise<ManifestEntry[]> {
    const all = await this.redis.hGetAll(REDIS_KEY);
    const entries: ManifestEntry[] = [];
    for (const raw of Object.values(all)) {
      try {
        entries.push(JSON.parse(raw) as ManifestEntry);
      } catch {
        // Drop unparseable; surfacing every parse error would be noisy.
      }
    }
    return entries;
  }

  async remove(consumerName: string): Promise<boolean> {
    const removed = await this.redis.hDel(REDIS_KEY, consumerName);
    return removed > 0;
  }

  async driftReport(currentFingerprints: Map<string, string>): Promise<ManifestDriftReport[]> {
    const manifests = await this.list();
    return manifests.map((m) => buildDriftReport(m, currentFingerprints));
  }
}

/**
 * Pure helper exported for testability. Pure function over a manifest
 * + a fingerprint map; no I/O.
 */
export function buildDriftReport(
  manifest: ManifestEntry,
  currentFingerprints: Map<string, string>,
): ManifestDriftReport {
  const events = manifest.events.map((evt) => {
    const current = currentFingerprints.get(evt.name) ?? null;
    const status: 'fresh' | 'stale' | 'unknown' = current === null
      ? 'unknown'
      : current === evt.fingerprint
        ? 'fresh'
        : 'stale';
    return {
      name: evt.name,
      pinnedFingerprint: evt.fingerprint,
      currentFingerprint: current,
      status,
    };
  });
  const summary = { fresh: 0, stale: 0, unknown: 0 };
  for (const e of events) summary[e.status] += 1;
  return {
    consumerName: manifest.consumerName,
    updatedAt: manifest.updatedAt,
    events,
    summary,
  };
}
