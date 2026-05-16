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

export async function snapshot(args: string[]): Promise<number> {
  const fromSource = args.includes('--from-source');

  if (fromSource) {
    return runFromSource(args);
  }

  return runFromCatalog(args);
}

async function runFromCatalog(args: string[]): Promise<number> {
  const url = getArg(args, 'catalog-url');
  if (!url) {
    console.error('usage: event-catalog snapshot --catalog-url=<url> [--namespace=X]');
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

async function runFromSource(args: string[]): Promise<number> {
  const declarationsPath = getArg(args, 'declarations');
  if (!declarationsPath) {
    console.error('usage: event-catalog snapshot --from-source --declarations=<path> [--export=<name>] [--namespace=X]');
    return 2;
  }

  const absPath = isAbsolute(declarationsPath)
    ? declarationsPath
    : resolveFs(process.cwd(), declarationsPath);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;
  } catch (err) {
    console.error(`event-catalog snapshot: cannot load "${declarationsPath}": ${(err as Error).message}`);
    return 2;
  }

  const exportName = getArg(args, 'export');
  const declarations = extractDeclarations(mod, exportName);
  if (!declarations) {
    console.error(
      `event-catalog snapshot: could not find an EventDeclaration[] export in "${declarationsPath}". `
      + 'Expected `export const declarations = [...]`, `export default [...]`, '
      + 'or pass --export=<name> to select a named export.',
    );
    return 2;
  }

  const namespaceFilter = getArg(args, 'namespace');
  const manifest: Record<string, string> = {};
  for (const decl of declarations) {
    if (!decl || typeof decl !== 'object' || typeof decl.name !== 'string' || !decl.schema) {
      console.error(`event-catalog snapshot: skipping malformed declaration: ${JSON.stringify(decl).slice(0, 120)}`);
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

function getArg(args: string[], name: string): string | undefined {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

