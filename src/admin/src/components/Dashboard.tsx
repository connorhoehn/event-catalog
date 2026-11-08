import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Banner,
  Button,
  Chip,
  DashboardPage,
  DataTable,
  ErrorState,
  Inline,
  KPIGrid,
  LiveRegion,
  PageSection,
  SkeletonCard,
  Stack,
  StatCard,
  Text,
} from '@connorhoehn/ui-components/shared';
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
      <DashboardPage
        title="Dashboard"
        kpis={
          <Stack gap="md" aria-busy="true">
            <KPIGrid columns={3}>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} height={90} />
              ))}
            </KPIGrid>
            <LiveRegion role="none" message="Loading dashboard…" />
          </Stack>
        }
      />
    );
  }
  if (error) {
    return (
      <DashboardPage title="Dashboard">
        <ErrorState
          title="Error loading the dashboard"
          description={`The catalog API did not answer: ${error}`}
          action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
        />
      </DashboardPage>
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

  const deprecatedRows = deprecated
    .slice()
    .sort((a, b) => (b.deprecation?.deprecatedAt ?? '').localeCompare(a.deprecation?.deprecatedAt ?? ''))
    .slice(0, 10);
  const recentRows = events
    .filter(e => e.stats?.lastPublishedAt)
    .sort((a, b) => (b.stats?.lastPublishedAt ?? '').localeCompare(a.stats?.lastPublishedAt ?? ''))
    .slice(0, 10);

  return (
    <DashboardPage
      title="Dashboard"
      kpis={
        <Stack gap="md">
          <KPIGrid columns={3}>
            <StatCard label="Registered Events" value={events.length} />
            <StatCard label="Signal (Ephemeral)" value={signalEvents.length} accent />
            <StatCard label="Durable (At-Least-Once)" value={durableEvents.length} />
            <StatCard label="Services" value={producers.length} />
            <StatCard label="Total Publishes" value={totalPublishes.toLocaleString()} />
            <StatCard label="Errors" value={totalErrors} danger={totalErrors > 0} />
          </KPIGrid>

          {/* wave25-d — lifecycle rollups. Only render when there's anything to
             flag, so a healthy catalog doesn't get a row of zero-value cards. */}
          {(deprecated.length > 0 || orphans.length > 0 || neverPublished.length > 0) && (
            <KPIGrid columns={3}>
              {deprecated.length > 0 && (
                <StatCard
                  to="/events"
                  as={Link}
                  danger
                  label={`Deprecated${deprecatedActive.length > 0 ? ` (${deprecatedActive.length} still active)` : ''}`}
                  value={deprecated.length}
                />
              )}
              {orphans.length > 0 && (
                <StatCard label="Orphans (no subscribers)" value={orphans.length} danger />
              )}
              {neverPublished.length > 0 && (
                <StatCard label="Never published" value={neverPublished.length} />
              )}
            </KPIGrid>
          )}

          {/* wave26-e — poisoned events alert. Only render when events are actively poisoned. */}
          {poisonedEvents.length > 0 && (
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
          )}
        </Stack>
      }
    >
      {health && (
        <PageSection title="Transport Status" size="sm">
          <Stack gap="sm">
            <Inline gap="sm" align="center" className="status-row">
              <span aria-hidden="true" className={`status-dot ${isTransportUp(health.redis.status) ? 'green' : 'red'}`} />
              <Text size="sm">Redis (Signal): </Text>
              <Chip tone={transportTone(health.redis.status)} size="xs">
                {health.redis.status}
              </Chip>
            </Inline>
            <Inline gap="sm" align="center" className="status-row">
              <span aria-hidden="true" className={`status-dot ${isTransportUp(health.messageQueue.status) ? 'green' : 'red'}`} />
              <Text size="sm">Message Queue (Durable): </Text>
              <Chip tone={transportTone(health.messageQueue.status)} size="xs">
                {health.messageQueue.status}
              </Chip>
            </Inline>
            <Text size="sm">Uptime: {formatUptime(health.uptime)}</Text>
          </Stack>
        </PageSection>
      )}

      {/* wave26-b — registry health summary card */}
      {registryHealth && (
        <PageSection title="Registry Health" size="sm" className="md:col-span-2">
          <KPIGrid columns={registryHealth.manifestCount !== null ? 3 : 4} dense>
            <StatCard size="sm" label="Registry Size" value={registryHealth.registrySize} />
            <StatCard size="sm" label="Namespaces" value={registryHealth.namespaceCount} />
            <StatCard size="sm" label="Deprecated" value={registryHealth.deprecatedCount} />
            <StatCard size="sm" label="Orphans" value={registryHealth.orphanCount} />
            {registryHealth.manifestCount !== null && (
              <StatCard size="sm" label="Pinned Manifests" value={registryHealth.manifestCount} />
            )}
          </KPIGrid>
        </PageSection>
      )}

      {deprecated.length > 0 && (
        <PageSection title="Deprecated Events" size="sm" className="md:col-span-2 lg:col-span-3">
          <DataTable
            data={deprecatedRows}
            keyField={e => e.name}
            staticRows="Each row's event name links to its detail page"
            size="sm"
            columns={[
              {
                key: 'event',
                header: 'Event',
                render: e => (
                  <>
                    <Link to={`/events/${encodeURIComponent(e.name)}`}>{e.name}</Link>{' '}
                    <Chip tone="danger" size="xs">deprecated</Chip>
                  </>
                ),
              },
              { key: 'reason', header: 'Reason', render: e => e.deprecation?.reason ?? '—' },
              { key: 'subscribers', header: 'Subscribers', numeric: true, render: e => e.subscribers.length },
              {
                key: 'deprecated',
                header: 'Deprecated',
                render: e => (e.deprecation?.deprecatedAt ? timeAgo(e.deprecation.deprecatedAt) : '—'),
              },
            ]}
          />
        </PageSection>
      )}

      <PageSection title="Recently Active Events" size="sm" className="md:col-span-2 lg:col-span-3">
        <DataTable
          data={recentRows}
          keyField={e => e.name}
          staticRows="Each row's event name links to its detail page"
          size="sm"
          emptyMessage="No events published yet."
          columns={[
            { key: 'event', header: 'Event', render: e => <Link to={`/events/${encodeURIComponent(e.name)}`}>{e.name}</Link> },
            {
              key: 'transport',
              header: 'Transport',
              render: e => (
                <Chip tone={e.transport === 'signal' ? 'info' : 'warning'} size="xs">
                  {e.transport}
                </Chip>
              ),
            },
            { key: 'producer', header: 'Producer' },
            { key: 'rate', header: 'Rate', numeric: true, render: e => (e.stats ? `${e.stats.publishRate.toFixed(1)}/s` : '—') },
            { key: 'lastSeen', header: 'Last Seen', render: e => (e.stats?.lastPublishedAt ? timeAgo(e.stats.lastPublishedAt) : '—') },
          ]}
        />
      </PageSection>
    </DashboardPage>
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
