// src/cli/commands/snapshot.ts
//
// wave24-a — `event-catalog snapshot --catalog-url=<url>`. Fetches
// `/api/fingerprints` and writes the manifest to stdout.
//
// Pairs with `event-catalog drift` for CI workflows:
//   event-catalog snapshot --catalog-url=https://catalog > snapshot.json
//   git add snapshot.json
//   ...later...
//   event-catalog drift --catalog-url=https://catalog --against=snapshot.json

export async function snapshot(args: string[]): Promise<number> {
  const url = getArg(args, 'catalog-url');
  if (!url) {
    console.error('usage: event-catalog snapshot --catalog-url=<url>');
    return 2;
  }
  const namespace = getArg(args, 'namespace');
  const ep = `${url.replace(/\/$/, '')}/api/fingerprints${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`;
  let res: Response;
  try {
    res = await fetch(ep);
  } catch (err) {
    console.error(`event-catalog snapshot: fetch failed: ${(err as Error).message}`);
    return 1;
  }
  if (!res.ok) {
    console.error(`event-catalog snapshot: HTTP ${res.status}`);
    return 1;
  }
  const manifest = await res.json();
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
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
