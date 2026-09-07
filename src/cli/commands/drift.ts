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

import { formatError, parseFlags, readFingerprintMap, readJsonResponse, usageError } from '../_args.js';

interface Manifest {
  [eventName: string]: string;
}

const BIN = 'event-catalog drift';
const USAGE = 'event-catalog drift --against=<snapshot.json> (--catalog-url=<url> | --registry-snapshot=<file>)';

export const DRIFT_HELP = `
event-catalog drift — compare a fingerprint snapshot against the live registry

USAGE
  ${USAGE}

OPTIONS
  --against=<file>            Snapshot to check (required)
  --catalog-url=<url>         Compare against a live catalog's /api/fingerprints
  --registry-snapshot=<file>  Compare against a committed registry snapshot
                              (exactly one of the two sources is required)
  --help, -h                  Show this help

EXIT CODES
  0   No drift
  1   Drift detected, or the catalog was unreachable / returned non-2xx
  2   Usage error or an unreadable / malformed snapshot file

EXAMPLES
  event-catalog drift --catalog-url=https://catalog --against=snapshot.json
  event-catalog drift --against=contracts/produced.snapshot.json \\
      --registry-snapshot=node_modules/@connorhoehn/event-catalog/contracts/registry.snapshot.json
`.trim();

const SPEC = { value: ['catalog-url', 'registry-snapshot', 'against'] } as const;

export async function drift(args: string[]): Promise<number> {
  const parsed = parseFlags(args, SPEC);
  if (!parsed.ok) return usageError(BIN, parsed.error, USAGE);
  if (parsed.args.help) {
    console.log(DRIFT_HELP);
    return 0;
  }
  const { positional, values } = parsed.args;
  if (positional.length > 0) {
    return usageError(BIN, `unexpected argument "${positional[0]}" — drift takes flags only`, USAGE);
  }

  const url = values['catalog-url'];
  const registrySnapshotFile = values['registry-snapshot'];
  const against = values['against'];

  if (!against) {
    return usageError(BIN, '--against=<snapshot.json> is required', USAGE);
  }
  if (!url && !registrySnapshotFile) {
    return usageError(BIN, 'one of --catalog-url or --registry-snapshot is required', USAGE);
  }
  if (url && registrySnapshotFile) {
    return usageError(BIN, 'pass only one of --catalog-url / --registry-snapshot', USAGE);
  }

  const loadedSnapshot = readFingerprintMap(against, 'snapshot');
  if (!loadedSnapshot.ok) {
    console.error(`${BIN}: ${loadedSnapshot.error}`);
    return 2;
  }
  const snapshot: Manifest = loadedSnapshot.value;

  let live: Manifest;
  if (url) {
    const ep = `${url.replace(/\/$/, '')}/api/fingerprints`;
    let res: Response;
    try {
      res = await fetch(ep);
    } catch (err) {
      console.error(`${BIN}: fetch failed: ${formatError(err)}`);
      return 1;
    }
    if (!res.ok) {
      console.error(`${BIN}: HTTP ${res.status} from ${ep}`);
      return 1;
    }
    const body = await readJsonResponse(res, ep);
    if (!body.ok) {
      console.error(`${BIN}: ${body.error}`);
      return 1;
    }
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      console.error(`${BIN}: ${ep} returned ${Array.isArray(body.value) ? 'an array' : 'a scalar'}, expected a fingerprint object`);
      return 1;
    }
    live = body.value as Manifest;
  } else {
    const loadedRegistry = readFingerprintMap(registrySnapshotFile!, 'registry snapshot');
    if (!loadedRegistry.ok) {
      console.error(`${BIN}: ${loadedRegistry.error}`);
      return 2;
    }
    live = loadedRegistry.value;
  }

  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ name: string; before: string; after: string }> = [];

  for (const name of Object.keys(live)) {
    if (!(name in snapshot)) {
      added.push(name);
    } else if (snapshot[name] !== live[name]) {
      changed.push({ name, before: snapshot[name]!, after: live[name]! });
    }
  }
  for (const name of Object.keys(snapshot)) {
    if (!(name in live)) removed.push(name);
  }

  for (const n of added.sort()) console.log(`+ ${n}`);
  for (const n of removed.sort()) console.log(`- ${n}`);
  for (const c of changed.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`~ ${c.name}  ${String(c.before).slice(0, 12)}… → ${String(c.after).slice(0, 12)}…`);
  }

  console.log('');
  console.log(`${added.length} added, ${removed.length} removed, ${changed.length} changed`);
  return added.length + removed.length + changed.length === 0 ? 0 : 1;
}
