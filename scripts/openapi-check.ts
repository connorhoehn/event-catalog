#!/usr/bin/env tsx
/**
 * openapi-check.ts
 *
 * Diffs actual Express routes in src/server/routes.ts against the declared
 * paths in openapi/event-catalog.yaml. Reports undocumented endpoints
 * (in code but not spec) and phantom endpoints (in spec but not code).
 *
 * Usage:
 *   npx tsx scripts/openapi-check.ts [--strict]
 *
 * Exit codes:
 *   0 — all clear (or only warnings when --strict is absent)
 *   1 — undocumented or phantom endpoints detected
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const strict = process.argv.includes('--strict');

// ---------------------------------------------------------------------------
// 1. Extract routes from src/server/routes.ts (mounted at /api)
//    and root-level routes from src/server/index.ts (no prefix)
// ---------------------------------------------------------------------------

const routesSrc = readFileSync(resolve(ROOT, 'src/server/routes.ts'), 'utf8');
const indexSrc = readFileSync(resolve(ROOT, 'src/server/index.ts'), 'utf8');

interface RouteEntry { method: string; path: string; normalized: string }

function expressToOpenApi(path: string): string {
  // Convert Express :param to OpenAPI {param} and strip trailing slash.
  return path.replace(/:([^/]+)/g, '{$1}').replace(/\/$/, '');
}

const codeRoutes: RouteEntry[] = [];

// Router routes (mounted at /api): router.METHOD('path', ...)
const ROUTER_RE = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
let m: RegExpExecArray | null;
while ((m = ROUTER_RE.exec(routesSrc)) !== null) {
  const method = m[1];
  const raw = m[2];
  const normalized = `/api${expressToOpenApi(raw)}`;
  codeRoutes.push({ method, path: raw, normalized });
}

// Root-level routes in index.ts: rootRouter.METHOD('path', ...)
// (was app.METHOD before the Express → distributed-core AdmissionHttpServer move)
const APP_RE = /\brootRouter\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
while ((m = APP_RE.exec(indexSrc)) !== null) {
  const method = m[1];
  const raw = m[2];
  // Skip wildcard catch-all and static asset routes.
  if (raw === '*' || raw.startsWith('/*')) continue;
  const normalized = expressToOpenApi(raw);
  codeRoutes.push({ method, path: raw, normalized });
}

// ---------------------------------------------------------------------------
// 2. Extract paths from openapi/event-catalog.yaml
// ---------------------------------------------------------------------------
// We parse the YAML with a lightweight regex rather than a full YAML parser
// to keep the script zero-dependency.

const specSrc = readFileSync(resolve(ROOT, 'openapi/event-catalog.yaml'), 'utf8');

interface SpecEntry { method: string; path: string }

const specEntries: SpecEntry[] = [];

// Paths block: lines starting with exactly 2-space indent + /...
// Methods: lines starting with 4-space indent + (get|post|put|delete|patch):
const PATH_RE = /^  (\/[^\s:]+):/;
const METHOD_RE = /^    (get|post|put|delete|patch):/;

let currentPath: string | null = null;
for (const line of specSrc.split('\n')) {
  const pathMatch = PATH_RE.exec(line);
  if (pathMatch) {
    currentPath = pathMatch[1];
    continue;
  }
  const methodMatch = METHOD_RE.exec(line);
  if (methodMatch && currentPath) {
    specEntries.push({ method: methodMatch[1], path: currentPath });
  }
}

// ---------------------------------------------------------------------------
// 3. Diff
// ---------------------------------------------------------------------------

function key(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

const specSet = new Set(specEntries.map(e => key(e.method, e.path)));
const codeSet = new Set(codeRoutes.map(e => key(e.method, e.normalized)));

const undocumented = codeRoutes.filter(e => !specSet.has(key(e.method, e.normalized)));
const phantom = specEntries.filter(e => !codeSet.has(key(e.method, e.path)));

// ---------------------------------------------------------------------------
// 4. Report
// ---------------------------------------------------------------------------

let exitCode = 0;

if (undocumented.length === 0 && phantom.length === 0) {
  console.log('✓ OpenAPI spec is in sync with routes.ts');
  process.exit(0);
}

if (undocumented.length > 0) {
  console.log(`\n❌ Undocumented endpoints (in code, missing from spec):`);
  for (const r of undocumented) {
    console.log(`   ${r.method.toUpperCase().padEnd(7)} ${r.normalized}`);
  }
  exitCode = 1;
}

if (phantom.length > 0) {
  const label = strict ? '❌' : '⚠️ ';
  console.log(`\n${label} Phantom endpoints (in spec, not in code):`);
  for (const r of phantom) {
    console.log(`   ${r.method.toUpperCase().padEnd(7)} ${r.path}`);
  }
  if (strict) exitCode = 1;
}

if (exitCode === 0 && phantom.length > 0) {
  console.log('\n  (Pass --strict to treat phantom endpoints as errors)');
}

process.exit(exitCode);
