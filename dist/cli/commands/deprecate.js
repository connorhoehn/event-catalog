"use strict";
// src/cli/commands/deprecate.ts
//
// wave25-c — `event-catalog deprecate <name> --catalog-url=<url> [--reason=...] [--by=...]`
// and    — `event-catalog undeprecate <name> --catalog-url=<url>`
//
// Thin HTTP wrappers around the wave25-a /api/events/:name/deprecate
// surface. Pairs with the deprecation lifecycle so a CI step can
// retire an event when its replacement ships:
//
//   event-catalog deprecate auth.legacy.login \
//     --catalog-url=https://catalog \
//     --reason="replaced by auth.login (2026-06)" \
//     --by="release-bot"
Object.defineProperty(exports, "__esModule", { value: true });
exports.deprecate = deprecate;
exports.undeprecate = undeprecate;
async function deprecate(args) {
    const name = args[0];
    if (!name || name.startsWith('--')) {
        console.error('usage: event-catalog deprecate <name> --catalog-url=<url> [--reason=...] [--by=...]');
        return 2;
    }
    const rest = args.slice(1);
    const url = getArg(rest, 'catalog-url');
    const reason = getArg(rest, 'reason');
    const by = getArg(rest, 'by');
    if (!url) {
        console.error('event-catalog deprecate: --catalog-url is required');
        return 2;
    }
    const ep = `${url.replace(/\/$/, '')}/api/events/${encodeURIComponent(name)}/deprecate`;
    let res;
    try {
        res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, by }),
        });
    }
    catch (err) {
        console.error(`event-catalog deprecate: fetch failed: ${err.message}`);
        return 1;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`event-catalog deprecate: HTTP ${res.status}: ${body.slice(0, 200)}`);
        return 1;
    }
    const stored = await res.json();
    console.log(`deprecated "${name}" (deprecatedAt=${stored.deprecation.deprecatedAt})`);
    return 0;
}
async function undeprecate(args) {
    const name = args[0];
    if (!name || name.startsWith('--')) {
        console.error('usage: event-catalog undeprecate <name> --catalog-url=<url>');
        return 2;
    }
    const rest = args.slice(1);
    const url = getArg(rest, 'catalog-url');
    if (!url) {
        console.error('event-catalog undeprecate: --catalog-url is required');
        return 2;
    }
    const ep = `${url.replace(/\/$/, '')}/api/events/${encodeURIComponent(name)}/deprecate`;
    let res;
    try {
        res = await fetch(ep, { method: 'DELETE' });
    }
    catch (err) {
        console.error(`event-catalog undeprecate: fetch failed: ${err.message}`);
        return 1;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`event-catalog undeprecate: HTTP ${res.status}: ${body.slice(0, 200)}`);
        return 1;
    }
    console.log(`undeprecated "${name}"`);
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
//# sourceMappingURL=deprecate.js.map