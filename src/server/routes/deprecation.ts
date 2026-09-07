// src/server/routes/deprecation.ts
//
// wave25-a — schema deprecation lifecycle, plus the wave26-f bulk
// variant.
//
// POST /api/events/:name/deprecate { reason?, by? }  → mark deprecated
// DELETE /api/events/:name/deprecate                 → unmark
// GET /api/deprecated                                → list deprecated
// POST /api/events/bulk/deprecate                    → mark many
//
// Deprecation is non-blocking: existing producers continue to publish
// (avoid surprise outages). Consumers see the chip in admin UI;
// catalog.publish() logs a one-time warn if warnOnDeprecated is on.

import type { Request, Response } from '../http-router.js';
import { auditEmitter } from '../audit-emitter.js';
import { badRequest, type RoutesDeps } from './_shared.js';
import { MAX_BULK_DEPRECATE_NAMES, withinArrayLimit } from './limits.js';

export function createDeprecationHandlers(deps: RoutesDeps) {
  const { registry, coordinator } = deps;

  function deprecate(req: Request, res: Response): void {
    const body = (req.body ?? {}) as { reason?: string; by?: string };
    const ok = registry.deprecate(req.params.name, { reason: body.reason, by: body.by });
    if (!ok) {
      res.status(404).json({ error: `Event "${req.params.name}" not found` });
      return;
    }
    const entry = registry.get(req.params.name)!;
    auditEmitter.publish({
      kind: 'event.deprecated',
      timestamp: new Date().toISOString(),
      eventName: entry.name,
      namespace: entry.namespace,
      reason: body.reason,
      by: body.by,
    });
    coordinator?.broadcast('deprecate', { name: req.params.name, opts: { reason: body.reason, by: body.by } }).catch(() => {});
    res.json({ deprecated: entry.name, deprecation: entry.deprecation });
  }

  function undeprecate(req: Request, res: Response): void {
    const ok = registry.undeprecate(req.params.name);
    if (!ok) {
      res.status(404).json({ error: `Event "${req.params.name}" was not deprecated or does not exist` });
      return;
    }
    const entry = registry.get(req.params.name)!;
    auditEmitter.publish({
      kind: 'event.undeprecated',
      timestamp: new Date().toISOString(),
      eventName: entry.name,
      namespace: entry.namespace,
    });
    coordinator?.broadcast('undeprecate', { name: req.params.name }).catch(() => {});
    res.json({ undeprecated: entry.name });
  }

  function list(_req: Request, res: Response): void {
    const items = registry.listDeprecated().map(e => ({
      name: e.name,
      namespace: e.namespace,
      transport: e.transport,
      version: e.version,
      deprecation: e.deprecation,
    }));
    res.json({ count: items.length, items });
  }

  // wave26-f — bulk deprecate N events with a shared reason
  function deprecateBulk(req: Request, res: Response): void {
    const { names, reason, by } = req.body as {
      names?: string[];
      reason?: string;
      by?: string;
    };

    if (!Array.isArray(names) || names.length === 0) {
      badRequest(res, 'names[] is required and must be non-empty');
      return;
    }
    // Each name is a registry mutation + an audit emit + a Redis
    // broadcast; bound how many one request can trigger.
    if (!withinArrayLimit(res, names, MAX_BULK_DEPRECATE_NAMES, 'names')) return;

    const deprecated: string[] = [];
    const notFound: string[] = [];
    const ts = new Date().toISOString();

    for (const name of names) {
      const ok = registry.deprecate(name, { reason, by });
      if (!ok) {
        notFound.push(name);
        continue;
      }
      const entry = registry.get(name);
      if (entry) {
        auditEmitter.publish({
          kind: 'event.deprecated',
          timestamp: ts,
          eventName: entry.name,
          namespace: entry.namespace,
          version: entry.version,
          reason,
          by,
        });
      }
      // wave26-d — broadcast to peer replicas.
      coordinator?.broadcast('deprecate', { name, opts: { reason, by } }).catch(() => {});
      deprecated.push(name);
    }

    res.status(notFound.length > 0 && deprecated.length === 0 ? 400 : 200).json({
      deprecated,
      notFound,
      total: deprecated.length,
    });
  }

  return { deprecate, undeprecate, list, deprecateBulk };
}
