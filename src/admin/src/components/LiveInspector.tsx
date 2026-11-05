import { useEffect, useId, useRef, useState } from 'react';
import { Chip, EmptyState, ErrorState, LoadingState, Button } from '@connorhoehnslalom/ui-components/shared';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // `/history` returns the last N messages, not the ones since we last asked,
  // so re-polling it every second re-appended the SAME five rows every second
  // — the stream filled with duplicates of one message and the "N messages"
  // counter climbed on a catalog that was completely idle. Remembering what
  // we've already shown per event turns the poll back into a tail.
  const seenRef = useRef<Map<string, Set<string>>>(new Map());
  const capId = useId();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // This used to be `.catch(() => {})`: when the registry was down the two
  // event pickers simply rendered empty, which is indistinguishable from a
  // catalog with nothing in it.
  useEffect(() => {
    api.getEvents()
      .then(res => { setEvents(res.events); setLoadError(null); })
      .catch(err => setLoadError((err as Error).message))
      .finally(() => setLoadingEvents(false));
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
          let seen = seenRef.current.get(eventName);
          if (!seen) {
            seen = new Set<string>();
            seenRef.current.set(eventName, seen);
          }
          const newMsgs: LiveMessage[] = [];
          historyRes.messages.forEach((msg, i) => {
            const signature = JSON.stringify(msg);
            if (seen!.has(signature)) return;
            seen!.add(signature);
            newMsgs.push({
              eventName,
              transport: historyRes.transport,
              timestamp: Date.now() - i * 10,
              payload: msg,
              id: `${eventName}-${Date.now()}-${i}`,
            });
          });
          if (newMsgs.length === 0) continue;
          // Bounded so a high-rate event can't grow the signature set without
          // limit; the window only has to outlive one /history page.
          if (seen.size > 500) {
            seenRef.current.set(eventName, new Set([...seen].slice(-250)));
          }

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
      if (next.has(name)) {
        next.delete(name);
        // Forget what we showed, so re-selecting an event replays its current
        // history rather than waiting for the next brand-new message.
        seenRef.current.delete(name);
      } else next.add(name);
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
          <label className="sr-only" htmlFor={capId}>Message buffer size</label>
          <select id={capId} value={maxMessages} onChange={e => setMaxMessages(parseInt(e.target.value))}>
            <option value={50}>50 messages</option>
            <option value={100}>100 messages</option>
            <option value={500}>500 messages</option>
          </select>
        </div>
      </div>

      {loadError && (
        <ErrorState title="Error loading the event list" description={loadError} />
      )}

      <div className="inspector-layout">
        {/* Two checkbox groups, each named by its own heading. */}
        <div className="event-selector">
          {loadingEvents && <LoadingState label="Loading events…" />}
          <h3 id="li-signal">Signal Events (Ephemeral)</h3>
          <div className="event-checkboxes" role="group" aria-labelledby="li-signal">
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
            {!loadingEvents && !loadError && signalEvents.length === 0 && (
              <div className="empty-state">No signal events registered</div>
            )}
          </div>

          <h3 id="li-durable">Durable Events</h3>
          <div className="event-checkboxes" role="group" aria-labelledby="li-durable">
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
            {!loadingEvents && !loadError && durableEvents.length === 0 && (
              <div className="empty-state">No durable events registered</div>
            )}
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
                <span role="status">Watching: {[...selectedEvents].join(', ')}</span>
                <Chip tone="neutral" size="xs" mono>{messages.length} messages</Chip>
              </div>
              {/* Same reasoning as the flow ticker: this pane can take a
                  message a second per selected event, so it is explicitly not
                  a live region. The "N messages" chip above is the summary. */}
              <div className="stream-messages" aria-live="off">
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
