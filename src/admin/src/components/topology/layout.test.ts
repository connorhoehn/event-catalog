// dagre layout. Cheap to test, and the failure mode is a graph where every
// node sits on top of every other one — which still "renders".

import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { layoutGraph } from './layout';

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} });
const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target });

describe('layoutGraph', () => {
  it('replaces the placeholder positions every node arrives with', () => {
    // Nodes come in at {0,0} and must not leave that way — the failure mode
    // is a graph where every node is stacked on the origin.
    const out = layoutGraph([node('a'), node('b')], [edge('a', 'b')]);
    expect(out.map((n) => n.position)).not.toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(out.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
  });

  it('gives connected nodes distinct positions instead of stacking them', () => {
    const out = layoutGraph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    const seen = new Set(out.map((n) => `${n.position.x},${n.position.y}`));
    expect(seen.size).toBe(3);
  });

  it('flows left-to-right: a producer sits left of the event it publishes', () => {
    // rankdir LR is the whole visual grammar of the view — a producer on the
    // right of its event reads as a consumer.
    const out = layoutGraph(
      [node('platform-api'), node('call:caption:line'), node('worker')],
      [edge('platform-api', 'call:caption:line'), edge('call:caption:line', 'worker')],
    );
    const x = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(x['platform-api']).toBeLessThan(x['call:caption:line']!);
    expect(x['call:caption:line']).toBeLessThan(x['worker']!);
  });

  it('lays out isolated nodes without dropping them', () => {
    // An event nobody publishes or subscribes to is exactly what the catalog
    // exists to surface, so it must not fall out of the graph.
    const out = layoutGraph([node('a'), node('orphan')], []);
    expect(out.map((n) => n.id)).toEqual(['a', 'orphan']);
    expect(Number.isFinite(out[1]!.position.x)).toBe(true);
  });

  it('preserves node identity, type and data', () => {
    const input: Node[] = [{ id: 'a', type: 'event', position: { x: 0, y: 0 }, data: { label: 'a' } }];
    const [out] = layoutGraph(input, []);
    expect(out!.type).toBe('event');
    expect(out!.data).toEqual({ label: 'a' });
  });

  it('is deterministic — the same graph lays out the same way twice', () => {
    // The view re-derives the layout on every topology poll; a nondeterministic
    // engine would make the graph jump on its own every few seconds.
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('a', 'c')];
    expect(layoutGraph(nodes, edges).map((n) => n.position)).toEqual(
      layoutGraph(nodes, edges).map((n) => n.position),
    );
  });

  it('survives a cycle rather than hanging or throwing', () => {
    // Two services that both publish and subscribe to each other's events is
    // a legal topology.
    const out = layoutGraph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    expect(out).toHaveLength(2);
  });

  it('honours a custom node size when spacing ranks', () => {
    const gap = (nodeWidth: number) => {
      const out = layoutGraph([node('a'), node('b')], [edge('a', 'b')], { nodeWidth });
      return out[1]!.position.x - out[0]!.position.x;
    };
    // Wider nodes have to be pushed further apart, or they overlap.
    expect(gap(400)).toBeGreaterThan(gap(100));
  });
});
