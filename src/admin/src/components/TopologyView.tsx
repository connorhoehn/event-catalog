import { useEffect, useState, useRef, useCallback } from 'react';
import Chip from '@ui/components/shared/Chip';
import EmptyState from '@ui/components/shared/EmptyState';
import Banner from '@ui/components/shared/Banner';
import { api, type TopologyGraph } from '../api';

interface NodePosition {
  id: string;
  type: 'service' | 'event';
  x: number;
  y: number;
  metadata: Record<string, unknown>;
}

export function TopologyView() {
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [positions, setPositions] = useState<NodePosition[]>([]);

  useEffect(() => {
    api.getTopology()
      .then(data => {
        setTopology(data);
        setPositions(layoutNodes(data));
      })
      .catch(err => setError(err.message));
  }, []);

  const handleNodeClick = useCallback((id: string) => {
    setSelectedNode(prev => prev === id ? null : id);
  }, []);

  if (error) return <Banner variant="error" title="Error">{error}</Banner>;
  if (!topology) return <div className="loading">Loading topology...</div>;
  if (topology.nodes.length === 0) {
    return (
      <div className="topology-view">
        <h2>Event Topology</h2>
        <EmptyState
          icon="🕸️"
          title="No events registered yet"
          body="Services register their events at startup. The topology graph will show producers, events, and subscribers as connected nodes."
        />
      </div>
    );
  }

  const services = positions.filter(n => n.type === 'service');
  const events = positions.filter(n => n.type === 'event');

  return (
    <div className="topology-view">
      <div className="page-header">
        <h2>Event Topology</h2>
        <div className="legend">
          <span className="legend-item"><span className="legend-dot service" /> Service</span>
          <span className="legend-item"><span className="legend-dot event-signal" /> Signal Event</span>
          <span className="legend-item"><span className="legend-dot event-durable" /> Durable Event</span>
        </div>
      </div>

      <div className="topology-canvas">
        <svg
          ref={svgRef}
          viewBox="0 0 1000 600"
          className="topology-svg"
        >
          {topology.edges.map((edge, i) => {
            const from = positions.find(n => n.id === edge.from);
            const to = positions.find(n => n.id === edge.to);
            if (!from || !to) return null;

            const isPublish = edge.relation === 'publishes';
            return (
              <g key={i}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={`edge ${isPublish ? 'publish-edge' : 'subscribe-edge'}`}
                  markerEnd="url(#arrowhead)"
                />
              </g>
            );
          })}

          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
            </marker>
          </defs>

          {services.map(node => (
            <g
              key={node.id}
              className={`node service-node ${selectedNode === node.id ? 'selected' : ''}`}
              onClick={() => handleNodeClick(node.id)}
            >
              <rect
                x={node.x - 60}
                y={node.y - 20}
                width={120}
                height={40}
                rx={6}
              />
              <text x={node.x} y={node.y + 5} textAnchor="middle">{node.id}</text>
            </g>
          ))}

          {events.map(node => {
            const transport = (node.metadata.transport as string) ?? 'signal';
            return (
              <g
                key={node.id}
                className={`node event-node ${transport} ${selectedNode === node.id ? 'selected' : ''}`}
                onClick={() => handleNodeClick(node.id)}
              >
                <ellipse
                  cx={node.x}
                  cy={node.y}
                  rx={70}
                  ry={24}
                />
                <text x={node.x} y={node.y + 5} textAnchor="middle">{node.id}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {selectedNode && (
        <div className="node-detail-panel">
          <h3>{selectedNode}</h3>
          {(() => {
            const node = topology.nodes.find(n => n.id === selectedNode);
            if (!node) return null;
            const outEdges = topology.edges.filter(e => e.from === selectedNode);
            const inEdges = topology.edges.filter(e => e.to === selectedNode);
            return (
              <div>
                <p>Type: <Chip tone={node.type === 'service' ? 'purple' : 'info'}>{node.type}</Chip></p>
                {outEdges.length > 0 && (
                  <div>
                    <strong>Publishes to:</strong>
                    <ul>{outEdges.map((e, i) => <li key={i}>{e.to}</li>)}</ul>
                  </div>
                )}
                {inEdges.length > 0 && (
                  <div>
                    <strong>Receives from:</strong>
                    <ul>{inEdges.map((e, i) => <li key={i}>{e.from}</li>)}</ul>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function layoutNodes(topology: TopologyGraph): NodePosition[] {
  const positions: NodePosition[] = [];
  const services = topology.nodes.filter(n => n.type === 'service');
  const events = topology.nodes.filter(n => n.type === 'event');

  const producerIds = new Set(topology.edges.filter(e => e.relation === 'publishes').map(e => e.from));
  const producers = services.filter(s => producerIds.has(s.id));
  const subscribers = services.filter(s => !producerIds.has(s.id));

  producers.forEach((s, i) => {
    positions.push({
      id: s.id,
      type: 'service',
      x: 150,
      y: 80 + i * 100,
      metadata: s.metadata,
    });
  });

  events.forEach((e, i) => {
    positions.push({
      id: e.id,
      type: 'event',
      x: 500,
      y: 60 + i * 80,
      metadata: e.metadata,
    });
  });

  subscribers.forEach((s, i) => {
    positions.push({
      id: s.id,
      type: 'service',
      x: 850,
      y: 80 + i * 100,
      metadata: s.metadata,
    });
  });

  return positions;
}
