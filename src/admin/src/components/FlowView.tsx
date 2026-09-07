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

import { useEffect, useMemo, useRef, useState } from 'react';
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
import Banner from '@ui/components/shared/Banner';
import { Button } from '@ui/components/ui/Button';
import AnimatedEdge from '@ui/components/pipelines/canvas/edges/AnimatedEdge';

import { api, type TopologyGraph } from '../api';
import EventNode from './topology/EventNode';
import ServiceNode from './topology/ServiceNode';
import { layoutGraph } from './topology/layout';
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
  const [sample, setSample] = useState<number>(1);

  // Edge states keyed by edge id. Stored in a ref + state to balance
  // 60Hz reads (ref) with re-renders triggered on state-change.
  const [edgeStates, setEdgeStates] = useState<Record<string, string>>({});
  const fadeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Load the topology once (or when namespace changes).
  useEffect(() => {
    const params = namespace ? { namespace } : undefined;
    api
      .getTopology(params)
      .then(setTopology)
      .catch((err) => setError((err as Error).message));
  }, [namespace]);

  const { rfNodes, rfEdges, namespaces, edgeIdsByEvent, nodeNamespaces } = useMemo(() => {
    if (!topology) {
      return {
        rfNodes: [] as Node[],
        rfEdges: [] as Edge[],
        namespaces: [] as string[],
        edgeIdsByEvent: new Map<string, string[]>(),
        nodeNamespaces: {} as Record<string, string>,
      };
    }
    const baseNodes = toReactFlowNodes(topology);
    const baseEdges = toReactFlowEdges(topology);
    const laidOut = layoutGraph(baseNodes, baseEdges);

    const ns = new Set<string>();
    const byId: Record<string, string> = {};
    for (const n of topology.nodes) {
      if (n.type === 'event' && typeof n.metadata.namespace === 'string') {
        ns.add(n.metadata.namespace);
        byId[n.id] = n.metadata.namespace;
      }
    }
    // Index edges by the event-node they touch — flow events animate
    // every edge incident to the firing event (producer→event and
    // event→consumer).
    const byEvent = new Map<string, string[]>();
    for (const e of baseEdges) {
      // Source or target may be the event id; topology nodes mark which.
      const sourceIsEvent = topology.nodes.find((n) => n.id === e.source)?.type === 'event';
      const targetIsEvent = topology.nodes.find((n) => n.id === e.target)?.type === 'event';
      const eventId = sourceIsEvent ? e.source : targetIsEvent ? e.target : null;
      if (!eventId) continue;
      const list = byEvent.get(eventId) ?? [];
      list.push(e.id);
      byEvent.set(eventId, list);
    }

    return { rfNodes: laidOut, rfEdges: baseEdges, namespaces: [...ns].sort(), edgeIdsByEvent: byEvent, nodeNamespaces: byId };
  }, [topology]);

  // Apply current edgeStates dict onto rfEdges.
  const styledEdges = useMemo(() => {
    return rfEdges.map((e) => ({
      ...e,
      data: { ...(e.data ?? {}), state: edgeStates[e.id] ?? 'default' },
    }));
  }, [rfEdges, edgeStates]);

  // Wire the SSE tap.
  const tap = useFlowTap({ namespace: namespace || undefined, sample });

  // Each new tap event pulses the relevant edges.
  useEffect(() => {
    if (!tap.lastEvent) return;
    const eventId = tap.lastEvent.eventName;
    const edges = edgeIdsByEvent.get(eventId);
    if (!edges || edges.length === 0) return;
    setEdgeStates((prev) => {
      const next = { ...prev };
      for (const id of edges) next[id] = 'active';
      return next;
    });
    for (const id of edges) {
      const existing = fadeTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setEdgeStates((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        fadeTimersRef.current.delete(id);
      }, FADE_MS);
      fadeTimersRef.current.set(id, t);
    }
  }, [tap.lastEvent, edgeIdsByEvent]);

  // Cleanup on unmount.
  useEffect(() => {
    const timers = fadeTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;
  if (!topology) return <div className="loading">Loading flow…</div>;

  return (
    <div className="flow-view view-column">
      <div className="page-header view-toolbar">
        <h2>Live Flow</h2>
        <Chip tone={tap.isLive ? 'success' : 'neutral'}>{tap.isLive ? 'live' : 'paused'}</Chip>
        <Chip tone="neutral">{tap.events.length} events in buffer</Chip>
        {tap.error && <Chip tone="warning">{tap.error}</Chip>}
        <div className="view-toolbar-right">
          <label className="view-toolbar-label">namespace</label>
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="view-select"
          >
            <option value="">all</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>

          <label className="view-toolbar-label spaced">sample 1/N</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={sample}
            onChange={(e) => setSample(Math.max(1, parseInt(e.target.value, 10) || 1))}
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
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <NamespaceClusters nodeNamespaces={nodeNamespaces} />
            <Background />
            <Controls />
            <MiniMap nodeColor={(n) => (n.type === 'event' ? '#0ea5e9' : '#94a3b8')} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

      <FlowTicker events={tap.events} />
    </div>
  );
}

function FlowTicker({ events }: { events: TapEvent[] }) {
  const last10 = events.slice(-10).reverse();
  return (
    <div className="flow-ticker">
      {last10.length === 0 ? (
        <div className="flow-ticker-empty">Waiting for events…</div>
      ) : (
        last10.map((e, i) => (
          <div key={`${e.timestamp}-${i}`} className="flow-ticker-row">
            <span className="flow-ticker-time">{e.timestamp.slice(11, 23)}</span>{' '}
            <span className="flow-ticker-transport">{e.transport}</span>{' '}
            <span className="flow-ticker-name">{e.eventName}</span>{' '}
            <span className="flow-ticker-producer">← {e.producer}</span>
          </div>
        ))
      )}
    </div>
  );
}
