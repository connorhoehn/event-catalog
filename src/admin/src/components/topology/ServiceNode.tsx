import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ServiceNodeData extends Record<string, unknown> {
  label: string;
  role?: 'producer' | 'consumer' | 'both';
}

export default function ServiceNode({ data, selected }: NodeProps) {
  const d = data as ServiceNodeData;

  return (
    <div className={`rf-service-node${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="rf-node-kind">
        service{d.role ? ` · ${d.role}` : ''}
      </div>
      <div className="rf-node-label">{d.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
