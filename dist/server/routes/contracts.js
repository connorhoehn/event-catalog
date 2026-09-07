"use strict";
// src/server/routes/contracts.ts
//
// Contract-export + fingerprint surfaces: the AsyncAPI 3.0 document
// (wave24-c), the flat fingerprint manifest (Phase 21-e) and the
// server-side freshness comparator (Phase 21-g).
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContractHandlers = createContractHandlers;
const asyncapi_js_1 = require("../asyncapi.js");
const _shared_js_1 = require("./_shared.js");
const limits_js_1 = require("./limits.js");
function createContractHandlers(deps) {
    const { registry } = deps;
    // wave24-c — AsyncAPI 3.0 export. Generated from the registry on
    // demand; pairs with the existing OpenAPI spec for a complete
    // codegen-friendly contract surface. ?namespace= filter narrows
    // output to one domain.
    function asyncapi(req, res) {
        const namespace = (0, _shared_js_1.stringParam)(req, 'namespace');
        res.json((0, asyncapi_js_1.buildAsyncApiSpec)(registry, { namespace }));
    }
    // Phase 21-e — flat fingerprint manifest. Returns
    // `{ <eventName>: <schemaFingerprint> }` for every declared event
    // (or every event in a namespace when filtered). Designed for CI:
    //   $ curl /api/fingerprints > current.json
    //   $ diff snapshot.json current.json   # → see schema changes
    // Cheaper than GET /api/events when callers only need fingerprints.
    function fingerprints(req, res) {
        const namespace = (0, _shared_js_1.stringParam)(req, 'namespace');
        const entries = registry.list(namespace ? { namespace } : undefined);
        // Null-prototype: an event named `__proto__` assigned into a plain
        // `{}` hits the prototype setter, so the entry silently vanished
        // from the manifest CI diffs against.
        const manifest = (0, limits_js_1.keySafeRecord)();
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
    function freshness(req, res) {
        const events = (0, _shared_js_1.jsonBody)(req)?.events;
        if (!Array.isArray(events)) {
            (0, _shared_js_1.badRequest)(res, 'body.events must be an array of { name, fingerprint }');
            return;
        }
        if (!(0, limits_js_1.withinArrayLimit)(res, events, limits_js_1.MAX_FRESHNESS_EVENTS, 'body.events'))
            return;
        const reports = events.map((evt) => {
            const name = typeof evt?.name === 'string' ? evt.name : null;
            const localFp = typeof evt?.fingerprint === 'string' ? evt.fingerprint : null;
            if (!name || !localFp) {
                return {
                    name: name ?? '',
                    status: 'invalid',
                    error: 'each event needs a string name + fingerprint',
                };
            }
            const entry = registry.get(name);
            const remoteFp = entry?.schemaFingerprint ?? null;
            const status = remoteFp === null
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
//# sourceMappingURL=contracts.js.map