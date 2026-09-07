"use strict";
// src/server/routes/manifests.ts
//
// wave23-b — consumer manifest pinning. Consumers POST a list of
// events + fingerprints they depend on; the catalog stores per
// consumer and exposes a drift report comparing each pinned
// fingerprint to the current registry value.
//
// These routes are only mounted when `deps.manifestStore` is wired,
// hence the explicit non-optional store argument.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createManifestHandlers = createManifestHandlers;
const _shared_js_1 = require("./_shared.js");
function createManifestHandlers(deps, manifestStore) {
    const { registry } = deps;
    async function put(req, res) {
        const consumerName = req.params.consumerName;
        const events = req.body?.events;
        if (!Array.isArray(events)) {
            (0, _shared_js_1.badRequest)(res, 'body.events must be an array of { name, fingerprint }');
            return;
        }
        // Light shape check — every entry needs a string name + 64-char fingerprint.
        for (const [i, e] of events.entries()) {
            if (typeof e?.name !== 'string' || typeof e?.fingerprint !== 'string') {
                (0, _shared_js_1.badRequest)(res, `events[${i}]: name and fingerprint are required strings`);
                return;
            }
        }
        const stored = await manifestStore.put({ consumerName, events });
        res.status(201).json(stored);
    }
    async function list(_req, res) {
        const manifests = await manifestStore.list();
        res.json({ manifests, count: manifests.length });
    }
    async function get(req, res) {
        const m = await manifestStore.get(req.params.consumerName);
        if (!m) {
            res.status(404).json({ error: `No manifest pinned for consumer "${req.params.consumerName}"` });
            return;
        }
        res.json(m);
    }
    async function remove(req, res) {
        const removed = await manifestStore.remove(req.params.consumerName);
        if (!removed) {
            res.status(404).json({ error: `No manifest to remove for "${req.params.consumerName}"` });
            return;
        }
        res.json({ removed: req.params.consumerName });
    }
    async function checkAll(_req, res) {
        const fingerprints = new Map();
        for (const e of registry.list())
            fingerprints.set(e.name, e.schemaFingerprint);
        const reports = await manifestStore.driftReport(fingerprints);
        res.json({ reports });
    }
    return { put, list, get, remove, checkAll };
}
//# sourceMappingURL=manifests.js.map