// Topology layout via dagre.
//
// dagre arranges a directed acyclic graph left-to-right and gives every
// node a center position. Returns a new array of ReactFlow-shaped nodes
// with `position: {x, y}` filled in.

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 60;

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  opts: { nodeWidth?: number; nodeHeight?: number; rankSep?: number; nodeSep?: number } = {},
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: opts.nodeSep ?? 40,
    ranksep: opts.rankSep ?? 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const w = opts.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const h = opts.nodeHeight ?? DEFAULT_NODE_HEIGHT;

  for (const n of nodes) {
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
