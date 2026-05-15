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

  return (
    <div
      style={{
        background: '#ffffff',
        border: `2px solid ${selected ? tone : '#cbd5e1'}`,
        borderLeft: `5px solid ${tone}`,
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 180,
        boxShadow: selected ? `0 0 0 3px ${tone}33` : '0 1px 2px rgba(15,23,42,.05)',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: tone }} />
      <div style={{ fontSize: 10, color: tone, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {d.transport}
        {d.namespace ? ` · ${d.namespace}` : null}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginTop: 2 }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: tone }} />
    </div>
  );
}
