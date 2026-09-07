// src/cli/commands/manifest.ts
//
// wave24-a — `event-catalog manifest pin --catalog-url=<url> --consumer=<name>
//                                        [--snapshot=<file> | --events=name=fp,name=fp]`
//
// PUTs a consumer manifest. Two input modes:
//   --snapshot=<file>  read a fingerprint manifest (e.g. from
//                      `event-catalog snapshot`) and pin all events
//   --events=...       inline list of name=fingerprint pairs
//
// Pairs with wave23-c's manifest-aware deploy gate so a CI run can:
//   event-catalog snapshot --catalog-url=URL > current.json
//   event-catalog manifest pin --catalog-url=URL --consumer=audit-worker --snapshot=current.json
// then later a publisher's POST /api/events?check-manifests=strict refuses
// to break audit-worker's pinned fingerprints.

import { readFileSync } from 'node:fs';
import {
  formatError,
  parseFlags,
  readFingerprintMap,
  readJsonResponse,
  usageError,
} from '../_args.js';

const BIN_PIN = 'event-catalog manifest pin';
const BIN_VERIFY = 'event-catalog manifest verify';
const USAGE_PIN = 'event-catalog manifest pin --catalog-url=<url> --consumer=<name> [--snapshot=<file> | --events=name=fp,...]';
const USAGE_VERIFY = 'event-catalog manifest verify --against=<consumed.manifest.json> --registry-snapshot=<registry.snapshot.json>';

export const MANIFEST_HELP = `
event-catalog manifest — pin and verify a consumer's fingerprint manifest

USAGE
  ${USAGE_PIN}
  ${USAGE_VERIFY}

PIN OPTIONS
  --catalog-url=<url>   Catalog to PUT the manifest to (required)
  --consumer=<name>     Consumer identity to pin under (required)
  --snapshot=<file>     Pin every event in a fingerprint manifest file
  --events=<pairs>      Pin an inline comma-separated name=fingerprint list

VERIFY OPTIONS
  --against=<file>            The consumer's pinned manifest (required)
  --registry-snapshot=<file>  The shipped registry snapshot (required)

  --help, -h            Show this help

EXIT CODES
  0   Manifest pinned, or every pinned event is fresh
  1   Catalog unreachable / non-2xx, or a stale or unknown pinned event
  2   Usage error or an unreadable / malformed file
`.trim();

const PIN_SPEC = { value: ['catalog-url', 'consumer', 'snapshot', 'events'] } as const;
const VERIFY_SPEC = { value: ['against', 'registry-snapshot'] } as const;

export async function manifest(args: string[]): Promise<number> {
  const sub = args[0];

  if (sub === undefined) {
    return usageError('event-catalog manifest', 'a subcommand is required (pin or verify)', USAGE_PIN);
  }
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(MANIFEST_HELP);
    return 0;
  }
  if (sub === 'verify') {
    return verify(args.slice(1));
  }
  if (sub !== 'pin') {
    return usageError(
      'event-catalog manifest',
      `unknown subcommand "${sub}" — expected pin or verify`,
      USAGE_PIN,
    );
  }
  return pin(args.slice(1));
}

async function pin(rest: string[]): Promise<number> {
  const parsed = parseFlags(rest, PIN_SPEC);
  if (!parsed.ok) return usageError(BIN_PIN, parsed.error, USAGE_PIN);
  if (parsed.args.help) {
    console.log(MANIFEST_HELP);
    return 0;
  }
  const { positional, values } = parsed.args;
  if (positional.length > 0) {
    return usageError(BIN_PIN, `unexpected argument "${positional[0]}" — pin takes flags only`, USAGE_PIN);
  }

  const url = values['catalog-url'];
  const consumer = values['consumer'];
  const snapshotFile = values['snapshot'];
  const eventsArg = values['events'];

  if (!url || !consumer) {
    return usageError(BIN_PIN, '--catalog-url and --consumer are required', USAGE_PIN);
  }
  if (!snapshotFile && !eventsArg) {
    return usageError(BIN_PIN, 'provide either --snapshot=<file> or --events=name=fp,...', USAGE_PIN);
  }
  if (snapshotFile && eventsArg) {
    return usageError(BIN_PIN, 'pass only one of --snapshot / --events', USAGE_PIN);
  }

  const events: Array<{ name: string; fingerprint: string }> = [];
  if (snapshotFile) {
    let raw: string;
    try {
      raw = readFileSync(snapshotFile, 'utf8');
    } catch (err) {
      console.error(`${BIN_PIN}: cannot read "${snapshotFile}": ${formatError(err, false)}`);
      return 2;
    }
    let map: unknown;
    try {
      map = JSON.parse(raw) as unknown;
    } catch (err) {
      console.error(`${BIN_PIN}: invalid JSON in snapshot "${snapshotFile}": ${(err as Error).message}`);
      return 2;
    }
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      console.error(`${BIN_PIN}: snapshot "${snapshotFile}" must be a JSON object of {"event.name": "fingerprint"}`);
      return 2;
    }
    for (const [name, fingerprint] of Object.entries(map as Record<string, unknown>)) {
      if (typeof fingerprint === 'string') events.push({ name, fingerprint });
    }
  } else if (eventsArg) {
    for (const pair of eventsArg.split(',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) {
        console.error(`${BIN_PIN}: malformed --events entry "${pair}" (expected name=fingerprint)`);
        return 2;
      }
      events.push({ name: pair.slice(0, eq).trim(), fingerprint: pair.slice(eq + 1).trim() });
    }
  }

  if (events.length === 0) {
    console.error(`${BIN_PIN}: no events to pin`);
    return 2;
  }

  const ep = `${url.replace(/\/$/, '')}/api/manifests/${encodeURIComponent(consumer)}`;
  let res: Response;
  try {
    res = await fetch(ep, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
  } catch (err) {
    console.error(`${BIN_PIN}: fetch failed: ${formatError(err)}`);
    return 1;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`${BIN_PIN}: HTTP ${res.status}: ${body.slice(0, 200)}`);
    return 1;
  }

  const stored = await readJsonResponse(res, ep);
  const updatedAt = stored.ok && stored.value && typeof stored.value === 'object'
    ? (stored.value as { updatedAt?: unknown }).updatedAt
    : undefined;
  console.log(
    `pinned ${events.length} event(s) for "${consumer}"`
    + (typeof updatedAt === 'string' ? ` (updatedAt=${updatedAt})` : ''),
  );
  return 0;
}

/**
 * `event-catalog manifest verify --against=<consumed.manifest.json>
 *                                 --registry-snapshot=<registry.snapshot.json>`
 *
 * Consumer-side offline drift check. Compares a consumed-event manifest
 * (the fingerprints a consumer is willing to read) against the shipped
 * registry snapshot. Reports per-event `fresh / stale / unknown`:
 *
 *   fresh    — pinned fingerprint matches the registry's current fingerprint
 *   stale    — registry has the event but with a different fingerprint
 *              (publisher made an incompatible change since the consumer pinned)
 *   unknown  — event is not in the registry at all
 *              (publisher removed it, or consumer typed the name wrong)
 *
 * Exit code: 0 only when every pinned event is `fresh`. 1 on any
 * stale/unknown. 2 on missing args / unreadable files.
 *
 * This is the offline counterpart to `POST /api/freshness`; producer CI
 * runs it without needing a live catalog server.
 */
async function verify(args: string[]): Promise<number> {
  const parsed = parseFlags(args, VERIFY_SPEC);
  if (!parsed.ok) return usageError(BIN_VERIFY, parsed.error, USAGE_VERIFY);
  if (parsed.args.help) {
    console.log(MANIFEST_HELP);
    return 0;
  }
  const { positional, values } = parsed.args;
  if (positional.length > 0) {
    return usageError(BIN_VERIFY, `unexpected argument "${positional[0]}" — verify takes flags only`, USAGE_VERIFY);
  }

  const against = values['against'];
  const registrySnapshotFile = values['registry-snapshot'];
  if (!against || !registrySnapshotFile) {
    return usageError(BIN_VERIFY, '--against and --registry-snapshot are both required', USAGE_VERIFY);
  }

  const loadedPinned = readFingerprintMap(against, 'manifest');
  if (!loadedPinned.ok) {
    console.error(`${BIN_VERIFY}: ${loadedPinned.error}`);
    return 2;
  }

  const loadedRegistry = readFingerprintMap(registrySnapshotFile, 'registry snapshot');
  if (!loadedRegistry.ok) {
    console.error(`${BIN_VERIFY}: ${loadedRegistry.error}`);
    return 2;
  }

  const pinned = loadedPinned.value;
  const registry = loadedRegistry.value;

  const stale: Array<{ name: string; pinned: string; current: string }> = [];
  const unknown: string[] = [];
  let fresh = 0;
  for (const [name, fp] of Object.entries(pinned)) {
    if (!(name in registry)) {
      unknown.push(name);
    } else if (registry[name] !== fp) {
      stale.push({ name, pinned: fp, current: registry[name]! });
    } else {
      fresh++;
    }
  }

  for (const name of unknown.sort()) console.log(`? ${name}  (not in registry)`);
  for (const s of stale.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`! ${s.name}  ${s.pinned.slice(0, 12)}… → ${s.current.slice(0, 12)}…`);
  }
  console.log('');
  console.log(`${fresh} fresh, ${stale.length} stale, ${unknown.length} unknown`);
  return stale.length + unknown.length === 0 ? 0 : 1;
}
