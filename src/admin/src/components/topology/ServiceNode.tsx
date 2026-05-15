import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ServiceNodeData extends Record<string, unknown> {
  label: string;
  role?: 'producer' | 'consumer' | 'both';
}

export default function ServiceNode({ data, selected }: NodeProps) {
  const d = data as ServiceNodeData;
  const accent = '#475569';

  return (
    <div
      style={{
        background: '#f8fafc',
        border: `2px solid ${selected ? accent : '#94a3b8'}`,
        borderRadius: 999,
        padding: '10px 16px',
        minWidth: 160,
        textAlign: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        boxShadow: selected ? `0 0 0 3px ${accent}22` : '0 1px 2px rgba(15,23,42,.05)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent }} />
      <div style={{ fontSize: 10, color: accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        service{d.role ? ` · ${d.role}` : ''}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{d.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: accent }} />
    </div>
  );
}
