// src/server/routes/contracts.ts
//
// Contract-export + fingerprint surfaces: the AsyncAPI 3.0 document
// (wave24-c), the flat fingerprint manifest (Phase 21-e) and the
// server-side freshness comparator (Phase 21-g).

import type { Request, Response } from '../http-router.js';
import { buildAsyncApiSpec } from '../asyncapi.js';
import { badRequest, jsonBody, stringParam, type RoutesDeps } from './_shared.js';

export function createContractHandlers(deps: RoutesDeps) {
  const { registry } = deps;

  // wave24-c — AsyncAPI 3.0 export. Generated from the registry on
  // demand; pairs with the existing OpenAPI spec for a complete
  // codegen-friendly contract surface. ?namespace= filter narrows
  // output to one domain.
  function asyncapi(req: Request, res: Response): void {
    const namespace = stringParam(req, 'namespace');
    res.json(buildAsyncApiSpec(registry, { namespace }));
  }

  // Phase 21-e — flat fingerprint manifest. Returns
  // `{ <eventName>: <schemaFingerprint> }` for every declared event
  // (or every event in a namespace when filtered). Designed for CI:
  //   $ curl /api/fingerprints > current.json
  //   $ diff snapshot.json current.json   # → see schema changes
  // Cheaper than GET /api/events when callers only need fingerprints.
  function fingerprints(req: Request, res: Response): void {
    const namespace = stringParam(req, 'namespace');
    const entries = registry.list(namespace ? { namespace } : undefined);
    const manifest: Record<string, string> = {};
    for (const e of entries) {
      manifest[e.name] = e.schemaFingerprint;
    }
    res.json(manifest);
  }

  // Phase 21-g — server-side freshness comparator. Mirror of the
  // client-side `catalog.checkAllSchemaFreshness()` helper for thin
  // consumers (lambdas, batch jobs, sidecars) that don't want to
  // instantiate the full EventCatalog client just to detect drift.
  //
  //   POST /api/freshness
  //   { "events": [
  //       { "name": "pipeline.run.started", "fingerprint": "abc..." },
  //       { "name": "missing.event",        "fingerprint": "xyz..." }
  //   ] }
  //
  //   → 200 OK
  //   { "reports": [
  //       { "name": "pipeline.run.started", "status": "fresh", "localFingerprint": "abc...", "remoteFingerprint": "abc..." },
  //       { "name": "missing.event",        "status": "unknown", "localFingerprint": "xyz...", "remoteFingerprint": null }
  //   ] }
  function freshness(req: Request, res: Response): void {
    const events = jsonBody(req)?.events;
    if (!Array.isArray(events)) {
      badRequest(res, 'body.events must be an array of { name, fingerprint }');
      return;
    }
    const reports = events.map((evt: { name?: unknown; fingerprint?: unknown }) => {
      const name = typeof evt?.name === 'string' ? evt.name : null;
      const localFp = typeof evt?.fingerprint === 'string' ? evt.fingerprint : null;
      if (!name || !localFp) {
        return {
          name: name ?? '',
          status: 'invalid' as const,
          error: 'each event needs a string name + fingerprint',
        };
      }
      const entry = registry.get(name);
      const remoteFp = entry?.schemaFingerprint ?? null;
      const status: 'fresh' | 'stale' | 'unknown' = remoteFp === null
        ? 'unknown'
        : remoteFp === localFp
          ? 'fresh'
          : 'stale';
      return {
        name,
        status,
        localFingerprint: localFp,
        remoteFingerprint: remoteFp,
      };
    });
    res.json({ reports });
  }

  return { asyncapi, fingerprints, freshness };
}
