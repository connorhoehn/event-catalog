import { useEffect, useState, useRef } from 'react';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import { Button } from '@ui/components/ui/Button';
import { api, type EventEntry, type EventStats } from '../api';

interface LiveMessage {
  eventName: string;
  transport: string;
  timestamp: number;
  payload: unknown;
  id: string;
}

export function LiveInspector() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [liveStats, setLiveStats] = useState<Record<string, EventStats>>({});
  const [paused, setPaused] = useState(false);
  const [maxMessages, setMaxMessages] = useState(100);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    api.getEvents().then(res => setEvents(res.events)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedEvents.size === 0) return;

    const interval = setInterval(async () => {
      if (pausedRef.current) return;

      try {
        const metrics = await api.getMetrics();
        setLiveStats(metrics);

        for (const eventName of selectedEvents) {
          const historyRes = await api.getEventHistory(eventName, 5);
          const newMsgs: LiveMessage[] = historyRes.messages.map((msg, i) => ({
            eventName,
            transport: historyRes.transport,
            timestamp: Date.now() - i * 10,
            payload: msg,
            id: `${eventName}-${Date.now()}-${i}`,
          }));

          setMessages(prev => {
            const combined = [...prev, ...newMsgs].slice(-maxMessages);
            return combined;
          });
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedEvents, maxMessages]);

  useEffect(() => {
    if (!paused) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, paused]);

  const toggleEvent = (name: string) => {
    setSelectedEvents(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const signalEvents = events.filter(e => e.transport === 'signal');
  const durableEvents = events.filter(e => e.transport === 'durable');

  return (
    <div className="live-inspector">
      <div className="page-header">
        <h2>Live Inspector</h2>
        <div className="controls">
          <Button
            variant={paused ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setPaused(p => !p)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setMessages([])}>
            Clear
          </Button>
          <select value={maxMessages} onChange={e => setMaxMessages(parseInt(e.target.value))}>
            <option value={50}>50 messages</option>
            <option value={100}>100 messages</option>
            <option value={500}>500 messages</option>
          </select>
        </div>
      </div>

      <div className="inspector-layout">
        <div className="event-selector">
          <h3>Signal Events (Ephemeral)</h3>
          <div className="event-checkboxes">
            {signalEvents.map(e => (
              <label key={e.name} className="event-checkbox">
                <input
                  type="checkbox"
                  checked={selectedEvents.has(e.name)}
                  onChange={() => toggleEvent(e.name)}
                />
                <span className="event-label">
                  {e.name}
                  {liveStats[e.name] && (
                    <Chip tone="info" size="xs" mono>{liveStats[e.name].publishRate.toFixed(1)}/s</Chip>
                  )}
                </span>
              </label>
            ))}
            {signalEvents.length === 0 && <div className="empty-state">No signal events registered</div>}
          </div>

          <h3>Durable Events</h3>
          <div className="event-checkboxes">
            {durableEvents.map(e => (
              <label key={e.name} className="event-checkbox">
                <input
                  type="checkbox"
                  checked={selectedEvents.has(e.name)}
                  onChange={() => toggleEvent(e.name)}
                />
                <span className="event-label">
                  {e.name}
                  {liveStats[e.name] && (
                    <Chip tone="warning" size="xs" mono>{liveStats[e.name].publishRate.toFixed(1)}/s</Chip>
                  )}
                </span>
              </label>
            ))}
            {durableEvents.length === 0 && <div className="empty-state">No durable events registered</div>}
          </div>
        </div>

        <div className="message-stream">
          {selectedEvents.size === 0 ? (
            <EmptyState
              icon="🔍"
              title="Select events to inspect"
              body="Choose events from the left panel to see live messages. Signal events (cursors, presence) update in real-time. Durable events show as they flow through queues."
            />
          ) : (
            <>
              <div className="stream-header">
                <span>Watching: {[...selectedEvents].join(', ')}</span>
                <Chip tone="neutral" size="xs" mono>{messages.length} messages</Chip>
              </div>
              <div className="stream-messages">
                {messages.map(msg => (
                  <div key={msg.id} className={`stream-message ${msg.transport}`}>
                    <div className="message-header">
                      <Chip tone={msg.transport === 'signal' ? 'info' : 'warning'} size="xs">
                        {msg.eventName}
                      </Chip>
                      <span className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <pre className="message-payload">{JSON.stringify(msg.payload, null, 2)}</pre>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
