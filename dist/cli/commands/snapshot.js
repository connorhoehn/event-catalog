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
exports.SNAPSHOT_HELP = void 0;
exports.snapshot = snapshot;
const node_url_1 = require("node:url");
const node_path_1 = require("node:path");
const fingerprint_js_1 = require("../../registry/fingerprint.js");
const _args_js_1 = require("../_args.js");
const BIN = 'event-catalog snapshot';
const USAGE_LIVE = 'event-catalog snapshot --catalog-url=<url> [--namespace=X]';
const USAGE_SOURCE = 'event-catalog snapshot --from-source --declarations=<path> [--export=<name>] [--namespace=X]';
exports.SNAPSHOT_HELP = `
event-catalog snapshot — emit a {event: fingerprint} manifest on stdout

USAGE
  ${USAGE_LIVE}
  ${USAGE_SOURCE}

OPTIONS
  --catalog-url=<url>     Live mode: GET <url>/api/fingerprints
  --from-source           Offline mode: fingerprint a local declarations module
  --declarations=<path>   Offline mode: path to the declarations module (required)
  --export=<name>         Offline mode: named export holding EventDeclaration[]
                          (default: probes declarations, default, eventDeclarations)
  --namespace=<ns>        Only include events in this namespace
  --help, -h              Show this help

EXIT CODES
  0   Manifest written to stdout
  1   Catalog unreachable or returned a non-2xx / non-JSON response
  2   Usage error, unloadable declarations module, or malformed declaration

EXAMPLES
  event-catalog snapshot --catalog-url=https://catalog > snapshot.json
  event-catalog snapshot --from-source --declarations=src/event-declarations.js
`.trim();
const SPEC = {
    value: ['catalog-url', 'namespace', 'declarations', 'export'],
    boolean: ['from-source'],
};
async function snapshot(args) {
    const parsed = (0, _args_js_1.parseFlags)(args, SPEC);
    if (!parsed.ok)
        return (0, _args_js_1.usageError)(BIN, parsed.error, USAGE_LIVE);
    if (parsed.args.help) {
        console.log(exports.SNAPSHOT_HELP);
        return 0;
    }
    const { positional, values, flags } = parsed.args;
    if (positional.length > 0) {
        return (0, _args_js_1.usageError)(BIN, `unexpected argument "${positional[0]}" — snapshot takes flags only`, USAGE_LIVE);
    }
    return flags.has('from-source') ? runFromSource(values) : runFromCatalog(values);
}
async function runFromCatalog(values) {
    const url = values['catalog-url'];
    if (!url) {
        return (0, _args_js_1.usageError)(BIN, '--catalog-url is required (or use --from-source)', USAGE_LIVE);
    }
    const namespace = values['namespace'];
    const ep = `${url.replace(/\/$/, '')}/api/fingerprints${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`;
    let res;
    try {
        res = await fetch(ep);
    }
    catch (err) {
        console.error(`${BIN}: fetch failed: ${(0, _args_js_1.formatError)(err)}`);
        return 1;
    }
    if (!res.ok) {
        console.error(`${BIN}: HTTP ${res.status} from ${ep}`);
        return 1;
    }
    const body = await (0, _args_js_1.readJsonResponse)(res, ep);
    if (!body.ok) {
        console.error(`${BIN}: ${body.error}`);
        return 1;
    }
    process.stdout.write(JSON.stringify(body.value, null, 2) + '\n');
    return 0;
}
async function runFromSource(values) {
    const declarationsPath = values['declarations'];
    if (!declarationsPath) {
        return (0, _args_js_1.usageError)(BIN, '--declarations=<path> is required with --from-source', USAGE_SOURCE);
    }
    const absPath = (0, node_path_1.isAbsolute)(declarationsPath)
        ? declarationsPath
        : (0, node_path_1.resolve)(process.cwd(), declarationsPath);
    let mod;
    try {
        mod = (await import((0, node_url_1.pathToFileURL)(absPath).href));
    }
    catch (err) {
        console.error(`${BIN}: cannot load "${declarationsPath}": ${(0, _args_js_1.formatError)(err)}`);
        return 2;
    }
    const exportName = values['export'];
    const declarations = extractDeclarations(mod, exportName);
    if (!declarations) {
        console.error(`${BIN}: could not find an EventDeclaration[] export in "${declarationsPath}". `
            + 'Expected `export const declarations = [...]`, `export default [...]`, '
            + 'or pass --export=<name> to select a named export.');
        return 2;
    }
    const namespaceFilter = values['namespace'];
    const manifest = {};
    for (const decl of declarations) {
        if (!decl || typeof decl !== 'object' || typeof decl.name !== 'string' || !decl.schema) {
            console.error(`${BIN}: skipping malformed declaration: ${JSON.stringify(decl).slice(0, 120)}`);
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
//# sourceMappingURL=snapshot.js.map