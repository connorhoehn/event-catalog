import { useEffect, useState, useCallback } from 'react';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
import { api, type DLQEntry } from '../api';

export function DLQBrowser() {
  const [entries, setEntries] = useState<DLQEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>(undefined);

  const load = useCallback(() => {
    setLoading(true);
    api.getDLQ(filter || undefined)
      .then(res => {
        setEntries(res.messages);
        setSource(res.source);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const replay = async (id: string) => {
    setBusyId(id);
    try {
      await api.replayDLQ(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api.deleteDLQ(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="dlq-browser">
      <div className="page-header">
        <h2>Dead-Letter Queue</h2>
        <Chip tone="neutral">{entries.length} entries</Chip>
        {source === 'in-memory' && <Chip tone="warning">in-memory fallback</Chip>}
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="Filter by event name..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <Banner variant="error">{error}</Banner>}

      {!loading && entries.length === 0 && (
        <EmptyState
          icon="OK"
          title="No dead-lettered messages"
          body={filter ? `No DLQ entries for "${filter}".` : 'All durable events delivered successfully.'}
        />
      )}

      {entries.length > 0 && (
        <table className="dlq-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Attempts</th>
              <th>Dead At</th>
              <th>Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id}>
                <td className="mono">{entry.eventName}</td>
                <td className="mono">{entry.attempts}</td>
                <td>{typeof entry.deadAt === 'string' ? entry.deadAt : new Date(entry.deadAt).toISOString()}</td>
                <td className="error-text">{entry.error}</td>
                <td>
                  <button onClick={() => replay(entry.id)} disabled={busyId === entry.id}>
                    Replay
                  </button>
                  <button onClick={() => remove(entry.id)} disabled={busyId === entry.id}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
