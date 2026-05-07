import { useEffect, useState, useRef } from 'react';
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

  // Poll for new messages from selected signal events
  useEffect(() => {
    if (selectedEvents.size === 0) return;

    const interval = setInterval(async () => {
      if (pausedRef.current) return;

      try {
        const metrics = await api.getMetrics();
        setLiveStats(metrics);

        // Fetch recent history from each selected event
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

  // Auto-scroll
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
          <button
            className={`btn ${paused ? 'btn-resume' : 'btn-pause'}`}
            onClick={() => setPaused(p => !p)}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn btn-clear" onClick={() => setMessages([])}>
            Clear
          </button>
          <select value={maxMessages} onChange={e => setMaxMessages(parseInt(e.target.value))}>
            <option value={50}>50 messages</option>
            <option value={100}>100 messages</option>
            <option value={500}>500 messages</option>
          </select>
        </div>
      </div>

      <div className="inspector-layout">
        {/* Event selector panel */}
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
                    <span className="rate">{liveStats[e.name].publishRate.toFixed(1)}/s</span>
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
                    <span className="rate">{liveStats[e.name].publishRate.toFixed(1)}/s</span>
                  )}
                </span>
              </label>
            ))}
            {durableEvents.length === 0 && <div className="empty-state">No durable events registered</div>}
          </div>
        </div>

        {/* Live message stream */}
        <div className="message-stream">
          {selectedEvents.size === 0 ? (
            <div className="empty-state center">
              Select events from the left panel to inspect live messages.
              <br /><br />
              Signal events (cursors, presence, typing) update in real-time.
              <br />
              Durable events show as they flow through queues.
            </div>
          ) : (
            <>
              <div className="stream-header">
                <span>Watching: {[...selectedEvents].join(', ')}</span>
                <span className="message-count">{messages.length} messages</span>
              </div>
              <div className="stream-messages">
                {messages.map(msg => (
                  <div key={msg.id} className={`stream-message ${msg.transport}`}>
                    <div className="message-header">
                      <span className={`badge ${msg.transport}`}>{msg.eventName}</span>
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
