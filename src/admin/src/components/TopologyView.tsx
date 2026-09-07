// Phase E8.2 — Topology view rebuilt on @xyflow/react with custom
// EventNode + ServiceNode types, dagre auto-layout, and AnimatedEdge
// from `@ui/components/pipelines/canvas/edges/AnimatedEdge` so the
// visual style matches the gateway's pipeline-replay view.
//
// Lives in event-catalog/src/admin. Data shape comes from the
// existing GET /api/topology endpoint; transformation to ReactFlow
// node/edge format happens client-side.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import EmptyState from '@ui/components/shared/EmptyState';
import ErrorState from '@ui/components/shared/ErrorState';
import LoadingState from '@ui/components/shared/LoadingState';
import { Button } from '@ui/components/ui/Button';
import AnimatedEdge from '@ui/components/pipelines/canvas/edges/AnimatedEdge';

import { api, type TopologyGraph } from '../api';
import EventNode from './topology/EventNode';
import ServiceNode from './topology/ServiceNode';
import { GRAPH_MIN_ZOOM, layoutGraph } from './topology/layout';
import { NamespaceClusters } from './topology/NamespaceClusters';

const nodeTypes: NodeTypes = {
  event: EventNode,
  service: ServiceNode,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

interface FilterState {
  namespace: string;
}

function toReactFlowNodes(topology: TopologyGraph): Node[] {
  const producerIds = new Set(
    topology.edges.filter((e) => e.relation === 'publishes').map((e) => e.from),
  );
  const consumerIds = new Set(
    topology.edges.filter((e) => e.relation === 'subscribes').map((e) => e.to),
  );

  return topology.nodes.map((n) => {
    if (n.type === 'event') {
      return {
        id: n.id,
        type: 'event',
        position: { x: 0, y: 0 }, // dagre will replace
        data: {
          label: n.id,
          transport: ((n.metadata.transport as string) ?? 'signal') as
            | 'signal'
            | 'durable'
            | 'both',
          namespace: (n.metadata.namespace as string) ?? undefined,
          description: n.metadata.description as string | undefined,
        },
      } satisfies Node;
    }
    const isProducer = producerIds.has(n.id);
    const isConsumer = consumerIds.has(n.id);
    return {
      id: n.id,
      type: 'service',
      position: { x: 0, y: 0 },
      data: {
        label: n.id,
        role: isProducer && isConsumer ? 'both' : isProducer ? 'producer' : 'consumer',
      },
    } satisfies Node;
  });
}

function toReactFlowEdges(topology: TopologyGraph): Edge[] {
  return topology.edges.map((e, i) => ({
    id: `${e.from}->${e.to}#${i}`,
    source: e.from,
    target: e.to,
    type: 'animated',
    data: {
      state: 'default' as const,
      label: e.relation,
    },
  }));
}

export function TopologyView() {
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({ namespace: '' });
  // The dropdown's options are the namespaces of the WHOLE catalog, so they
  // have to survive a filtered fetch. Deriving them from the current response
  // meant that picking "ws" refetched `?namespace=ws`, whose nodes mention
  // only "ws" — the other options vanished from the list that had just been
  // used to pick one, and the only way back to another namespace was "all".
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const namespaceId = useId();
  const seenNamespaces = useRef<Set<string>>(new Set());
  // Bumped by Retry. The error card previously replaced the whole toolbar,
  // filter included, so a failed load left the view with no control at all —
  // the only way to ask again was a browser reload.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = filter.namespace ? { namespace: filter.namespace } : undefined;
    // A previous failure must not outlive the request that fixed it: without
    // this, one 500 pinned the error card forever and every later successful
    // fetch rendered behind it.
    setError(null);
    api
      .getTopology(params)
      .then((graph) => {
        if (cancelled) return;
        for (const n of graph.nodes) {
          if (n.type === 'event' && typeof n.metadata.namespace === 'string') {
            seenNamespaces.current.add(n.metadata.namespace);
          }
        }
        setAllNamespaces([...seenNamespaces.current].sort());
        setTopology(graph);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [filter.namespace, reloadNonce]);

  const { rfNodes, rfEdges, nodeNamespaces } = useMemo(() => {
    if (!topology) {
      return {
        rfNodes: [] as Node[],
        rfEdges: [] as Edge[],
        nodeNamespaces: {} as Record<string, string>,
      };
    }
    const baseNodes = toReactFlowNodes(topology);
    const baseEdges = toReactFlowEdges(topology);
    const byId: Record<string, string> = {};
    for (const n of topology.nodes) {
      if (n.type === 'event' && typeof n.metadata.namespace === 'string') {
        byId[n.id] = n.metadata.namespace;
      }
    }
    // Grouped layout: dagre keeps each namespace's events together, which is
    // what makes the NamespaceClusters overlay mean anything at 225 events.
    // Ungrouped, the nine namespace boxes overlapped in 19 of 36 pairs and
    // the three-event `transcription` box covered more canvas than the
    // seventy-six-event `ws` one.
    const laidOut = layoutGraph(baseNodes, baseEdges, { groups: byId });
    return { rfNodes: laidOut, rfEdges: baseEdges, nodeNamespaces: byId };
  }, [topology]);

  // Keeping the heading in the failure and loading states means the view
  // always has its <h2> landmark, whatever the API did.
  if (error) {
    return (
      <div className="topology-view view-column">
        <div className="page-header view-toolbar"><h2>Event Topology</h2></div>
        <ErrorState
          title="Error loading the topology"
          description={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }
  if (!topology) {
    return (
      <div className="topology-view view-column">
        <div className="page-header view-toolbar"><h2>Event Topology</h2></div>
        <LoadingState label="Loading topology…" />
      </div>
    );
  }

  return (
    <div className="topology-view view-column">
      <div className="page-header view-toolbar">
        <h2>Event Topology</h2>
        <Chip tone="neutral">{topology.nodes.filter((n) => n.type === 'event').length} events</Chip>
        <Chip tone="neutral">{topology.nodes.filter((n) => n.type === 'service').length} services</Chip>
        <div className="view-toolbar-right">
          <label className="view-toolbar-label" htmlFor={namespaceId}>namespace</label>
          <select
            id={namespaceId}
            value={filter.namespace}
            onChange={(e) => setFilter({ namespace: e.target.value })}
            className="view-select"
          >
            <option value="">all</option>
            {allNamespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </div>
      </div>

      {topology.nodes.length === 0 ? (
        <EmptyState
          icon="🕸️"
          title={
            filter.namespace
              ? `No events in the "${filter.namespace}" namespace`
              : 'No events registered yet'
          }
          body={
            filter.namespace
              ? 'The catalog has events, but none in this namespace. Switch the namespace filter back to "all" to see the whole graph.'
              : 'Services register their events at startup. The topology graph will show producers, events, and subscribers as connected nodes.'
          }
        />
      ) : (
        <div className="view-canvas">
          <ReactFlowProvider>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
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
      )}
    </div>
  );
}
