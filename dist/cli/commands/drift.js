"use strict";
// src/cli/commands/drift.ts
//
// wave24-a — `event-catalog drift --against=<file>` with two source modes
// for the "live" side:
//
//   --catalog-url=<url>          fetch /api/fingerprints from a running server
//   --registry-snapshot=<file>   read a committed snapshot file (offline)
//
// Offline mode is what producer CI uses: the shipped
// `contracts/registry.snapshot.json` in `@connorhoehn/event-catalog`
// is the authoritative side, the producer's snapshot is `--against`.
//
// Exits non-zero when any drift is detected.
Object.defineProperty(exports, "__esModule", { value: true });
exports.drift = drift;
const node_fs_1 = require("node:fs");
async function drift(args) {
    const url = getArg(args, 'catalog-url');
    const registrySnapshotFile = getArg(args, 'registry-snapshot');
    const against = getArg(args, 'against');
    if (!against || (!url && !registrySnapshotFile)) {
        console.error('usage: event-catalog drift --against=<snapshot.json> '
            + '(--catalog-url=<url> | --registry-snapshot=<file>)');
        return 2;
    }
    if (url && registrySnapshotFile) {
        console.error('event-catalog drift: pass only one of --catalog-url / --registry-snapshot');
        return 2;
    }
    let snapshot;
    try {
        snapshot = JSON.parse((0, node_fs_1.readFileSync)(against, 'utf8'));
    }
    catch (err) {
        console.error(`event-catalog drift: cannot read snapshot "${against}": ${err.message}`);
        return 2;
    }
    let live;
    if (url) {
        try {
            const res = await fetch(`${url.replace(/\/$/, '')}/api/fingerprints`);
            if (!res.ok) {
                console.error(`event-catalog drift: HTTP ${res.status}`);
                return 1;
            }
            live = (await res.json());
        }
        catch (err) {
            console.error(`event-catalog drift: fetch failed: ${err.message}`);
            return 1;
        }
    }
    else {
        try {
            live = JSON.parse((0, node_fs_1.readFileSync)(registrySnapshotFile, 'utf8'));
        }
        catch (err) {
            console.error(`event-catalog drift: cannot read registry snapshot "${registrySnapshotFile}": ${err.message}`);
            return 2;
        }
    }
    const added = [];
    const removed = [];
    const changed = [];
    for (const name of Object.keys(live)) {
        if (!(name in snapshot)) {
            added.push(name);
        }
        else if (snapshot[name] !== live[name]) {
            changed.push({ name, before: snapshot[name], after: live[name] });
        }
    }
    for (const name of Object.keys(snapshot)) {
        if (!(name in live))
            removed.push(name);
    }
    for (const n of added.sort())
        console.log(`+ ${n}`);
    for (const n of removed.sort())
        console.log(`- ${n}`);
    for (const c of changed.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`~ ${c.name}  ${c.before.slice(0, 12)}… → ${c.after.slice(0, 12)}…`);
    }
    console.log('');
    console.log(`${added.length} added, ${removed.length} removed, ${changed.length} changed`);
    return added.length + removed.length + changed.length === 0 ? 0 : 1;
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
//# sourceMappingURL=drift.js.map