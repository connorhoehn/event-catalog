import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface EventNodeData extends Record<string, unknown> {
  label: string;
  transport: 'signal' | 'durable' | 'both';
  namespace?: string;
  description?: string;
}

// The accent paints both the left rule AND the 10px uppercase kind label, so
// it has to clear 4.5:1 against the node's white surface — the previous
// sky-500 / purple-500 / emerald-500 trio managed 2.8:1, 3.9:1 and 2.5:1, i.e.
// the word "signal" on a signal node was the least legible text in the app.
// These are the 700-weight equivalents: same hues, 5.9:1 / 7.0:1 / 7.1:1.
const transportTone: Record<EventNodeData['transport'], string> = {
  signal: '#0369a1',   // sky-700
  durable: '#7e22ce',  // purple-700
  both: '#047857',     // emerald-700
};

export default function EventNode({ data, selected }: NodeProps) {
  const d = data as EventNodeData;
  const tone = transportTone[d.transport] ?? '#64748b';

  // The transport accent is data-driven, so it's handed to the stylesheet as
  // custom properties; everything else lives in `.rf-event-node`.
  const toneVars = { '--tone': tone, '--tone-ring': `${tone}33` } as CSSProperties;

  return (
    // `data-transport` is what the stylesheet keys the non-colour cue off —
    // the left rule is solid for signal, double for durable — so the two node
    // kinds stay separable without relying on the blue/purple accent alone.
    <div
      className={`rf-event-node${selected ? ' selected' : ''}`}
      data-transport={d.transport}
      style={toneVars}
    >
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
