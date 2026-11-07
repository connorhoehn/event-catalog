import { AUTH_REQUIRED_MESSAGE, noteResponseStatus } from './auth';

/**
 * Same-origin proxy prefix. The server rewrites `/admin-api/*` to `/api/*` and
 * adds the catalog token only for a browser that signed in through
 * `signIn` below, so this page never holds the token itself.
 */
const BASE = '/admin-api';

/**
 * A failed API call, carrying the status so a caller can branch on it without
 * pattern-matching a message string.
 *
 * `message` is what every view already renders (`setError(err.message)`), so
 * making a 401 legible is a matter of what goes in here rather than a change
 * at ten call sites. For everything else the wording is byte-for-byte what it
 * was — `API <status>: <body>` — because those messages are what the existing
 * error-state tests and screenshots assert on.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Raw response body, for the rare caller that wants the server's detail. */
  readonly body: string;

  constructor(status: number, body: string) {
    super(status === 401 ? AUTH_REQUIRED_MESSAGE : `API ${status}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** True when this failure was the auth gate, not the catalog being unwell. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  // Every response, not only the failures: this is the one funnel all ~45
  // endpoints pass through, so the app-wide "writes are being challenged"
  // latch cannot miss a call site.
  noteResponseStatus(res.status);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

async function requestText(path: string): Promise<string> {
  const res = await fetch(path);
  noteResponseStatus(res.status);
  if (!res.ok) {
    throw new ApiError(res.status, '');
  }
  return res.text();
}

// Types matching the server API responses
export interface SchemaHistoryEntry {
  version: number;
  schema: Record<string, unknown>;
  /** Phase E6.5 — sha256 of the historical schema; optional on legacy entries. */
  fingerprint?: string;
  updatedAt: string;
}

export interface EventEntry {
  name: string;
  /** Phase E7 — always populated by the registry (auto-derived if not declared). */
  namespace?: string;
  transport: 'signal' | 'durable';
  producer: string | string[];
  description?: string;
  tags?: string[];
  schema: Record<string, unknown>;
  /** Phase E6 — sha256 of the canonical schema serialization. */
  schemaFingerprint?: string;
  version?: number;
  schemaHistory?: SchemaHistoryEntry[];
  subscribers: string[];
  metadata: {
    createdAt: string;
    lastPublishedAt: string | null;
    publishCount: number;
    errorCount: number;
  };
  /** wave25-a — present when event is currently deprecated. */
  deprecation?: {
    deprecatedAt: string;
    reason?: string;
    by?: string;
  };
  stats: EventStats | null;
}

export interface EventStats {
  publishCount: number;
  publishRate: number;
  lastPublishedAt: string | null;
  errorCount: number;
  subscriberCount: number;
  queueDepth?: number;
  messagesInFlight?: number;
  oldestMessageAge?: number;
}

/**
 * One member of a FeatureBundle, as `src/bundles/FeatureBundle.ts` declares it.
 *
 * `required` is **absent-means-required**: the server's `validateBundle` fails
 * a missing member unless it was declared `required: false`. Rendering an
 * absent flag as "optional" would tell an operator a CRD gate is lenient when
 * it is not, so every reader here goes through `isRequired`.
 */
export interface BundleEventRef {
  name: string;
  /** Pins a schema version. Absent means "whatever the registry has now". */
  version?: number;
  required?: boolean;
}

/** A registered FeatureBundle, as `GET /api/feature-bundles` returns it. */
export interface FeatureBundleEntry {
  name: string;
  /** Semver of the bundle itself — a string, unlike an event's numeric version. */
  version: string;
  /** sha256 over { name, version, sorted events }. Full 64 hex chars. */
  fingerprint: string;
  transport: 'signal' | 'durable' | 'both';
  events: BundleEventRef[];
  description?: string;
  deprecated?: { since: string; replacement?: string };
}

/** The one place the absent-means-required default is spelled out. */
export function isRequired(ref: BundleEventRef): boolean {
  return ref.required !== false;
}

export interface TopologyGraph {
  nodes: Array<{ id: string; type: 'service' | 'event'; metadata: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; relation: 'publishes' | 'subscribes' }>;
}

export interface ComponentHealth {
  /**
   * What GET /api/health actually reports per component. It is the transport's
   * own vocabulary ('connected'), NOT the service-runtime vocabulary
   * ('healthy') used by the root /health endpoint — this type claimed the
   * latter, so every `status === 'healthy'` comparison in the admin was
   * permanently false and both transports rendered as down on a healthy
   * system.
   */
  status: 'connected' | 'degraded' | 'disconnected' | 'healthy' | 'unhealthy';
  latencyMs?: number;
}

/** Component states that mean "this transport is working". */
export function isTransportUp(status: ComponentHealth['status']): boolean {
  return status === 'connected' || status === 'healthy';
}

/**
 * Chip tone for a component state. Degraded is a warning, not a failure —
 * collapsing it into the danger tone told an operator to page someone for a
 * slow Redis.
 */
export function transportTone(status: ComponentHealth['status']): 'success' | 'warning' | 'danger' {
  if (isTransportUp(status)) return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis: ComponentHealth;
  messageQueue: ComponentHealth;
  uptime: number;
  eventCount: number;
}

// ─── Root /health (service-runtime shape) ────────────────────────────────────

/** The three states `src/server/health.ts` rolls a check up to. */
export type ServiceCheckStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ServiceHealthCheck {
  id: string;
  status: ServiceCheckStatus;
  details?: unknown;
  durationMs: number;
}

export interface ServiceHealthBody {
  service: string;
  version: string;
  status: ServiceCheckStatus;
  checks: ServiceHealthCheck[];
  timestamp: string;
}

/**
 * `coordinator.getStats()`, as the health check embeds it verbatim. Every
 * field optional here: this crosses a version boundary (an older or newer
 * server), and a missing counter must render as "not reported" rather than
 * as a zero an operator would read as "no conflicts".
 */
export interface CoordinatorStats {
  replicaId?: string;
  stale?: boolean;
  resyncs?: number;
  resyncsCoalesced?: number;
  pending?: number;
  pendingBytes?: number;
  peers?: number;
  peersForgotten?: number;
  conflicts?: number;
}

/** What the transports view renders for the replication coordinator. */
export interface CoordinatorHealth {
  status: ServiceCheckStatus;
  stats: CoordinatorStats;
}

/**
 * Pull the coordinator out of a root-`/health` body.
 *
 * Returns `null` — meaning "this deployment did not report it" — rather than
 * inventing a `healthy`, because "we did not ask" and "the replicas agree"
 * are the two answers an operator must never see rendered the same way.
 */
export function coordinatorFromHealth(body: ServiceHealthBody | null): CoordinatorHealth | null {
  if (!body) return null;
  const check = body.checks.find(c => c.id === 'coordinator');
  if (!check) return null;
  const details = (check.details && typeof check.details === 'object')
    ? check.details as CoordinatorStats
    : {};
  return { status: check.status, stats: details };
}

/**
 * The one sentence that says what a coordinator state actually means for the
 * page the operator is reading. `degraded` is not a milder `unhealthy` here —
 * it is a *different failure*: the service is up and answering, and that is
 * precisely the problem, because what it answers may be wrong.
 */
export function coordinatorExplanation(status: ServiceCheckStatus): string {
  switch (status) {
    case 'healthy':
      return 'This replica has applied every registry mutation its peers broadcast.';
    case 'degraded':
      return 'STALE REPLICA — this instance missed at least one registry '
        + 'broadcast and has not resynced. Declarations shown here may be '
        + 'missing or out of date, and they may differ from what another '
        + 'replica serves. Drain this instance rather than restarting it; it '
        + 'repairs itself from shared state.';
    case 'unhealthy':
      return 'The replication coordinator itself failed its health check — '
        + 'this instance is not tracking peer mutations at all.';
  }
}

export interface ChannelInfo {
  channel: string;
  publishCount: number;
  lastPublishedAt: string | null;
  subscriberCount: number;
}

export interface QueueInfo {
  queue: string;
  sent: number;
  received: number;
  failed: number;
  inFlight: number;
}

// API methods
export const api = {
  getEvents(filter?: { transport?: string; producer?: string }) {
    const params = new URLSearchParams();
    if (filter?.transport) params.set('transport', filter.transport);
    if (filter?.producer) params.set('producer', filter.producer);
    const qs = params.toString();
    return request<{ events: EventEntry[]; total: number }>(`/events${qs ? `?${qs}` : ''}`);
  },

  getEvent(name: string) {
    return request<EventEntry>(`/events/${encodeURIComponent(name)}`);
  },

  getEventStats(name: string) {
    return request<EventStats>(`/events/${encodeURIComponent(name)}/stats`);
  },

  getEventHistory(name: string, count = 50) {
    return request<{ messages: unknown[]; transport: string }>(`/events/${encodeURIComponent(name)}/history?count=${count}`);
  },

  declareEvent(event: { name: string; transport: string; producer: string; schema?: Record<string, unknown>; description?: string; tags?: string[] }) {
    return request<{ declared: string }>('/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  deleteEvent(name: string) {
    return request<{ removed: string }>(`/events/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // wave25-a — schema deprecation lifecycle.
  deprecateEvent(name: string, body: { reason?: string; by?: string } = {}) {
    return request<{ deprecated: string; deprecation: { deprecatedAt: string; reason?: string; by?: string } }>(
      `/events/${encodeURIComponent(name)}/deprecate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  },

  undeprecateEvent(name: string) {
    return request<{ undeprecated: string }>(`/events/${encodeURIComponent(name)}/deprecate`, { method: 'DELETE' });
  },

  listDeprecated() {
    return request<{ count: number; items: Array<{ name: string; namespace?: string; transport: string; version: number; deprecation: { deprecatedAt: string; reason?: string; by?: string } }> }>(`/deprecated`);
  },

  // wave25-b — namespace browser.
  getNamespacesSummary(detail: 'summary' | 'full' = 'summary') {
    type Item = {
      namespace: string;
      eventCount: number;
      deprecatedCount: number;
      producerCount: number;
      subscriberCount: number;
      signalCount: number;
      durableCount: number;
      events?: Array<{ name: string; transport: string; version: number; deprecated: boolean }>;
    };
    const qs = detail === 'full' ? '?detail=full' : '';
    return request<{ count: number; items: Item[] }>(`/namespaces/summary${qs}`);
  },

  getTopology(filter?: { namespace?: string; producer?: string; consumer?: string; transport?: string }) {
    const params = new URLSearchParams();
    if (filter?.namespace) params.set('namespace', filter.namespace);
    if (filter?.producer) params.set('producer', filter.producer);
    if (filter?.consumer) params.set('consumer', filter.consumer);
    if (filter?.transport) params.set('transport', filter.transport);
    const qs = params.toString();
    return request<TopologyGraph>(`/topology${qs ? `?${qs}` : ''}`);
  },

  /**
   * `GET /api/health` answers **503** — with a complete, truthful body —
   * exactly when a transport is disconnected (src/server/routes/ops.ts). The
   * generic `request()` treats any non-2xx as a failure and discards the
   * body, so the one moment the health card exists for (Redis or the message
   * queue being down) rendered as "Error loading the dashboard: API 503"
   * instead of "Message Queue (Durable): disconnected" — an operator was told
   * the catalog was unreachable when in fact the catalog was telling them
   * precisely which transport had failed.
   *
   * So: a 503 whose body is a health report is data. A 503 from something
   * that is not the catalog (a proxy's HTML error page, an ingress that never
   * reached us) is still an error — the shape check is what tells them apart,
   * and it is applied only on the 503 path so a 2xx behaves exactly as every
   * other endpoint does.
   */
  async getHealth(): Promise<HealthStatus> {
    const res = await fetch(`${BASE}/health`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const raw = await res.text().catch(() => '');
    noteResponseStatus(res.status);
    if (res.ok) {
      return JSON.parse(raw) as HealthStatus;
    }
    if (res.status === 503) {
      try {
        const body = JSON.parse(raw) as HealthStatus;
        if (body && typeof body === 'object' && body.redis && body.messageQueue) {
          return body;
        }
      } catch {
        // Not JSON — fall through to the throw below.
      }
    }
    throw new ApiError(res.status, raw);
  },

  /**
   * The **root** `/health`, not `/api/health` — a different endpoint with a
   * different shape and a different job. `/api/health` reports the two
   * transports; this one runs the service-runtime check list, and the
   * `coordinator` check in it is the only place the registry replication
   * state is exposed (`src/server/index.ts`, `coordinator.isStale()`).
   *
   * Why the admin needs it: a replica that missed a mutation broadcast
   * answers every read from a registry that disagrees with its peers about
   * what the contracts are, while Redis and the message queue both report
   * `connected`. Nothing else on this surface can tell an operator that the
   * page they are looking at is not the truth.
   *
   * Tolerant on three axes, because none of them mean "hide the card":
   *   * A 503 body is a health report — an unhealthy check is exactly the
   *     state worth rendering, so parse it rather than throwing it away
   *     (same reasoning as `getHealth` above).
   *   * A 404 means this deployment does not expose the root route (behind a
   *     proxy that only forwards `/api`). Resolves to `null`, and the card
   *     says "not reported" rather than "broken".
   *   * A missing `coordinator` check means an older server. Also `null`.
   */
  async getServiceHealth(): Promise<ServiceHealthBody | null> {
    const res = await fetch('/health', { headers: { Accept: 'application/json' } });
    const raw = await res.text().catch(() => '');
    noteResponseStatus(res.status);
    if (!res.ok && res.status !== 503) return null;
    try {
      const body = JSON.parse(raw) as ServiceHealthBody;
      if (body && typeof body === 'object' && Array.isArray(body.checks)) return body;
    } catch {
      // A proxy's HTML error page, not the catalog. Nothing to render.
    }
    return null;
  },

  /** wave26-b — richer registry health for the Dashboard health card. */
  getRegistryHealth() {
    type RegistryHealth = {
      registrySize: number;
      namespaceCount: number;
      deprecatedCount: number;
      orphanCount: number;
      manifestCount: number | null;
      signal: ComponentHealth;
      durable: ComponentHealth;
      capturedAt: string;
    };
    return request<RegistryHealth>('/health/registry');
  },

  /** Phase E7 — simple namespace list. */
  getNamespaces() {
    return request<{ count: number; items: Array<{ namespace: string; eventCount: number }> }>('/namespaces');
  },

  /** wave26-a — per-event publish rate history (last 60 samples). */
  getMetricsHistory(eventName?: string) {
    const qs = eventName ? `?eventName=${encodeURIComponent(eventName)}` : '';
    return request<Record<string, number[]>>(`/metrics/history${qs}`);
  },

  getMetrics() {
    return request<Record<string, EventStats>>('/metrics');
  },

  /** Raw Prometheus-format metrics from the root /metrics endpoint. */
  getPromMetrics() {
    return requestText('/metrics');
  },

  getSignalChannels() {
    return request<{ channels: ChannelInfo[]; total: number }>('/transports/signal/channels');
  },

  getDurableQueues() {
    return request<{ queues: QueueInfo[]; total: number }>('/transports/durable/queues');
  },

  getDLQ(eventName?: string, limit = 100) {
    const params = new URLSearchParams();
    if (eventName) params.set('eventName', eventName);
    params.set('limit', String(limit));
    return request<{ messages: DLQEntry[]; total: number; source?: string }>(`/transports/durable/dlq?${params.toString()}`);
  },

  replayDLQ(id: string) {
    return request<{ replayed: string; eventName: string }>(`/transports/durable/dlq/${encodeURIComponent(id)}/replay`, { method: 'POST' });
  },

  /** Phase E5.2 — redrive N DLQ entries in one call. Returns per-id outcomes. */
  batchReplayDLQ(ids: string[]) {
    return request<{
      replayed: Array<{ id: string; eventName: string }>;
      failed: Array<{ id: string; error: string }>;
      total: number;
    }>('/transports/durable/dlq/replay', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  deleteDLQ(id: string) {
    return request<{ removed: string }>(`/transports/durable/dlq/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Bulk-clear all DLQ entries, or all entries for one event when eventName is provided. */
  clearDLQ(eventName?: string) {
    const params = new URLSearchParams();
    if (eventName) params.set('eventName', eventName);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ cleared: number }>(`/transports/durable/dlq/clear${qs}`, { method: 'POST' });
  },

  /** wave26-f — bulk deprecate N events with a shared reason. */
  bulkDeprecate(names: string[], opts: { reason?: string; by?: string } = {}) {
    return request<{ deprecated: string[]; notFound: string[]; total: number }>(
      '/events/bulk/deprecate',
      { method: 'POST', body: JSON.stringify({ names, ...opts }) },
    );
  },

  /** wave26-f — returns the URL for a bulk JSON export (use as href or fetch). */
  bulkExportUrl(names: string[]): string {
    const qs = names.length > 0 ? `?names=${names.map(encodeURIComponent).join(',')}` : '';
    return `${BASE}/events/bulk/export${qs}`;
  },

  /** wave26-e — list all events that exceeded the failure threshold. */
  getPoisonedEvents() {
    return request<{
      count: number;
      items: Array<{
        eventName: string;
        failuresInWindow: number;
        poisonedAt: string;
        threshold: number;
        windowMs: number;
      }>;
    }>('/events/poisoned');
  },

  /** wave26-e — clear (dismiss) poison state for one event. */
  clearPoison(eventName: string) {
    return request<{ cleared: string; wasPoison: boolean }>(
      `/events/${encodeURIComponent(eventName)}/poison`,
      { method: 'DELETE' },
    );
  },

  /** wave26-c — observed vs declared producer attribution for an event. */
  getObservedProducers(eventName: string) {
    return request<{
      eventName: string;
      declared: string[];
      observed: string[];
      undeclaredProducers: string[];
      deadDeclaredProducers: string[];
      mismatch: boolean;
    }>(`/events/${encodeURIComponent(eventName)}/producers/observed`);
  },

  /**
   * Every registered FeatureBundle, all versions, sorted name then version
   * (`src/server/bundle-routes.ts` GET /). This is the only endpoint that
   * returns bundle *membership*, so it is also what the coverage view diffs
   * against `GET /api/events`.
   */
  getFeatureBundles() {
    return request<{ bundles: FeatureBundleEntry[]; total: number }>('/feature-bundles');
  },

  /**
   * One bundle. With no version the server answers the highest semver it
   * holds for that name; with one, that exact version (404 if absent) — which
   * matters because a deprecated version and its replacement can both be
   * registered under different names, and an operator arriving from a CRD pin
   * needs the version they pinned, not the newest.
   */
  getFeatureBundle(name: string, version?: string) {
    const path = version
      ? `/feature-bundles/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
      : `/feature-bundles/${encodeURIComponent(name)}`;
    return request<FeatureBundleEntry>(path);
  },

  /** wave24-b — list subscribers with their lastSeenAt timestamps. */
  getSubscribers(staleAfterSeconds?: number) {
    const qs = staleAfterSeconds && staleAfterSeconds > 0 ? `?staleAfter=${staleAfterSeconds}` : '';
    return request<{
      subscribers: Array<{ eventName: string; serviceName: string; lastSeenAt: string }>;
      total: number;
      filter?: { staleAfter: number };
    }>(`/subscribers${qs}`);
  },
};

export interface DLQEntry {
  id: string;
  eventName: string;
  payload: unknown;
  error: string;
  attempts: number;
  deadAt: string | number;
}

/**
 * Exchange the catalog token for an httpOnly session cookie (`POST
 * /admin/login`). The token is sent once and not kept: nothing here stores it,
 * and the browser never gets to read the cookie that replaces it.
 */
export async function signIn(token: string): Promise<boolean> {
  const res = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** End the session (`POST /admin/logout`). */
export async function signOut(): Promise<void> {
  await fetch('/admin/logout', { method: 'POST' });
}
