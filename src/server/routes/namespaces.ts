// src/server/routes/namespaces.ts
//
// Phase E7 namespace surfaces (`/namespaces`, `/namespaces/summary`)
// plus the topology subgraph they share filter semantics with.

import type { Request, Response } from '../http-router.js';
import { stringParam, type RoutesDeps } from './_shared.js';

export function createNamespaceHandlers(deps: RoutesDeps) {
  const { registry } = deps;

  // Phase E7 — simple namespace list: {namespace, eventCount}[]. Lighter
  // than /namespaces/summary for callers that only need the count.
  function list(_req: Request, res: Response): void {
    const nsMap = new Map<string, number>();
    for (const entry of registry.list()) {
      nsMap.set(entry.namespace, (nsMap.get(entry.namespace) ?? 0) + 1);
    }
    const items = Array.from(nsMap.entries())
      .map(([namespace, eventCount]) => ({ namespace, eventCount }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
    res.json({ count: items.length, items });
  }

  // wave25-b — namespace browser. Returns one row per namespace with
  // event/producer/subscriber/deprecated counts and a transport split.
  // The admin UI's /namespaces page uses this for the at-a-glance grid.
  // ?detail=full also includes the per-namespace event list (name +
  // transport + deprecated bool) so a single round-trip powers the
  // drill-down view.
  function summary(req: Request, res: Response): void {
    const detail = req.query.detail === 'full';
    type Row = {
      namespace: string;
      eventCount: number;
      deprecatedCount: number;
      producerCount: number;
      subscriberCount: number;
      signalCount: number;
      durableCount: number;
      events?: Array<{ name: string; transport: string; version: number; deprecated: boolean }>;
    };
    const rows = new Map<string, Row & { producers: Set<string>; subscribers: Set<string> }>();
    for (const entry of registry.list()) {
      const ns = entry.namespace;
      let row = rows.get(ns);
      if (!row) {
        row = {
          namespace: ns,
          eventCount: 0,
          deprecatedCount: 0,
          producerCount: 0,
          subscriberCount: 0,
          signalCount: 0,
          durableCount: 0,
          producers: new Set<string>(),
          subscribers: new Set<string>(),
          ...(detail ? { events: [] as Row['events'] } : {}),
        };
        rows.set(ns, row);
      }
      row.eventCount += 1;
      if (entry.deprecation) row.deprecatedCount += 1;
      // transport:'both' fires on BOTH signal and durable, so it must
      // contribute to each count. Strict equality silently dropped it,
      // matching the same drift hazard fixed in metrics-observer
      // pollDurableStats (commit 5c5debc).
      if (entry.transport === 'signal' || entry.transport === 'both') row.signalCount += 1;
      if (entry.transport === 'durable' || entry.transport === 'both') row.durableCount += 1;
      const producers = Array.isArray(entry.producer) ? entry.producer : [entry.producer];
      for (const p of producers) row.producers.add(p);
      for (const s of entry.subscribers) row.subscribers.add(s);
      if (detail && row.events) {
        row.events.push({
          name: entry.name,
          transport: entry.transport,
          version: entry.version,
          deprecated: !!entry.deprecation,
        });
      }
    }
    const items = Array.from(rows.values())
      .map(r => ({
        namespace: r.namespace,
        eventCount: r.eventCount,
        deprecatedCount: r.deprecatedCount,
        producerCount: r.producers.size,
        subscriberCount: r.subscribers.size,
        signalCount: r.signalCount,
        durableCount: r.durableCount,
        ...(r.events ? { events: r.events.sort((a, b) => a.name.localeCompare(b.name)) } : {}),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
    res.json({ count: items.length, items });
  }

  // Topology graph — optional ?producer=, ?consumer=, ?eventType=, ?transport=
  // filters AND-combine to restrict which events (and induced services) appear
  // in the returned subgraph. No filter ⇒ full topology.
  function topology(req: Request, res: Response): void {
    const filter = {
      producer: stringParam(req, 'producer'),
      consumer: stringParam(req, 'consumer'),
      eventType: stringParam(req, 'eventType'),
      transport: stringParam(req, 'transport'),
      // Phase E7 — namespace filter on the topology subgraph.
      namespace: stringParam(req, 'namespace'),
    };
    const anyFilter =
      filter.producer || filter.consumer || filter.eventType || filter.transport || filter.namespace;
    res.json(registry.getTopology(anyFilter ? filter : undefined));
  }

  return { list, summary, topology };
}
