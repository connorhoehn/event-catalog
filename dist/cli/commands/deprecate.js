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
exports.UNDEPRECATE_HELP = exports.DEPRECATE_HELP = void 0;
exports.deprecate = deprecate;
exports.undeprecate = undeprecate;
const _args_js_1 = require("../_args.js");
const BIN_DEP = 'event-catalog deprecate';
const BIN_UNDEP = 'event-catalog undeprecate';
const USAGE_DEP = 'event-catalog deprecate <name> --catalog-url=<url> [--reason=...] [--by=...]';
const USAGE_UNDEP = 'event-catalog undeprecate <name> --catalog-url=<url>';
exports.DEPRECATE_HELP = `
event-catalog deprecate — mark a declared event as deprecated in the catalog

USAGE
  ${USAGE_DEP}

ARGUMENTS
  <name>                Event name to deprecate (required)
  --catalog-url=<url>   Catalog base URL (required)
  --reason=<text>       Why it is being retired, stored with the record
  --by=<who>            Who retired it (user or bot identity)
  --help, -h            Show this help

EXIT CODES
  0   Event deprecated
  1   Catalog unreachable or returned a non-2xx response
  2   Usage error
`.trim();
exports.UNDEPRECATE_HELP = `
event-catalog undeprecate — clear the deprecation flag on an event

USAGE
  ${USAGE_UNDEP}

ARGUMENTS
  <name>                Event name to un-deprecate (required)
  --catalog-url=<url>   Catalog base URL (required)
  --help, -h            Show this help

EXIT CODES
  0   Deprecation cleared
  1   Catalog unreachable or returned a non-2xx response
  2   Usage error
`.trim();
const DEP_SPEC = { value: ['catalog-url', 'reason', 'by'] };
const UNDEP_SPEC = { value: ['catalog-url'] };
async function deprecate(args) {
    const parsed = (0, _args_js_1.parseFlags)(args, DEP_SPEC);
    if (!parsed.ok)
        return (0, _args_js_1.usageError)(BIN_DEP, parsed.error, USAGE_DEP);
    if (parsed.args.help) {
        console.log(exports.DEPRECATE_HELP);
        return 0;
    }
    const { positional, values } = parsed.args;
    const name = positional[0];
    if (!name) {
        return (0, _args_js_1.usageError)(BIN_DEP, 'an event name is required', USAGE_DEP);
    }
    if (positional.length > 1) {
        return (0, _args_js_1.usageError)(BIN_DEP, `unexpected extra argument "${positional[1]}" — deprecate takes one event name`, USAGE_DEP);
    }
    const url = values['catalog-url'];
    if (!url) {
        return (0, _args_js_1.usageError)(BIN_DEP, '--catalog-url is required', USAGE_DEP);
    }
    const ep = `${url.replace(/\/$/, '')}/api/events/${encodeURIComponent(name)}/deprecate`;
    let res;
    try {
        res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: values['reason'], by: values['by'] }),
        });
    }
    catch (err) {
        console.error(`${BIN_DEP}: fetch failed: ${(0, _args_js_1.formatError)(err)}`);
        return 1;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`${BIN_DEP}: HTTP ${res.status}: ${body.slice(0, 200)}`);
        return 1;
    }
    // The server normally echoes {deprecation: {deprecatedAt}}. Don't let a
    // thinner-than-expected body turn a successful call into a crash.
    const stored = await (0, _args_js_1.readJsonResponse)(res, ep);
    const deprecatedAt = stored.ok && stored.value && typeof stored.value === 'object'
        ? stored.value.deprecation?.deprecatedAt
        : undefined;
    console.log(`deprecated "${name}"`
        + (typeof deprecatedAt === 'string' ? ` (deprecatedAt=${deprecatedAt})` : ''));
    return 0;
}
async function undeprecate(args) {
    const parsed = (0, _args_js_1.parseFlags)(args, UNDEP_SPEC);
    if (!parsed.ok)
        return (0, _args_js_1.usageError)(BIN_UNDEP, parsed.error, USAGE_UNDEP);
    if (parsed.args.help) {
        console.log(exports.UNDEPRECATE_HELP);
        return 0;
    }
    const { positional, values } = parsed.args;
    const name = positional[0];
    if (!name) {
        return (0, _args_js_1.usageError)(BIN_UNDEP, 'an event name is required', USAGE_UNDEP);
    }
    if (positional.length > 1) {
        return (0, _args_js_1.usageError)(BIN_UNDEP, `unexpected extra argument "${positional[1]}" — undeprecate takes one event name`, USAGE_UNDEP);
    }
    const url = values['catalog-url'];
    if (!url) {
        return (0, _args_js_1.usageError)(BIN_UNDEP, '--catalog-url is required', USAGE_UNDEP);
    }
    const ep = `${url.replace(/\/$/, '')}/api/events/${encodeURIComponent(name)}/deprecate`;
    let res;
    try {
        res = await fetch(ep, { method: 'DELETE' });
    }
    catch (err) {
        console.error(`${BIN_UNDEP}: fetch failed: ${(0, _args_js_1.formatError)(err)}`);
        return 1;
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`${BIN_UNDEP}: HTTP ${res.status}: ${body.slice(0, 200)}`);
        return 1;
    }
    console.log(`undeprecated "${name}"`);
    return 0;
}
//# sourceMappingURL=deprecate.js.map