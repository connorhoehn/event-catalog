// src/server/routes/flow.ts
//
// Phase E8 — live flow tap (SSE). Subscribers stream every observed
// event publish through the catalog's MetricsObserver, optionally
// filtered. Sample knob (`?sample=N`) emits 1-in-N events for high-
// volume namespaces; default is unfiltered.

import type { Request, Response } from '../http-router.js';
import { tapEmitter, matchesTapFilter, type TapEvent, type TapFilter } from '../tap-emitter.js';
import { openSseStream, startSseHeartbeat, stringParam, type RoutesDeps } from './_shared.js';

/**
 * Narrow a raw `?transport=` value to the tap's transport union. Anything
 * else — an unknown value, or the repeated-key array form — yields
 * `undefined`, i.e. "no transport filter". This route documents an
 * unrecognized filter as ignored rather than rejected (unlike
 * `GET /api/events`), because an SSE client that mistypes a filter is
 * better served by an open stream than a 400 it never reads.
 */
function tapTransport(raw: string | string[] | undefined): TapFilter['transport'] {
  return raw === 'signal' || raw === 'durable' ? raw : undefined;
}

export function createFlowHandlers(_deps: RoutesDeps) {
  function stream(req: Request, res: Response): void {
    const filter: TapFilter = {
      eventName: stringParam(req, 'eventName'),
      transport: tapTransport(req.query.transport),
      producer: stringParam(req, 'producer'),
      namespace: stringParam(req, 'namespace'),
    };
    const sampleN = Math.max(1, parseInt(stringParam(req, 'sample') ?? '1', 10) || 1);

    openSseStream(res);

    // Opening comment lets clients know the stream is live even before
    // the first event arrives.
    res.write(`: connected; filter=${JSON.stringify(filter)}; sample=${sampleN}\n\n`);

    let counter = 0;
    const handler = (event: TapEvent): void => {
      if (!matchesTapFilter(event, filter)) return;
      counter += 1;
      if (counter % sampleN !== 0) return;
      // SSE frame; one event per data line.
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    tapEmitter.on('publish', handler);

    const heartbeat = startSseHeartbeat(res);

    req.on('close', () => {
      tapEmitter.off('publish', handler);
      clearInterval(heartbeat);
    });
  }

  return { stream };
}
