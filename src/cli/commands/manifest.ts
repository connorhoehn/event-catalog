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
  if (sub !== 'pin') {
    console.error('usage: event-catalog manifest pin --catalog-url=<url> --consumer=<name> [--snapshot=<file> | --events=name=fp,...]');
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

function getArg(args: string[], name: string): string | undefined {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}
