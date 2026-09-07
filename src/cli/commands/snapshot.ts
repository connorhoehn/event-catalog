// src/cli/commands/snapshot.ts
//
// wave24-a / contract-test rollout — `event-catalog snapshot` has two modes:
//
//   --catalog-url=<url> [--namespace=X]   live mode: GET /api/fingerprints
//   --from-source --declarations=<path>   offline mode: load a module that
//                                         exports declarations and compute
//                                         fingerprints locally
//
// Offline mode is what producer CI uses to generate
// `contracts/produced.snapshot.json` from the producer's own declaration
// module — no live catalog required, no network access required.
//
// The declarations module must export the declarations as **data**, not
// via side-effecting `catalog.declare(...)` calls. Three accepted shapes:
//
//   export const declarations: EventDeclaration[] = [...]
//   export default [ {...}, {...} ]
//   // OR pass the named export explicitly:
//   --export=<name>
//
// The chosen convention is "declarations as data" because importing a
// producer's runtime module would trigger boot-time side effects (env
// reads, DB connects). Producers ship a dedicated module — usually
// `event-declarations.ts` — alongside the runtime that wires those
// declarations into the catalog client.

import { pathToFileURL } from 'node:url';
import { resolve as resolveFs, isAbsolute } from 'node:path';
import { computeSchemaFingerprint } from '../../registry/fingerprint.js';
import type { EventDeclaration } from '../../types/index.js';
import { formatError, parseFlags, readJsonResponse, usageError } from '../_args.js';

const BIN = 'event-catalog snapshot';
const USAGE_LIVE = 'event-catalog snapshot --catalog-url=<url> [--namespace=X]';
const USAGE_SOURCE = 'event-catalog snapshot --from-source --declarations=<path> [--export=<name>] [--namespace=X]';

export const SNAPSHOT_HELP = `
event-catalog snapshot — emit a {event: fingerprint} manifest on stdout

USAGE
  ${USAGE_LIVE}
  ${USAGE_SOURCE}

OPTIONS
  --catalog-url=<url>     Live mode: GET <url>/api/fingerprints
  --from-source           Offline mode: fingerprint a local declarations module
  --declarations=<path>   Offline mode: path to the declarations module (required)
  --export=<name>         Offline mode: named export holding EventDeclaration[]
                          (default: probes declarations, default, eventDeclarations)
  --namespace=<ns>        Only include events in this namespace
  --help, -h              Show this help

EXIT CODES
  0   Manifest written to stdout
  1   Catalog unreachable or returned a non-2xx / non-JSON response
  2   Usage error, unloadable declarations module, or malformed declaration

EXAMPLES
  event-catalog snapshot --catalog-url=https://catalog > snapshot.json
  event-catalog snapshot --from-source --declarations=src/event-declarations.js
`.trim();

const SPEC = {
  value: ['catalog-url', 'namespace', 'declarations', 'export'],
  boolean: ['from-source'],
} as const;

export async function snapshot(args: string[]): Promise<number> {
  const parsed = parseFlags(args, SPEC);
  if (!parsed.ok) return usageError(BIN, parsed.error, USAGE_LIVE);
  if (parsed.args.help) {
    console.log(SNAPSHOT_HELP);
    return 0;
  }
  const { positional, values, flags } = parsed.args;
  if (positional.length > 0) {
    return usageError(BIN, `unexpected argument "${positional[0]}" — snapshot takes flags only`, USAGE_LIVE);
  }

  return flags.has('from-source') ? runFromSource(values) : runFromCatalog(values);
}

type Values = Readonly<Record<string, string>>;

async function runFromCatalog(values: Values): Promise<number> {
  const url = values['catalog-url'];
  if (!url) {
    return usageError(BIN, '--catalog-url is required (or use --from-source)', USAGE_LIVE);
  }
  const namespace = values['namespace'];
  const ep = `${url.replace(/\/$/, '')}/api/fingerprints${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`;
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
  process.stdout.write(JSON.stringify(body.value, null, 2) + '\n');
  return 0;
}

async function runFromSource(values: Values): Promise<number> {
  const declarationsPath = values['declarations'];
  if (!declarationsPath) {
    return usageError(BIN, '--declarations=<path> is required with --from-source', USAGE_SOURCE);
  }

  const absPath = isAbsolute(declarationsPath)
    ? declarationsPath
    : resolveFs(process.cwd(), declarationsPath);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;
  } catch (err) {
    console.error(`${BIN}: cannot load "${declarationsPath}": ${formatError(err)}`);
    return 2;
  }

  const exportName = values['export'];
  const declarations = extractDeclarations(mod, exportName);
  if (!declarations) {
    console.error(
      `${BIN}: could not find an EventDeclaration[] export in "${declarationsPath}". `
      + 'Expected `export const declarations = [...]`, `export default [...]`, '
      + 'or pass --export=<name> to select a named export.',
    );
    return 2;
  }

  const namespaceFilter = values['namespace'];
  const manifest: Record<string, string> = {};
  for (const decl of declarations) {
    if (!decl || typeof decl !== 'object' || typeof decl.name !== 'string' || !decl.schema) {
      console.error(`${BIN}: skipping malformed declaration: ${JSON.stringify(decl).slice(0, 120)}`);
      return 2;
    }
    if (namespaceFilter && decl.namespace && decl.namespace !== namespaceFilter) continue;
    manifest[decl.name] = computeSchemaFingerprint(decl.schema);
  }

  // Sort keys for stable diffs.
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k]!;
  process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
  return 0;
}

function extractDeclarations(
  mod: Record<string, unknown>,
  exportName?: string,
): EventDeclaration[] | null {
  if (exportName) {
    const candidate = mod[exportName];
    return isDeclarationArray(candidate) ? (candidate as EventDeclaration[]) : null;
  }
  // Probe common names in order.
  for (const name of ['declarations', 'default', 'eventDeclarations']) {
    const candidate = mod[name];
    if (isDeclarationArray(candidate)) return candidate as EventDeclaration[];
  }
  return null;
}

function isDeclarationArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((v) => v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string');
}
