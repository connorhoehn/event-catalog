"use strict";
// src/cli/commands/snapshot.ts
//
// wave24-a / contract-test rollout — `event-catalog snapshot` has two modes:
//
//   --catalog-url=<url> [--namespace=X]   live mode: GET /api/fingerprints
//   --from-source --declarations=<path>   offline mode: load a module that
//                                         exports declarations and compute
//                                         fingerprints locally
//
// Offline mode is what producer CI uses to generate
// `contracts/produced.snapshot.json` from the producer's own declaration
// module — no live catalog required, no network access required.
//
// The declarations module must export the declarations as **data**, not
// via side-effecting `catalog.declare(...)` calls. Three accepted shapes:
//
//   export const declarations: EventDeclaration[] = [...]
//   export default [ {...}, {...} ]
//   // OR pass the named export explicitly:
//   --export=<name>
//
// The chosen convention is "declarations as data" because importing a
// producer's runtime module would trigger boot-time side effects (env
// reads, DB connects). Producers ship a dedicated module — usually
// `event-declarations.ts` — alongside the runtime that wires those
// declarations into the catalog client.
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshot = snapshot;
const node_url_1 = require("node:url");
const node_path_1 = require("node:path");
const fingerprint_js_1 = require("../../registry/fingerprint.js");
async function snapshot(args) {
    const fromSource = args.includes('--from-source');
    if (fromSource) {
        return runFromSource(args);
    }
    return runFromCatalog(args);
}
async function runFromCatalog(args) {
    const url = getArg(args, 'catalog-url');
    if (!url) {
        console.error('usage: event-catalog snapshot --catalog-url=<url> [--namespace=X]');
        return 2;
    }
    const namespace = getArg(args, 'namespace');
    const ep = `${url.replace(/\/$/, '')}/api/fingerprints${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`;
    let res;
    try {
        res = await fetch(ep);
    }
    catch (err) {
        console.error(`event-catalog snapshot: fetch failed: ${err.message}`);
        return 1;
    }
    if (!res.ok) {
        console.error(`event-catalog snapshot: HTTP ${res.status}`);
        return 1;
    }
    const manifest = await res.json();
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
    return 0;
}
async function runFromSource(args) {
    const declarationsPath = getArg(args, 'declarations');
    if (!declarationsPath) {
        console.error('usage: event-catalog snapshot --from-source --declarations=<path> [--export=<name>] [--namespace=X]');
        return 2;
    }
    const absPath = (0, node_path_1.isAbsolute)(declarationsPath)
        ? declarationsPath
        : (0, node_path_1.resolve)(process.cwd(), declarationsPath);
    let mod;
    try {
        mod = (await import((0, node_url_1.pathToFileURL)(absPath).href));
    }
    catch (err) {
        console.error(`event-catalog snapshot: cannot load "${declarationsPath}": ${err.message}`);
        return 2;
    }
    const exportName = getArg(args, 'export');
    const declarations = extractDeclarations(mod, exportName);
    if (!declarations) {
        console.error(`event-catalog snapshot: could not find an EventDeclaration[] export in "${declarationsPath}". `
            + 'Expected `export const declarations = [...]`, `export default [...]`, '
            + 'or pass --export=<name> to select a named export.');
        return 2;
    }
    const namespaceFilter = getArg(args, 'namespace');
    const manifest = {};
    for (const decl of declarations) {
        if (!decl || typeof decl !== 'object' || typeof decl.name !== 'string' || !decl.schema) {
            console.error(`event-catalog snapshot: skipping malformed declaration: ${JSON.stringify(decl).slice(0, 120)}`);
            return 2;
        }
        if (namespaceFilter && decl.namespace && decl.namespace !== namespaceFilter)
            continue;
        manifest[decl.name] = (0, fingerprint_js_1.computeSchemaFingerprint)(decl.schema);
    }
    // Sort keys for stable diffs.
    const sorted = {};
    for (const k of Object.keys(manifest).sort())
        sorted[k] = manifest[k];
    process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
    return 0;
}
function extractDeclarations(mod, exportName) {
    if (exportName) {
        const candidate = mod[exportName];
        return isDeclarationArray(candidate) ? candidate : null;
    }
    // Probe common names in order.
    for (const name of ['declarations', 'default', 'eventDeclarations']) {
        const candidate = mod[name];
        if (isDeclarationArray(candidate))
            return candidate;
    }
    return null;
}
function isDeclarationArray(value) {
    return Array.isArray(value)
        && value.every((v) => v && typeof v === 'object' && typeof v.name === 'string');
}
function getArg(args, name) {
    for (const arg of args) {
        if (arg.startsWith(`--${name}=`))
            return arg.slice(name.length + 3);
    }
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1])
        return args[idx + 1];
    return undefined;
}
//# sourceMappingURL=snapshot.js.map