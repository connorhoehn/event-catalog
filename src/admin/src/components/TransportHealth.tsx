import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Chip, EmptyState, ErrorState, SkeletonCard, LiveRegion, Button } from '@connorhoehnslalom/ui-components/shared';
import {
  api,
  coordinatorExplanation,
  coordinatorFromHealth,
  isTransportUp,
  transportTone,
  type ChannelInfo,
  type CoordinatorHealth,
  type HealthStatus,
  type QueueInfo,
  type ServiceCheckStatus,
} from '../api';

export function TransportHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [coordinator, setCoordinator] = useState<CoordinatorHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    // The coordinator read is deliberately outside the Promise.all: it hits a
    // different endpoint (root /health) that a proxy may not forward at all,
    // and a deployment without it must still get its transports. `catch`
    // rather than `reject` for the same reason — "not reported" is a state the
    // card renders, not a page-level failure.
    api.getServiceHealth()
      .then(body => setCoordinator(coordinatorFromHealth(body)))
      .catch(() => setCoordinator(null));
    Promise.all([
      api.getHealth(),
      api.getSignalChannels(),
      api.getDurableQueues(),
    ]).then(([h, c, q]) => {
      setHealth(h);
      setChannels(c.channels);
      setQueues(q.queues);
      setError(null);
    }).catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // A transient 500 on one of the five-second polls used to blank the entire
  // page, heading included, until a later poll happened to succeed. Keep the
  // last good reading on screen and put the failure next to the Refresh
  // button instead.
  if (!health) {
    if (error) {
      return (
        <div className="transport-health">
          <div className="page-header">
            <h2>Transport Health</h2>
          </div>
          <ErrorState
            title="Error loading transport health"
            description={error}
            action={<Button variant="secondary" size="sm" onClick={refresh}>Retry</Button>}
          />
        </div>
      );
    }
    return (
      <div className="skeleton-stack" aria-busy="true">
        <SkeletonCard height={120} />
        <SkeletonCard height={120} />
        <LiveRegion role="none" message="Loading transport health…" />
      </div>
    );
  }

  // Announced only when the *wording* changes, so a healthy system that polls
  // every five seconds says nothing at all; a transport going down speaks
  // once. Polite, not assertive: a screen-reader user mid-sentence elsewhere
  // on the page should finish that sentence first.
  const healthSummary =
    `Transports: signal ${health.redis.status}, durable ${health.messageQueue.status}.`;

  // A second region rather than a longer first one. The coordinator changes
  // on its own schedule (a replica goes stale and resyncs while both
  // transports sit at "connected" throughout), and folding it into the
  // sentence above would either re-announce the transports every time the
  // replication state moved, or throttle the replication state behind them.
  const replicationSummary = coordinator
    ? `Registry replication: ${coordinator.status}.`
    : 'Registry replication: not reported.';

  return (
    <div className="transport-health">
      <div className="page-header">
        <h2>Transport Health</h2>
        <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      <LiveRegion message={healthSummary} throttleMs={5_000} />
      <LiveRegion message={replicationSummary} throttleMs={5_000} />
      {error && (
        <p className="stale-notice">
          Showing the last successful reading — the most recent refresh failed ({error}).
        </p>
      )}

      {/* Above the transports, not beside them. A stale replica outranks a
          slow Redis: the transports being fine is what makes it invisible
          everywhere else in this UI. */}
      <CoordinatorCard coordinator={coordinator} />

      <div className="health-overview">
        <div className={`transport-card ${isTransportUp(health.redis.status) ? 'healthy' : 'unhealthy'}`}>
          <div className="transport-icon" aria-hidden="true">
            <span className={`status-dot large ${isTransportUp(health.redis.status) ? 'green' : 'red'}`} />
          </div>
          <div className="transport-info">
            <h3>Redis (Signal Transport)</h3>
            <p>Status: <Chip tone={transportTone(health.redis.status)} size="xs">{health.redis.status}</Chip>{health.redis.latencyMs != null && <> · {health.redis.latencyMs}ms</>}</p>
            <p>Active channels: {channels.length}</p>
            <p>Total publishes: {channels.reduce((s, c) => s + c.publishCount, 0).toLocaleString()}</p>
          </div>
        </div>

        <div className={`transport-card ${isTransportUp(health.messageQueue.status) ? 'healthy' : 'unhealthy'}`}>
          <div className="transport-icon" aria-hidden="true">
            <span className={`status-dot large ${isTransportUp(health.messageQueue.status) ? 'green' : 'red'}`} />
          </div>
          <div className="transport-info">
            <h3>Message Queue (Durable Transport)</h3>
            <p>Status: <Chip tone={transportTone(health.messageQueue.status)} size="xs">{health.messageQueue.status}</Chip>{health.messageQueue.latencyMs != null && <> · {health.messageQueue.latencyMs}ms</>}</p>
            <p>Active queues: {queues.length}</p>
            <p>Total sent: {queues.reduce((s, q) => s + q.sent, 0).toLocaleString()}</p>
            <p>In flight: {queues.reduce((s, q) => s + q.inFlight, 0)}</p>
          </div>
        </div>
      </div>

      <section className="transport-section" aria-labelledby="th-signal">
        <h3 id="th-signal">Signal Channels (Redis Pub/Sub)</h3>
        {channels.length === 0 ? (
          <EmptyState icon="📡" title="No active signal channels" />
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col">Publishes</th>
                <th scope="col">Subscribers</th>
                <th scope="col">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.channel}>
                  <td className="mono">{ch.channel}</td>
                  <td>{ch.publishCount.toLocaleString()}</td>
                  <td>{ch.subscriberCount}</td>
                  <td>{ch.lastPublishedAt ? timeAgo(ch.lastPublishedAt) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="transport-section" aria-labelledby="th-durable">
        <h3 id="th-durable">Durable Queues (Message Queue)</h3>
        {queues.length === 0 ? (
          <EmptyState icon="📬" title="No active durable queues" />
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Queue</th>
                <th scope="col">Sent</th>
                <th scope="col">Received</th>
                <th scope="col">In Flight</th>
                <th scope="col">Failed</th>
              </tr>
            </thead>
            <tbody>
              {queues.map(q => (
                <tr key={q.queue} className={q.failed > 0 ? 'has-errors' : ''}>
                  <td className="mono">{q.queue}</td>
                  <td>{q.sent.toLocaleString()}</td>
                  <td>{q.received.toLocaleString()}</td>
                  <td>{q.inFlight}</td>
                  <td className={q.failed > 0 ? 'text-error' : ''}>{q.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="transport-section" aria-labelledby="th-system">
        <h3 id="th-system">System</h3>
        <dl className="info-list">
          <dt>Uptime</dt>
          <dd>{formatUptime(health.uptime)}</dd>
          <dt>Registered Events</dt>
          <dd>{health.eventCount}</dd>
        </dl>
      </section>
    </div>
  );
}

/**
 * Non-colour cues for a coordinator state, in the same discipline the
 * deprecated bundle rows use: the state is spelled out in words, the card
 * carries a left rule that differs in *style* (not just hue), and the dot
 * differs in *shape*. Any one of the three survives a greyscale screenshot
 * on its own.
 *
 * `degraded` and `unhealthy` are deliberately not neighbours on a severity
 * ramp here — dashed/triangle versus solid/square — because they mean
 * different things to the operator: one says "what you are reading may be
 * wrong", the other says "replication is not running".
 */
const COORDINATOR_CUES: Record<ServiceCheckStatus, { glyph: string; word: string; tone: 'success' | 'warning' | 'danger' }> = {
  healthy: { glyph: '●', word: 'in sync', tone: 'success' },
  degraded: { glyph: '▲', word: 'stale replica', tone: 'warning' },
  unhealthy: { glyph: '■', word: 'replication down', tone: 'danger' },
};

/** One stat, rendered only when the server actually reported it. */
function statLine(label: string, value: number | undefined): ReactElement | null {
  if (typeof value !== 'number') return null;
  return <p key={label}>{label}: {value.toLocaleString()}</p>;
}

function CoordinatorCard({ coordinator }: { coordinator: CoordinatorHealth | null }) {
  // "We did not ask" is not "the replicas agree". A deployment behind a proxy
  // that forwards only /api, or an older server, gets told exactly that
  // rather than a reassuring green card it has not earned.
  if (!coordinator) {
    return (
      <div className="transport-card coordinator-card unknown">
        <div className="transport-icon" aria-hidden="true">
          <span className="status-dot large coordinator-dot unknown">?</span>
        </div>
        <div className="transport-info">
          <h3>Registry Coordinator (Replication)</h3>
          <p>
            Status: <Chip tone="neutral" size="xs">not reported</Chip>
          </p>
          <p className="coordinator-explanation">
            This deployment did not report a replication state — the root
            <code> /health</code> endpoint is unreachable from the browser, or
            the server predates the coordinator check. Whether this instance
            agrees with its peers about the registry is unknown.
          </p>
        </div>
      </div>
    );
  }

  const { status, stats } = coordinator;
  const cue = COORDINATOR_CUES[status];
  return (
    <div className={`transport-card coordinator-card ${status}`}>
      <div className="transport-icon" aria-hidden="true">
        <span className={`status-dot large coordinator-dot ${status}`}>{cue.glyph}</span>
      </div>
      <div className="transport-info">
        <h3>Registry Coordinator (Replication)</h3>
        <p>
          Status: <Chip tone={cue.tone} size="xs">{status}</Chip>{' '}
          <span className="coordinator-word">{cue.word}</span>
        </p>
        <p className="coordinator-explanation">{coordinatorExplanation(status)}</p>
        <div className="coordinator-stats">
          {stats.replicaId && <p>Replica: <span className="mono">{stats.replicaId.slice(0, 12)}</span></p>}
          {statLine('Peers tracked', stats.peers)}
          {statLine('Resyncs', stats.resyncs)}
          {statLine('Pending mutations', stats.pending)}
          {statLine('Replication conflicts', stats.conflicts)}
        </div>
      </div>
    </div>
  );
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

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
