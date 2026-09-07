// src/server/routes/audit.ts
//
// wave22-d — registry-mutation audit SSE. Mirror of /api/flow for
// the slow path: every time the registry mutates (declare, version-
// bump, removal, subscriber add/remove), a structured AuditEvent
// is streamed to subscribers. Powers admin UI "registry changes"
// panels and live audit dashboards.

import type { Request, Response } from '../http-router.js';
import {
  auditEmitter,
  matchesAuditFilter,
  type AuditEvent,
  type AuditEventKind,
  type AuditFilter,
} from '../audit-emitter.js';
import { openSseStream, startSseHeartbeat, stringParam, type RoutesDeps } from './_shared.js';

/** The full AuditEventKind union, as a runtime value for `?kind=` narrowing. */
const AUDIT_KINDS: readonly AuditEventKind[] = [
  'event.declared',
  'event.version.bumped',
  'event.removed',
  'event.deprecated',
  'event.undeprecated',
  'event.poisoned',
  'event.poison.cleared',
  'subscriber.added',
  'subscriber.removed',
  'event.manifest.drift',
];

/**
 * Narrow a raw `?kind=` value to AuditEventKind. Previously this was a bare
 * `as` cast, so `?kind=typo` produced a filter matching nothing and the
 * stream looked permanently idle. An unrecognized kind is now no filter at
 * all — same "an SSE client should get a stream, not a 400" call as
 * /api/flow's transport filter.
 */
function auditKind(raw: string | string[] | undefined): AuditEventKind | undefined {
  return AUDIT_KINDS.find(k => k === raw);
}

export function createAuditHandlers(deps: RoutesDeps) {
  const { auditLog } = deps;

  async function stream(req: Request, res: Response): Promise<void> {
    const filter: AuditFilter = {
      kind: auditKind(req.query.kind),
      eventName: stringParam(req, 'eventName'),
      namespace: stringParam(req, 'namespace'),
      serviceName: stringParam(req, 'serviceName'),
    };
    // wave23-a — replay-on-connect knob. ?replay=N reads the last N
    // events from the persistent log and writes them as SSE frames
    // before streaming live. Default 0 (no replay) for back-compat.
    const replayN = Math.max(0, parseInt(stringParam(req, 'replay') ?? '0', 10) || 0);

    openSseStream(res);
    res.write(`: connected; filter=${JSON.stringify(filter)}; replay=${replayN}\n\n`);

    // Replay history first when an audit log is wired and the caller
    // asked for it. Skipped if disconnected mid-replay.
    if (replayN > 0 && auditLog) {
      try {
        const history = await auditLog.recent(replayN);
        for (const event of history) {
          if (matchesAuditFilter(event, filter)) {
            res.write(`data: ${JSON.stringify({ ...event, _replay: true })}\n\n`);
          }
        }
      } catch {
        // Log read failed — keep the live stream open anyway.
      }
    }

    const handler = (event: AuditEvent): void => {
      if (!matchesAuditFilter(event, filter)) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    auditEmitter.on('audit', handler);

    const heartbeat = startSseHeartbeat(res);

    req.on('close', () => {
      auditEmitter.off('audit', handler);
      clearInterval(heartbeat);
    });
  }

  // wave23-a — query the persistent audit log without subscribing
  // to live SSE. Useful for one-off lookups + the admin UI's initial
  // render (avoids a slow-to-paint blank panel).
  async function recent(req: Request, res: Response): Promise<void> {
    if (!auditLog) {
      res.json({ events: [], note: 'no persistent audit log wired' });
      return;
    }
    const limit = Math.max(1, parseInt(stringParam(req, 'limit') ?? '50', 10) || 50);
    const events = await auditLog.recent(limit);
    res.json({ events });
  }

  return { stream, recent };
}
