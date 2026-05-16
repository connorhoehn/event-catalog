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

export async function manifest(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'verify') {
    return verify(args.slice(1));
  }
  if (sub !== 'pin') {
    console.error(
      'usage: event-catalog manifest pin --catalog-url=<url> --consumer=<name> '
      + '[--snapshot=<file> | --events=name=fp,...]\n'
      + '       event-catalog manifest verify --against=<consumed.manifest.json> '
      + '--registry-snapshot=<registry.snapshot.json>',
    );
    return 2;
  }
  const rest = args.slice(1);
  const url = getArg(rest, 'catalog-url');
  const consumer = getArg(rest, 'consumer');
  const snapshotFile = getArg(rest, 'snapshot');
  const eventsArg = getArg(rest, 'events');

  if (!url || !consumer) {
    console.error('event-catalog manifest pin: --catalog-url and --consumer are required');
    return 2;
  }
  if (!snapshotFile && !eventsArg) {
    console.error('event-catalog manifest pin: provide either --snapshot=<file> or --events=name=fp,...');
    return 2;
  }

  const events: Array<{ name: string; fingerprint: string }> = [];
  if (snapshotFile) {
    let raw: string;
    try {
      raw = readFileSync(snapshotFile, 'utf8');
    } catch (err) {
      console.error(`event-catalog manifest pin: cannot read "${snapshotFile}": ${(err as Error).message}`);
      return 2;
    }
    let map: Record<string, string>;
    try {
      map = JSON.parse(raw);
    } catch (err) {
      console.error(`event-catalog manifest pin: invalid JSON in snapshot: ${(err as Error).message}`);
      return 2;
    }
    for (const [name, fingerprint] of Object.entries(map)) {
      if (typeof fingerprint === 'string') events.push({ name, fingerprint });
    }
  } else if (eventsArg) {
    for (const pair of eventsArg.split(',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) {
        console.error(`event-catalog manifest pin: malformed --events entry "${pair}" (expected name=fingerprint)`);
        return 2;
      }
      events.push({ name: pair.slice(0, eq).trim(), fingerprint: pair.slice(eq + 1).trim() });
    }
  }

  if (events.length === 0) {
    console.error('event-catalog manifest pin: no events to pin');
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
    console.error(`event-catalog manifest pin: fetch failed: ${(err as Error).message}`);
    return 1;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`event-catalog manifest pin: HTTP ${res.status}: ${body.slice(0, 200)}`);
    return 1;
  }

  const stored = await res.json();
  console.log(`pinned ${events.length} event(s) for "${consumer}" (updatedAt=${stored.updatedAt})`);
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
  const against = getArg(args, 'against');
  const registrySnapshotFile = getArg(args, 'registry-snapshot');
  if (!against || !registrySnapshotFile) {
    console.error(
      'usage: event-catalog manifest verify --against=<consumed.manifest.json> '
      + '--registry-snapshot=<registry.snapshot.json>',
    );
    return 2;
  }

  let pinned: Record<string, string>;
  try {
    pinned = JSON.parse(readFileSync(against, 'utf8'));
  } catch (err) {
    console.error(`event-catalog manifest verify: cannot read "${against}": ${(err as Error).message}`);
    return 2;
  }

  let registry: Record<string, string>;
  try {
    registry = JSON.parse(readFileSync(registrySnapshotFile, 'utf8'));
  } catch (err) {
    console.error(
      `event-catalog manifest verify: cannot read registry snapshot "${registrySnapshotFile}": ${(err as Error).message}`,
    );
    return 2;
  }

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

function getArg(args: string[], name: string): string | undefined {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}
