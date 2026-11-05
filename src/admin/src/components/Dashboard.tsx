import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Chip, Banner, ErrorState, SkeletonCard, LiveRegion, Button } from '@connorhoehnslalom/ui-components/shared';
import { api, isTransportUp, transportTone, type EventEntry, type HealthStatus } from '../api';

type RegistryHealth = Awaited<ReturnType<typeof api.getRegistryHealth>>;
type PoisonItem = Awaited<ReturnType<typeof api.getPoisonedEvents>>['items'][number];

export function Dashboard() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [registryHealth, setRegistryHealth] = useState<RegistryHealth | null>(null);
  const [poisonedEvents, setPoisonedEvents] = useState<PoisonItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getEvents(),
      api.getHealth(),
      api.getRegistryHealth().catch(() => null),
      api.getPoisonedEvents().catch(() => ({ count: 0, items: [] })),
    ]).then(([eventsRes, healthRes, regHealth, poisonRes]) => {
      setEvents(eventsRes.events);
      setHealth(healthRes);
      setRegistryHealth(regHealth);
      setPoisonedEvents(poisonRes.items);
      setError(null);
    }).catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Loading / failed / loaded are three states, and the heading belongs to all
  // three: bailing out to a bare banner used to take the <h2> with it, so a
  // failed dashboard had no landmark heading to orient a screen reader.
  if (loading) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <div className="stats-grid" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} height={90} />
          ))}
        </div>
        <LiveRegion role="none" message="Loading dashboard…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <ErrorState
          title="Error loading the dashboard"
          description={`The catalog API did not answer: ${error}`}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      </div>
    );
  }

  const signalEvents = events.filter(e => e.transport === 'signal');
  const durableEvents = events.filter(e => e.transport === 'durable');
  const totalPublishes = events.reduce((sum, e) => sum + (e.stats?.publishCount ?? 0), 0);
  const totalErrors = events.reduce((sum, e) => sum + (e.stats?.errorCount ?? 0), 0);
  const producers = [...new Set(events.map(e => e.producer))];

  // wave25-d — lifecycle rollups derived from the same /events payload.
  const deprecated = events.filter(e => !!e.deprecation);
  const orphans = events.filter(e => e.subscribers.length === 0);
  const neverPublished = events.filter(e => !e.metadata?.lastPublishedAt);
  const deprecatedActive = deprecated.filter(e => e.subscribers.length > 0 || e.stats?.publishCount);

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{events.length}</div>
          <div className="stat-label">Registered Events</div>
        </div>
        <div className="stat-card signal">
          <div className="stat-value">{signalEvents.length}</div>
          <div className="stat-label">Signal (Ephemeral)</div>
        </div>
        <div className="stat-card durable">
          <div className="stat-value">{durableEvents.length}</div>
          <div className="stat-label">Durable (At-Least-Once)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{producers.length}</div>
          <div className="stat-label">Services</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalPublishes.toLocaleString()}</div>
          <div className="stat-label">Total Publishes</div>
        </div>
        <div className="stat-card error">
          <div className="stat-value">{totalErrors}</div>
          <div className="stat-label">Errors</div>
        </div>
      </div>

      {/* wave25-d — lifecycle rollups. Only render when there's anything to
         flag, so a healthy catalog doesn't get a row of zero-value cards. */}
      {(deprecated.length > 0 || orphans.length > 0 || neverPublished.length > 0) && (
        <div className="stats-grid secondary">
          {deprecated.length > 0 && (
            <Link to="/events" className="stat-card deprecated">
              <div className="stat-value">{deprecated.length}</div>
              <div className="stat-label">Deprecated{deprecatedActive.length > 0 ? ` (${deprecatedActive.length} still active)` : ''}</div>
            </Link>
          )}
          {orphans.length > 0 && (
            <div className="stat-card orphans">
              <div className="stat-value">{orphans.length}</div>
              <div className="stat-label">Orphans (no subscribers)</div>
            </div>
          )}
          {neverPublished.length > 0 && (
            <div className="stat-card never-published">
              <div className="stat-value">{neverPublished.length}</div>
              <div className="stat-label">Never published</div>
            </div>
          )}
        </div>
      )}

      {/* wave26-e — poisoned events alert. Only render when events are actively poisoned. */}
      {poisonedEvents.length > 0 && (
        <div className="poison-alert">
          <Banner variant="error" title={`${poisonedEvents.length} Poisoned Event${poisonedEvents.length > 1 ? 's' : ''} — Failures Exceeding Threshold`}>
            <ul className="poison-list">
              {poisonedEvents.map(p => (
                <li key={p.eventName}>
                  <Link to={`/events/${encodeURIComponent(p.eventName)}`}>{p.eventName}</Link>
                  {' — '}{p.failuresInWindow} failures in {Math.round(p.windowMs / 60000)}m
                  {' (threshold: '}{p.threshold}{')'}
                  <Button
                    variant="danger"
                    size="sm"
                    className="btn-dismiss"
                    aria-label={`Dismiss poison alert for ${p.eventName}`}
                    onClick={() => {
                      api.clearPoison(p.eventName).then(() => {
                        setPoisonedEvents(prev => prev.filter(x => x.eventName !== p.eventName));
                      }).catch(() => {});
                    }}
                  >
                    dismiss
                  </Button>
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {health && (
        <section className="transport-status" aria-labelledby="dash-transport-status">
          <h3 id="dash-transport-status">Transport Status</h3>
          <div className="status-row">
            <span aria-hidden="true" className={`status-dot ${isTransportUp(health.redis.status) ? 'green' : 'red'}`} />
            <span>Redis (Signal): </span>
            <Chip tone={transportTone(health.redis.status)} size="xs">
              {health.redis.status}
            </Chip>
          </div>
          <div className="status-row">
            <span aria-hidden="true" className={`status-dot ${isTransportUp(health.messageQueue.status) ? 'green' : 'red'}`} />
            <span>Message Queue (Durable): </span>
            <Chip tone={transportTone(health.messageQueue.status)} size="xs">
              {health.messageQueue.status}
            </Chip>
          </div>
          <div className="status-row">
            <span>Uptime: {formatUptime(health.uptime)}</span>
          </div>
        </section>
      )}

      {/* wave26-b — registry health summary card */}
      {registryHealth && (
        <section className="transport-status registry-health" aria-labelledby="dash-registry-health">
          <h3 id="dash-registry-health">Registry Health</h3>
          <div className="stats-grid nested">
            <div className="stat-card">
              <div className="stat-value">{registryHealth.registrySize}</div>
              <div className="stat-label">Registry Size</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{registryHealth.namespaceCount}</div>
              <div className="stat-label">Namespaces</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{registryHealth.deprecatedCount}</div>
              <div className="stat-label">Deprecated</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{registryHealth.orphanCount}</div>
              <div className="stat-label">Orphans</div>
            </div>
            {registryHealth.manifestCount !== null && (
              <div className="stat-card">
                <div className="stat-value">{registryHealth.manifestCount}</div>
                <div className="stat-label">Pinned Manifests</div>
              </div>
            )}
          </div>
        </section>
      )}

      {deprecated.length > 0 && (
        <section className="recent-events deprecated-events" aria-labelledby="dash-deprecated">
          <h3 id="dash-deprecated">Deprecated Events</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Reason</th>
                <th scope="col">Subscribers</th>
                <th scope="col">Deprecated</th>
              </tr>
            </thead>
            <tbody>
              {deprecated
                .slice()
                .sort((a, b) => (b.deprecation?.deprecatedAt ?? '').localeCompare(a.deprecation?.deprecatedAt ?? ''))
                .slice(0, 10)
                .map(e => (
                  <tr key={e.name}>
                    <td>
                      <Link to={`/events/${encodeURIComponent(e.name)}`}>{e.name}</Link>{' '}
                      <Chip tone="danger" size="xs">deprecated</Chip>
                    </td>
                    <td className="reason">{e.deprecation?.reason ?? '—'}</td>
                    <td>{e.subscribers.length}</td>
                    <td>{e.deprecation?.deprecatedAt ? timeAgo(e.deprecation.deprecatedAt) : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="recent-events" aria-labelledby="dash-recent">
        <h3 id="dash-recent">Recently Active Events</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Transport</th>
              <th scope="col">Producer</th>
              <th scope="col">Rate</th>
              <th scope="col">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {events
              .filter(e => e.stats?.lastPublishedAt)
              .sort((a, b) => (b.stats?.lastPublishedAt ?? '').localeCompare(a.stats?.lastPublishedAt ?? ''))
              .slice(0, 10)
              .map(e => (
                <tr key={e.name}>
                  <td><Link to={`/events/${encodeURIComponent(e.name)}`}>{e.name}</Link></td>
                  <td>
                    <Chip tone={e.transport === 'signal' ? 'info' : 'warning'} size="xs">
                      {e.transport}
                    </Chip>
                  </td>
                  <td>{e.producer}</td>
                  <td className="mono">{e.stats ? `${e.stats.publishRate.toFixed(1)}/s` : '—'}</td>
                  <td>{e.stats?.lastPublishedAt ? timeAgo(e.stats.lastPublishedAt) : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
