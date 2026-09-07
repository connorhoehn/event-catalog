import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface EventNodeData extends Record<string, unknown> {
  label: string;
  transport: 'signal' | 'durable' | 'both';
  namespace?: string;
  description?: string;
}

const transportTone: Record<EventNodeData['transport'], string> = {
  signal: '#0ea5e9',   // blue
  durable: '#a855f7',  // purple
  both: '#10b981',     // green
};

export default function EventNode({ data, selected }: NodeProps) {
  const d = data as EventNodeData;
  const tone = transportTone[d.transport] ?? '#64748b';

  // The transport accent is data-driven, so it's handed to the stylesheet as
  // custom properties; everything else lives in `.rf-event-node`.
  const toneVars = { '--tone': tone, '--tone-ring': `${tone}33` } as CSSProperties;

  return (
    <div className={`rf-event-node${selected ? ' selected' : ''}`} style={toneVars}>
      <Handle type="target" position={Position.Left} />
      <div className="rf-node-kind">
        {d.transport}
        {d.namespace ? ` · ${d.namespace}` : null}
      </div>
      <div className="rf-node-label">{d.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
