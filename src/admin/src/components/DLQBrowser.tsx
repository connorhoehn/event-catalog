import { useEffect, useState, useCallback } from 'react';
import Chip from '@ui/components/shared/Chip';
import Banner from '@ui/components/shared/Banner';
import EmptyState from '@ui/components/shared/EmptyState';
import { Button } from '@ui/components/ui/Button';
import { api, type DLQEntry } from '../api';

export function DLQBrowser() {
  const [entries, setEntries] = useState<DLQEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [source, setSource] = useState<string | undefined>(undefined);
  // Phase E5.2 — per-row selection for batch redrive.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);

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

  // Drop selections that no longer correspond to a visible row (e.g. after a refresh).
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(entries.map(e => e.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [entries]);

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = entries.length > 0 && selected.size === entries.length;
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(entries.map(e => e.id)));
  };

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

  const replaySelected = async () => {
    if (selected.size === 0) return;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const res = await api.batchReplayDLQ(Array.from(selected));
      const ok = res.replayed.length;
      const failed = res.failed.length;
      setBatchResult(
        failed === 0
          ? `Replayed ${ok} of ${res.total} entries.`
          : `Replayed ${ok} of ${res.total}; ${failed} failed.`
      );
      setSelected(new Set());
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBatchBusy(false);
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
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={replaySelected}
          disabled={selected.size === 0 || batchBusy}
        >
          {batchBusy ? 'Replaying…' : `Replay selected (${selected.size})`}
        </Button>
      </div>

      {error && <Banner variant="error">{error}</Banner>}
      {batchResult && <Banner variant="info">{batchResult}</Banner>}

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
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </th>
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
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${entry.eventName}`}
                    checked={selected.has(entry.id)}
                    onChange={() => toggleSelected(entry.id)}
                  />
                </td>
                <td className="mono">{entry.eventName}</td>
                <td className="mono">{entry.attempts}</td>
                <td>{typeof entry.deadAt === 'string' ? entry.deadAt : new Date(entry.deadAt).toISOString()}</td>
                <td className="error-text">{entry.error}</td>
                <td>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => replay(entry.id)}
                    disabled={busyId === entry.id}
                  >
                    Replay
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => remove(entry.id)}
                    disabled={busyId === entry.id}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
