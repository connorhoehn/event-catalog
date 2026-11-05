import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Chip,
  DetailSection,
  EmptyState,
  ErrorState,
  KeyValue,
  LiveRegion,
  MasterDetailPage,
  RailNavList,
  SkeletonCard,
  Stack,
} from '@connorhoehnslalom/ui-components/shared';
import { api, type EventEntry } from '../api';

/**
 * Read-only event declaration viewer. Shows the full registry list,
 * an inline payload-schema view, and per-event version history. No
 * editing affordances by design — declarations are owned by producer
 * services, not the admin UI.
 */
export function DeclarationViewer() {
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getEvents()
      .then(res => { setEvents(res.events); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = selected ? events.find(e => e.name === selected) ?? null : null;

  // Three distinct states. Before, a 500 rendered the error banner AND
  // "No event declarations" underneath it, so a broken registry and an
  // empty one looked the same below the fold. Loading lives in the rail;
  // error and empty take the detail side, where there is room for a Retry.
  let emptyDetail;
  if (!loading && error) {
    emptyDetail = (
      <ErrorState
        title="Couldn't load declarations"
        description={error}
        action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}
      />
    );
  } else if (!loading && events.length === 0) {
    emptyDetail = (
      <EmptyState
        icon="DECL"
        title="No event declarations"
        body="Services declare events at startup. None have been registered yet."
      />
    );
  } else {
    emptyDetail = <EmptyState title="Select a declaration" />;
  }

  return (
    <MasterDetailPage
      title="Event Declarations"
      badge={<Chip tone="neutral">{events.length} declared</Chip>}
      className="declaration-viewer"
      list={{
        label: 'Declarations',
        title: 'Declarations',
        body: loading ? (
          <Stack gap="sm" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={44} />)}
            <LiveRegion role="none" message="Loading declarations…" />
          </Stack>
        ) : error ? null : (
          /* Each row used to be `<li onClick>`: unreachable by keyboard and
             invisible to a screen reader. Real buttons, with aria-current
             marking the one whose detail is on screen. */
          <RailNavList
            aria-label="Declarations"
            currentStyle="tint"
            items={events.map(event => ({
              id: event.name,
              label: event.name,
              current: selected === event.name,
              onSelect: () => setSelected(event.name),
            }))}
          />
        ),
      }}
      emptyDetail={emptyDetail}
    >
      {!loading && !error && current && (
        /* Focusable so the selection has somewhere sensible to land, and
           polite-live so a reader is told the pane swapped without the
           row losing focus. */
        <div
          className="declaration-detail"
          role="region"
          aria-live="polite"
          aria-label={`Declaration detail for ${current.name}`}
          tabIndex={-1}
        >
          <DetailSection
            first
            variant="heading"
            title={current.name}
            actions={<Link to={`/events/${encodeURIComponent(current.name)}`}>full details &rarr;</Link>}
          >
            {current.description && <p className="description">{current.description}</p>}
            <KeyValue
              aria-label="Declaration facts"
              items={[
                { label: 'Producer', value: Array.isArray(current.producer) ? current.producer.join(', ') : current.producer },
                { label: 'Transport', value: current.transport },
                { label: 'Current Version', value: `v${current.version ?? 1}` },
                { label: 'Subscribers', value: current.subscribers.length > 0 ? current.subscribers.join(', ') : '(none)' },
              ]}
            />
          </DetailSection>

          <DetailSection variant="heading" as="h4" title="Payload Schema (current)">
            <pre className="schema-viewer">{JSON.stringify(current.schema, null, 2)}</pre>
          </DetailSection>

          <DetailSection variant="heading" as="h4" title="Version History">
            {!current.schemaHistory || current.schemaHistory.length === 0 ? (
              <EmptyState title="First version — no prior schemas recorded." />
            ) : (
              <ol className="schema-history">
                {current.schemaHistory.slice().reverse().map(h => (
                  <li key={h.version}>
                    <div className="history-header">
                      <Chip tone="neutral" size="xs">v{h.version}</Chip>
                      <span className="history-date">{h.updatedAt}</span>
                    </div>
                    <details>
                      <summary>schema snapshot</summary>
                      <pre className="schema-viewer">{JSON.stringify(h.schema, null, 2)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </DetailSection>
        </div>
      )}
    </MasterDetailPage>
  );
}
