// src/server/routes/subscribers.ts
//
// Subscriber registration (POST/DELETE /events/:name/subscribers/…)
// plus the wave24-b heartbeat surface that keeps `lastSeenAt` fresh
// and the roll-up listing used by "who's overdue?" dashboards.

import type { Request, Response } from '../http-router.js';
import { auditEmitter } from '../audit-emitter.js';
import { badRequest, eventNotFound, type RoutesDeps } from './_shared.js';

export function createSubscriberHandlers(deps: RoutesDeps) {
  const { registry, coordinator } = deps;

  // Register a subscriber for an event
  function add(req: Request, res: Response): void {
    const { serviceName } = req.body as { serviceName?: string };

    if (!serviceName) {
      badRequest(res, 'serviceName is required');
      return;
    }

    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }

    registry.addSubscriber(req.params.name, serviceName);
    auditEmitter.publish({
      kind: 'subscriber.added',
      timestamp: new Date().toISOString(),
      eventName: req.params.name,
      namespace: entry.namespace,
      serviceName,
    });
    coordinator?.broadcast('subscriber.add', { eventName: req.params.name, serviceName }).catch(() => {});
    res.status(201).json({ event: req.params.name, subscriber: serviceName });
  }

  // Remove a subscriber from an event
  function remove(req: Request, res: Response): void {
    const entry = registry.get(req.params.name);
    if (!entry) {
      eventNotFound(res, req.params.name);
      return;
    }

    registry.removeSubscriber(req.params.name, req.params.serviceName);
    auditEmitter.publish({
      kind: 'subscriber.removed',
      timestamp: new Date().toISOString(),
      eventName: req.params.name,
      namespace: entry.namespace,
      serviceName: req.params.serviceName,
    });
    coordinator?.broadcast('subscriber.remove', { eventName: req.params.name, serviceName: req.params.serviceName }).catch(() => {});
    res.json({ event: req.params.name, removedSubscriber: req.params.serviceName });
  }

  // wave24-b — refresh subscriber lastSeenAt timestamps. Body:
  //   { serviceName: 'svc-1', events?: ['a.x', 'b.y'] }
  // When `events` is omitted, refreshes every event the service is
  // currently subscribed to. Returns the events that were actually
  // refreshed (a service may have been pruned in the meantime).
  function heartbeat(req: Request, res: Response): void {
    const { serviceName, events } = req.body as { serviceName?: unknown; events?: unknown };
    if (typeof serviceName !== 'string' || serviceName.length === 0) {
      badRequest(res, 'serviceName is required');
      return;
    }
    const eventNames = Array.isArray(events) && events.every((e) => typeof e === 'string')
      ? (events as string[])
      : undefined;
    const refreshed = registry.heartbeat(serviceName, eventNames);
    res.json({ serviceName, refreshed, count: refreshed.length });
  }

  // wave24-b — list every subscriber + its lastSeenAt. Optional
  // `?staleAfter=<seconds>` filter returns only subscribers older
  // than the threshold (useful for "who's overdue?" dashboards).
  function list(req: Request, res: Response): void {
    const all = registry.listSubscriberHeartbeats();
    const staleAfter = parseInt(String(req.query.staleAfter ?? ''), 10);
    if (Number.isFinite(staleAfter) && staleAfter > 0) {
      const cutoff = Date.now() - staleAfter * 1000;
      const stale = all.filter((s) => Date.parse(s.lastSeenAt) < cutoff);
      res.json({ subscribers: stale, total: stale.length, filter: { staleAfter } });
      return;
    }
    res.json({ subscribers: all, total: all.length });
  }

  return { add, remove, heartbeat, list };
}
