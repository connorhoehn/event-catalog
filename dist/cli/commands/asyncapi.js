"use strict";
// src/cli/commands/asyncapi.ts
//
// wave25-c — `event-catalog asyncapi --catalog-url=<url> [--output=file.json]
//                                    [--title=T] [--version=V] [--namespace=ns]`
//
// Fetches the wave24-c AsyncAPI 3.0 spec and either writes it to a
// file or echoes it to stdout. Use case: CI step that regenerates
// asyncapi.json on every catalog change so docs stay in sync.
//
// Examples:
//   event-catalog asyncapi --catalog-url=https://catalog > asyncapi.json
//   event-catalog asyncapi --catalog-url=https://catalog --output=asyncapi.json
//   event-catalog asyncapi --catalog-url=https://catalog --namespace=auth
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncapi = asyncapi;
const node_fs_1 = require("node:fs");
async function asyncapi(args) {
    const url = getArg(args, 'catalog-url');
    const output = getArg(args, 'output');
    const title = getArg(args, 'title');
    const version = getArg(args, 'version');
    const namespace = getArg(args, 'namespace');
    if (!url) {
        console.error('usage: event-catalog asyncapi --catalog-url=<url> [--output=file] [--title=T] [--version=V] [--namespace=ns]');
        return 2;
    }
    const params = new URLSearchParams();
    if (title)
        params.set('title', title);
    if (version)
        params.set('version', version);
    if (namespace)
        params.set('namespace', namespace);
    const qs = params.toString();
    const ep = `${url.replace(/\/$/, '')}/api/asyncapi${qs ? `?${qs}` : ''}`;
    let res;
    try {
        res = await fetch(ep);
    }
    catch (err) {
        console.error(`event-catalog asyncapi: fetch failed: ${err.message}`);
        return 1;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`event-catalog asyncapi: HTTP ${res.status}: ${body.slice(0, 200)}`);
        return 1;
    }
    const spec = await res.text();
    if (output) {
        try {
            (0, node_fs_1.writeFileSync)(output, spec);
            console.error(`event-catalog asyncapi: wrote ${spec.length} bytes to ${output}`);
        }
        catch (err) {
            console.error(`event-catalog asyncapi: write failed: ${err.message}`);
            return 1;
        }
    }
    else {
        process.stdout.write(spec);
    }
    return 0;
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
//# sourceMappingURL=asyncapi.js.map