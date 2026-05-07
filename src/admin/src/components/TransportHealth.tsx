import { useEffect, useState } from 'react';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import { Button } from '@ui/components/ui/Button';
import { api, type HealthStatus, type ChannelInfo, type QueueInfo } from '../api';

export function TransportHealth() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
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
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;
  if (!health) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard height={120} />
        <SkeletonCard height={120} />
      </div>
    );
  }

  return (
    <div className="transport-health">
      <div className="page-header">
        <h2>Transport Health</h2>
        <Button variant="ghost" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      <div className="health-overview">
        <div className={`transport-card ${health.redis === 'connected' ? 'healthy' : 'unhealthy'}`}>
          <div className="transport-icon">
            <span className={`status-dot large ${health.redis === 'connected' ? 'green' : 'red'}`} />
          </div>
          <div className="transport-info">
            <h3>Redis (Signal Transport)</h3>
            <p>Status: <Chip tone={health.redis === 'connected' ? 'success' : 'danger'} size="xs">{health.redis}</Chip></p>
            <p>Active channels: {channels.length}</p>
            <p>Total publishes: {channels.reduce((s, c) => s + c.publishCount, 0).toLocaleString()}</p>
          </div>
        </div>

        <div className={`transport-card ${health.messageQueue === 'connected' ? 'healthy' : 'unhealthy'}`}>
          <div className="transport-icon">
            <span className={`status-dot large ${health.messageQueue === 'connected' ? 'green' : 'red'}`} />
          </div>
          <div className="transport-info">
            <h3>Message Queue (Durable Transport)</h3>
            <p>Status: <Chip tone={health.messageQueue === 'connected' ? 'success' : 'danger'} size="xs">{health.messageQueue}</Chip></p>
            <p>Active queues: {queues.length}</p>
            <p>Total sent: {queues.reduce((s, q) => s + q.sent, 0).toLocaleString()}</p>
            <p>In flight: {queues.reduce((s, q) => s + q.inFlight, 0)}</p>
          </div>
        </div>
      </div>

      <section className="transport-section">
        <h3>Signal Channels (Redis Pub/Sub)</h3>
        {channels.length === 0 ? (
          <EmptyState icon="📡" title="No active signal channels" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Publishes</th>
                <th>Subscribers</th>
                <th>Last Activity</th>
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

      <section className="transport-section">
        <h3>Durable Queues (Message Queue)</h3>
        {queues.length === 0 ? (
          <EmptyState icon="📬" title="No active durable queues" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Sent</th>
                <th>Received</th>
                <th>In Flight</th>
                <th>Failed</th>
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

      <section className="transport-section">
        <h3>System</h3>
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
