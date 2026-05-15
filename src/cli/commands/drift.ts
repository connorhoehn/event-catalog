// src/cli/commands/drift.ts
//
// wave24-a — `event-catalog drift --catalog-url=<url> --against=<file>`.
// Fetches the live `/api/fingerprints` manifest and diffs it against a
// previously-saved snapshot. Prints added / removed / changed events.
//
// Exits non-zero when any drift is detected — CI gates can wire this
// to fail builds that would publish a schema change.

import { readFileSync } from 'node:fs';

interface Manifest {
  [eventName: string]: string;
}

export async function drift(args: string[]): Promise<number> {
  const url = getArg(args, 'catalog-url');
  const against = getArg(args, 'against');
  if (!url || !against) {
    console.error('usage: event-catalog drift --catalog-url=<url> --against=<snapshot.json>');
    return 2;
  }

  let snapshot: Manifest;
  try {
    snapshot = JSON.parse(readFileSync(against, 'utf8')) as Manifest;
  } catch (err) {
    console.error(`event-catalog drift: cannot read snapshot "${against}": ${(err as Error).message}`);
    return 2;
  }

  let live: Manifest;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/fingerprints`);
    if (!res.ok) {
      console.error(`event-catalog drift: HTTP ${res.status}`);
      return 1;
    }
    live = (await res.json()) as Manifest;
  } catch (err) {
    console.error(`event-catalog drift: fetch failed: ${(err as Error).message}`);
    return 1;
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
    console.log(`~ ${c.name}  ${c.before.slice(0, 12)}… → ${c.after.slice(0, 12)}…`);
  }

  console.log('');
  console.log(`${added.length} added, ${removed.length} removed, ${changed.length} changed`);
  return added.length + removed.length + changed.length === 0 ? 0 : 1;
}

function getArg(args: string[], name: string): string | undefined {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}
