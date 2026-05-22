"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisManifestStore = void 0;
exports.buildDriftReport = buildDriftReport;
const REDIS_KEY = 'event-catalog:manifests';
class RedisManifestStore {
    redis;
    constructor(redis) {
        this.redis = redis;
    }
    async put(entry) {
        const stored = {
            consumerName: entry.consumerName,
            events: entry.events.slice(),
            updatedAt: new Date().toISOString(),
        };
        await this.redis.hSet(REDIS_KEY, entry.consumerName, JSON.stringify(stored));
        return stored;
    }
    async get(consumerName) {
        const raw = await this.redis.hGet(REDIS_KEY, consumerName);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async list() {
        const all = await this.redis.hGetAll(REDIS_KEY);
        const entries = [];
        for (const raw of Object.values(all)) {
            try {
                entries.push(JSON.parse(raw));
            }
            catch {
                // Drop unparseable; surfacing every parse error would be noisy.
            }
        }
        return entries;
    }
    async remove(consumerName) {
        const removed = await this.redis.hDel(REDIS_KEY, consumerName);
        return removed > 0;
    }
    async driftReport(currentFingerprints) {
        const manifests = await this.list();
        return manifests.map((m) => buildDriftReport(m, currentFingerprints));
    }
}
exports.RedisManifestStore = RedisManifestStore;
/**
 * Pure helper exported for testability. Pure function over a manifest
 * + a fingerprint map; no I/O.
 */
function buildDriftReport(manifest, currentFingerprints) {
    const events = manifest.events.map((evt) => {
        const current = currentFingerprints.get(evt.name) ?? null;
        const status = current === null
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
    for (const e of events)
        summary[e.status] += 1;
    return {
        consumerName: manifest.consumerName,
        updatedAt: manifest.updatedAt,
        events,
        summary,
    };
}
//# sourceMappingURL=manifest-store.js.map