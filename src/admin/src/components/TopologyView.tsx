// Phase E8.2 — Topology view rebuilt on @xyflow/react with custom
// EventNode + ServiceNode types, dagre auto-layout, and AnimatedEdge
// from `@ui/components/pipelines/canvas/edges/AnimatedEdge` so the
// visual style matches the gateway's pipeline-replay view.
//
// Lives in event-catalog/src/admin. Data shape comes from the
// existing GET /api/topology endpoint; transformation to ReactFlow
// node/edge format happens client-side.

import { useEffect, useMemo, useState } from 'react';
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
import Banner from '@ui/components/shared/Banner';
import AnimatedEdge from '@ui/components/pipelines/canvas/edges/AnimatedEdge';

import { api, type TopologyGraph } from '../api';
import EventNode from './topology/EventNode';
import ServiceNode from './topology/ServiceNode';
import { layoutGraph } from './topology/layout';
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

  useEffect(() => {
    const params = filter.namespace ? { namespace: filter.namespace } : undefined;
    api
      .getTopology(params)
      .then(setTopology)
      .catch((err) => setError((err as Error).message));
  }, [filter.namespace]);

  const { rfNodes, rfEdges, namespaces, nodeNamespaces } = useMemo(() => {
    if (!topology) {
      return {
        rfNodes: [] as Node[],
        rfEdges: [] as Edge[],
        namespaces: [] as string[],
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
    return { rfNodes: laidOut, rfEdges: baseEdges, namespaces: [...ns].sort(), nodeNamespaces: byId };
  }, [topology]);

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;
  if (!topology) return <div className="loading">Loading topology...</div>;

  return (
    <div className="topology-view view-column">
      <div className="page-header view-toolbar">
        <h2>Event Topology</h2>
        <Chip tone="neutral">{topology.nodes.filter((n) => n.type === 'event').length} events</Chip>
        <Chip tone="neutral">{topology.nodes.filter((n) => n.type === 'service').length} services</Chip>
        <div className="view-toolbar-right">
          <label className="view-toolbar-label">namespace</label>
          <select
            value={filter.namespace}
            onChange={(e) => setFilter({ namespace: e.target.value })}
            className="view-select"
          >
            <option value="">all</option>
            {namespaces.map((ns) => (
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
          title="No events registered yet"
          body="Services register their events at startup. The topology graph will show producers, events, and subscribers as connected nodes."
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
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
            >
              <NamespaceClusters nodeNamespaces={nodeNamespaces} />
              <Background />
              <Controls />
              <MiniMap
                nodeColor={(n) => (n.type === 'event' ? '#0ea5e9' : '#94a3b8')}
                maskColor="rgba(15, 23, 42, 0.04)"
              />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      )}
    </div>
  );
}
