// Phase E8.3 — Live flow view.
//
// Same ReactFlow graph as TopologyView, plus an SSE subscription to
// /api/flow that maps incoming tap events to edge `active` states.
// Each active state fades back to `default` after FADE_MS.
//
// Reuses TopologyView's node + edge types and dagre layout so the
// visual language is identical; the only addition is a controls
// bar (pause/resume + sample knob + filters) and the edge-state
// dict driven by useFlowTap.

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import Chip from '@ui/components/shared/Chip';
import ErrorState from '@ui/components/shared/ErrorState';
import LoadingState from '@ui/components/shared/LoadingState';
import LiveRegion from '@ui/components/shared/LiveRegion';
import { Button } from '@ui/components/ui/Button';
import AnimatedEdge from '@ui/components/pipelines/canvas/edges/AnimatedEdge';

import { api, type TopologyGraph } from '../api';
import EventNode from './topology/EventNode';
import ServiceNode from './topology/ServiceNode';
import { GRAPH_MIN_ZOOM, layoutGraph } from './topology/layout';
import { NamespaceClusters } from './topology/NamespaceClusters';
import { useFlowTap, type TapEvent } from './topology/useFlowTap';

const nodeTypes: NodeTypes = {
  event: EventNode,
  service: ServiceNode,
};
const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

/** How long an edge stays in `active` state after an event fires. */
const FADE_MS = 800;

function toReactFlowNodes(topology: TopologyGraph): Node[] {
  return topology.nodes.map((n) => {
    if (n.type === 'event') {
      return {
        id: n.id,
        type: 'event',
        position: { x: 0, y: 0 },
        data: {
          label: n.id,
          transport: ((n.metadata.transport as string) ?? 'signal') as
            | 'signal'
            | 'durable'
            | 'both',
          namespace: (n.metadata.namespace as string) ?? undefined,
        },
      } satisfies Node;
    }
    return {
      id: n.id,
      type: 'service',
      position: { x: 0, y: 0 },
      data: { label: n.id },
    } satisfies Node;
  });
}

function toReactFlowEdges(topology: TopologyGraph): Edge[] {
  return topology.edges.map((e, i) => ({
    id: `${e.from}->${e.to}#${i}`,
    source: e.from,
    target: e.to,
    type: 'animated',
    data: { state: 'default' as const, label: e.relation },
  }));
}

export function FlowView() {
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState<string>('');
  // The sample knob keeps the operator's raw keystrokes, and the number sent
  // to the server is derived from them.
  //
  // Holding a coerced number in state made the field uneditable: emptying it
  // fired onChange('') which coerced to 1, React re-rendered the box as "1",
  // and the next keystroke appended — so an operator trying to sample 1-in-10
  // on a firehose got 1-in-110. Same for typing a leading 0. Coercing on read
  // instead of on keystroke leaves the field alone while it is being typed
  // in, and normalises it on blur.
  const [sampleText, setSampleText] = useState('1');
  // Every namespace this view has ever seen, not just the ones in the graph
  // currently on screen.
  //
  // The options used to be derived from the current topology response — but
  // picking a namespace refetches `?namespace=ws`, whose nodes mention only
  // "ws". So choosing a namespace deleted every other option from the list
  // that had just been used to choose it, and the only route back to another
  // namespace was "all" and then a second attempt. TopologyView was fixed for
  // this; the flow view, which shares the control, was not. At two namespaces
  // that is a curiosity; at nine, with the tap running, it is the operator
  // losing their place mid-incident.
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const seenNamespaces = useRef<Set<string>>(new Set());
  const namespaceId = useId();
  const sampleId = useId();

  // An empty or nonsense box means "no sampling", i.e. every event — never
  // zero, which the server would read as a divisor and which means nothing.
  const sample = useMemo(() => {
    const parsed = parseInt(sampleText, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, 1000);
  }, [sampleText]);

  // Edge states keyed by edge id, plus the wall-clock time each one is due
  // to fade.
  //
  // The fade used to be one `setTimeout` per edge, each firing its own
  // `setEdgeStates`. On the real graph a single event pulses both of its
  // incident edges, so a steady 200 events/sec scheduled 400 timers a second
  // and produced 400 extra commits a second on top of the stream's own. One
  // sweeper, rescheduled to the next expiry, replaces all of them.
  const [edgeStates, setEdgeStates] = useState<Record<string, string>>({});
  const expiryRef = useRef<Map<string, number>>(new Map());
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the topology once (or when namespace changes).
  useEffect(() => {
    const params = namespace ? { namespace } : undefined;
    api
      .getTopology(params)
      .then((graph) => {
        for (const n of graph.nodes) {
          if (n.type === 'event' && typeof n.metadata.namespace === 'string') {
            seenNamespaces.current.add(n.metadata.namespace);
          }
        }
        setAllNamespaces([...seenNamespaces.current].sort());
        setTopology(graph);
      })
      .catch((err) => setError((err as Error).message));
  }, [namespace]);

  const { rfNodes, rfEdges, edgeIdsByEvent, nodeNamespaces } = useMemo(() => {
    if (!topology) {
      return {
        rfNodes: [] as Node[],
        rfEdges: [] as Edge[],
        edgeIdsByEvent: new Map<string, string[]>(),
        nodeNamespaces: {} as Record<string, string>,
      };
    }
    const baseNodes = toReactFlowNodes(topology);
    const baseEdges = toReactFlowEdges(topology);

    const ns = new Set<string>();
    const byId: Record<string, string> = {};
    for (const n of topology.nodes) {
      if (n.type === 'event' && typeof n.metadata.namespace === 'string') {
        ns.add(n.metadata.namespace);
        byId[n.id] = n.metadata.namespace;
      }
    }
    // Grouped layout, so the namespace overlay draws boxes that hug their
    // own events instead of nine overlapping full-canvas slabs.
    const laidOut = layoutGraph(baseNodes, baseEdges, { groups: byId });
    // Index edges by the event-node they touch — flow events animate
    // every edge incident to the firing event (producer→event and
    // event→consumer).
    //
    // The membership test is a Set, not `topology.nodes.find(...)`. It was
    // two linear scans of the node list per edge: 380 edges over 231 nodes
    // is ~175k comparisons every time the topology loads or the namespace
    // filter changes, for an answer a Set gives in constant time.
    const eventIds = new Set(
      topology.nodes.filter((n) => n.type === 'event').map((n) => n.id),
    );
    const byEvent = new Map<string, string[]>();
    for (const e of baseEdges) {
      const eventId = eventIds.has(e.source) ? e.source : eventIds.has(e.target) ? e.target : null;
      if (!eventId) continue;
      const list = byEvent.get(eventId) ?? [];
      list.push(e.id);
      byEvent.set(eventId, list);
    }

    return { rfNodes: laidOut, rfEdges: baseEdges, edgeIdsByEvent: byEvent, nodeNamespaces: byId };
  }, [topology]);

  // Apply the current edgeStates dict onto rfEdges, REUSING the object for
  // every edge whose state did not change.
  //
  // This is the single biggest cost on this view. Rebuilding all 380 edge
  // objects on every pulse gave each one a fresh identity, so ReactFlow's
  // memoised edge wrappers all re-rendered — 380 component renders to show
  // that two of them lit up. Measured on the real registry at 500 frames:
  // ~190 000 edge renders before, a few thousand after.
  const edgeCacheRef = useRef<{ base: Edge[]; byId: Map<string, Edge> }>({
    base: [],
    byId: new Map(),
  });
  const styledEdges = useMemo(() => {
    const cache = edgeCacheRef.current;
    if (cache.base !== rfEdges) {
      // New topology — the cached objects describe edges that no longer exist.
      cache.base = rfEdges;
      cache.byId = new Map();
    }
    return rfEdges.map((e) => {
      const state = edgeStates[e.id] ?? 'default';
      const cached = cache.byId.get(e.id);
      if (cached && (cached.data as { state?: string } | undefined)?.state === state) {
        return cached;
      }
      const next: Edge = { ...e, data: { ...(e.data ?? {}), state } };
      cache.byId.set(e.id, next);
      return next;
    });
  }, [rfEdges, edgeStates]);

  /**
   * Retire every edge whose pulse has expired, in one state update, and
   * reschedule for the next one due.
   */
  const sweepFades = useCallback(() => {
    sweepTimerRef.current = null;
    const now = Date.now();
    const expiry = expiryRef.current;
    const done: string[] = [];
    let nextDue = Infinity;
    for (const [id, at] of expiry) {
      if (at <= now) done.push(id);
      else nextDue = Math.min(nextDue, at);
    }
    for (const id of done) expiry.delete(id);
    if (done.length > 0) {
      setEdgeStates((prev) => {
        const next = { ...prev };
        for (const id of done) delete next[id];
        return next;
      });
    }
    if (Number.isFinite(nextDue)) {
      sweepTimerRef.current = setTimeout(sweepFades, Math.max(nextDue - now, 16));
    }
  }, []);

  /**
   * Pulse the edges incident to a firing event.
   *
   * Called straight from the SSE handler rather than from an effect watching
   * `lastEvent`, so the pulse lands in the same React batch as the buffer
   * update: one commit per frame instead of two.
   */
  const pulse = useCallback(
    (event: TapEvent) => {
      const edges = edgeIdsByEvent.get(event.eventName);
      if (!edges || edges.length === 0) return;
      const until = Date.now() + FADE_MS;
      let anyNew = false;
      for (const id of edges) {
        if (!expiryRef.current.has(id)) anyNew = true;
        expiryRef.current.set(id, until);
      }
      // An edge already lit just gets a later expiry — no re-render needed
      // for a pulse that changes nothing an operator can see.
      if (anyNew) {
        setEdgeStates((prev) => {
          const next = { ...prev };
          for (const id of edges) next[id] = 'active';
          return next;
        });
      }
      if (sweepTimerRef.current === null) {
        sweepTimerRef.current = setTimeout(sweepFades, FADE_MS);
      }
    },
    [edgeIdsByEvent, sweepFades],
  );

  // Wire the SSE tap.
  const tap = useFlowTap({ namespace: namespace || undefined, sample }, true, pulse);

  // A topology change invalidates every edge id the pulses referred to.
  useEffect(() => {
    expiryRef.current.clear();
    setEdgeStates((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [edgeIdsByEvent]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (sweepTimerRef.current !== null) clearTimeout(sweepTimerRef.current);
      sweepTimerRef.current = null;
      expiryRef.current.clear();
    };
  }, []);

  if (error) {
    return (
      <div className="flow-view view-column">
        <div className="page-header view-toolbar"><h2>Live Flow</h2></div>
        <ErrorState title="Error loading the flow graph" description={error} />
      </div>
    );
  }
  if (!topology) {
    return (
      <div className="flow-view view-column">
        <div className="page-header view-toolbar"><h2>Live Flow</h2></div>
        <LoadingState label="Loading flow…" />
      </div>
    );
  }

  return (
    <div className="flow-view view-column">
      <div className="page-header view-toolbar">
        <h2>Live Flow</h2>
        <Chip tone={tap.isLive ? 'success' : 'neutral'}>{tap.isLive ? 'live' : 'paused'}</Chip>
        <Chip tone="neutral">{tap.events.length} events in buffer</Chip>
        {/* A dead stream is worth interrupting for — it is the difference
            between "nothing is happening" and "you are not being told what is
            happening". role=status keeps it polite; the graph is still valid. */}
        {tap.error && (
          <span role="status">
            <Chip tone="warning">{tap.error}</Chip>
          </span>
        )}
        <div className="view-toolbar-right">
          <label className="view-toolbar-label" htmlFor={namespaceId}>namespace</label>
          <select
            id={namespaceId}
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="view-select"
          >
            <option value="">all</option>
            {allNamespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>

          <label className="view-toolbar-label spaced" htmlFor={sampleId}>sample 1/N</label>
          <input
            id={sampleId}
            type="number"
            min={1}
            max={1000}
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            onBlur={() => setSampleText(String(sample))}
            className="view-number-input"
          />

          {tap.isLive ? (
            <Button variant="secondary" size="sm" onClick={tap.pause}>
              Pause
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={tap.resume}>
              Resume
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={tap.clear}>
            Clear
          </Button>
        </div>
      </div>

      <div className="view-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={rfNodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            minZoom={GRAPH_MIN_ZOOM}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <NamespaceClusters nodeNamespaces={nodeNamespaces} />
            <Background />
            <Controls />
            <MiniMap
              nodeColor={(n) => (n.type === 'event' ? '#38bdf8' : '#94a3b8')}
              maskColor="rgba(15, 17, 23, 0.7)"
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      <FlowTicker events={tap.events} />
    </div>
  );
}

// Memoised: the toolbar re-renders whenever an edge pulse changes, and there
// is no reason for ten <li>s to be rebuilt because an edge lit up.
const FlowTicker = memo(function FlowTicker({ events }: { events: TapEvent[] }) {
  const last10 = events.slice(-10).reverse();
  const latest = last10[0];
  return (
    <>
      {/*
        Politeness, deliberately.

        The obvious thing — aria-live on the ticker itself — is the wrong
        thing. This list can take hundreds of rows a second off the SSE tap,
        and a live region queues one utterance per mutation: the reader would
        fall minutes behind the screen and the user could not interrupt it.
        `assertive` would be worse still, cutting off every other announcement
        on the page indefinitely.

        So the ticker is explicitly aria-live="off" (stated rather than merely
        omitted, so the next person knows it is a decision), and a coalesced
        one-line summary is announced politely at most once every four
        seconds. That is enough to know the flow is alive and what is loudest
        in it, which is what the ticker is for; anyone who wants the rows
        themselves can read them as a normal list.
      */}
      <LiveRegion
        throttleMs={4_000}
        message={
          latest
            ? `Flow active: ${events.length} taps received, most recent ${latest.eventName} from ${latest.producer}.`
            : ''
        }
      />
      <ul className="flow-ticker" aria-live="off" aria-label="Recent events, newest first">
      {last10.length === 0 ? (
        <li className="flow-ticker-empty">Waiting for events…</li>
      ) : (
        last10.map((e, i) => (
          <li key={`${e.timestamp}-${i}`} className="flow-ticker-row">
            <span className="flow-ticker-time">{e.timestamp.slice(11, 23)}</span>{' '}
            <span className="flow-ticker-transport">{e.transport}</span>{' '}
            <span className="flow-ticker-name">{e.eventName}</span>{' '}
            <span className="flow-ticker-producer">← {e.producer}</span>
          </li>
        ))
      )}
      </ul>
    </>
  );
});
