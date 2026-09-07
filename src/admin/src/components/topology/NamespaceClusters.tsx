// Phase E8.4 — namespace clustering overlay for the topology graph.
//
// Renders one rounded rectangle per namespace under the ReactFlow
// graph, labeled with the namespace name and a count of events. The
// rectangles auto-fit the bounding box of the event nodes belonging to
// each namespace (plus padding) so they hug the layout dagre produces.
//
// ReactFlow doesn't have a native "cluster" concept; this is the
// workaround the agent audit recommended.

import { useStore } from '@xyflow/react';

interface NamespaceClustersProps {
  /** Map of event-node-id → namespace, from the API response. */
  nodeNamespaces: Record<string, string>;
}

const NAMESPACE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  pipeline: { fill: '#fef3c7', stroke: '#fcd34d', text: '#92400e' },
  ws: { fill: '#dbeafe', stroke: '#93c5fd', text: '#1e40af' },
  sfu: { fill: '#fae8ff', stroke: '#d8b4fe', text: '#7e22ce' },
  social: { fill: '#dcfce7', stroke: '#86efac', text: '#15803d' },
  default: { fill: '#f1f5f9', stroke: '#cbd5e1', text: '#475569' },
};

const PADDING = 24;
const LABEL_OFFSET = 18;

export function NamespaceClusters({ nodeNamespaces }: NamespaceClustersProps) {
  // Read live node positions from ReactFlow's store so we re-render as
  // the user drags nodes around.
  const nodes = useStore((s) => s.nodes);

  // Group nodes by namespace, computing each group's bounding box.
  const groups = new Map<
    string,
    { x1: number; y1: number; x2: number; y2: number; count: number }
  >();
  for (const node of nodes) {
    const ns = nodeNamespaces[node.id];
    if (!ns) continue;
    const w = node.measured?.width ?? node.width ?? 200;
    const h = node.measured?.height ?? node.height ?? 60;
    const x1 = node.position.x;
    const y1 = node.position.y;
    const x2 = x1 + w;
    const y2 = y1 + h;
    const cur = groups.get(ns);
    if (!cur) {
      groups.set(ns, { x1, y1, x2, y2, count: 1 });
    } else {
      cur.x1 = Math.min(cur.x1, x1);
      cur.y1 = Math.min(cur.y1, y1);
      cur.x2 = Math.max(cur.x2, x2);
      cur.y2 = Math.max(cur.y2, y2);
      cur.count += 1;
    }
  }

  if (groups.size === 0) return null;

  return (
    <svg className="namespace-cluster-overlay">
      {[...groups.entries()].map(([ns, box]) => {
        const colors = NAMESPACE_COLORS[ns] ?? NAMESPACE_COLORS.default!;
        const x = box.x1 - PADDING;
        const y = box.y1 - PADDING - LABEL_OFFSET;
        const w = box.x2 - box.x1 + PADDING * 2;
        const h = box.y2 - box.y1 + PADDING * 2 + LABEL_OFFSET;
        return (
          <g key={ns}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={12}
              ry={12}
              fill={colors.fill}
              fillOpacity={0.35}
              stroke={colors.stroke}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <text
              x={x + 12}
              y={y + 14}
              fontSize={11}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              fill={colors.text}
              className="namespace-cluster-label"
            >
              {ns} · {box.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
