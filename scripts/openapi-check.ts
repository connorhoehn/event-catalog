#!/usr/bin/env tsx
/**
 * openapi-check.ts
 *
 * Verifies that openapi/event-catalog.yaml describes the API the server
 * actually implements. Four checks, in increasing order of pickiness:
 *
 *   1. ROUTES     — every route in src/server/routes.ts (mounted at /api)
 *                   and every rootRouter route in src/server/index.ts is
 *                   documented, and nothing is documented that no route
 *                   serves.
 *   2. STATUSES   — every status code a documented operation claims is
 *                   reachable from the handler that serves it.
 *   3. PARAMETERS — every documented query parameter is read by that
 *                   handler, and every query parameter the handler reads
 *                   is documented on at least one of its operations.
 *   4. REFS       — every $ref resolves, and no component is orphaned.
 *
 * ─── Why it is shaped this way ────────────────────────────────────────
 *
 * The obvious "correct" implementation type-checks the spec against the
 * handlers: parse the TypeScript, resolve each handler's return paths,
 * infer the response shape. That is a compiler, it breaks on every
 * refactor, and per CLAUDE.md this stays a plain zero-dependency script
 * (no OpenAPI validator, no schema lib, no TS parser).
 *
 * So the checks here are deliberately *shallow but grounded*: they work
 * on string evidence in the handler source, mapped per route via the
 * route table. That means:
 *
 *   - We check STATUS CODES and PARAMETER NAMES — facts that survive as
 *     literals in the source (`res.status(409)`, `singleParam(req, 'tag')`)
 *     and that are exactly what rotted while the old route-only check
 *     reported "in sync".
 *   - We do NOT check response BODY SHAPES. There is no honest way to
 *     recover `{declared, version, compatible, schemaFingerprint}` from
 *     source text, and a check that guesses would either be noise or a
 *     second spec to maintain. Field-level accuracy stays a review
 *     concern; this script keeps the machine-checkable parts honest.
 *
 * Grounding is at FILE granularity, not per-handler: a status is
 * accepted if it is reachable anywhere in the route's handler module or
 * its local imports (which is how the shared `badRequest` / `eventNotFound`
 * / SSE-cap helpers get counted). That over-accepts within a module —
 * documenting 409 on a different /api/events operation would pass — and
 * it is the price of not parsing TypeScript. It still rejects a status
 * or parameter invented out of nothing, which is the failure mode that
 * actually happened.
 *
 * Usage:
 *   npx tsx scripts/openapi-check.ts [--strict]
 *
 * Exit codes:
 *   0 — all clear (or only warnings when --strict is absent)
 *   1 — a check failed
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const strict = process.argv.includes('--strict');

/**
 * Statuses accepted on any operation without source evidence.
 *
 *   200 — the default success status. Handlers reach it through
 *         `res.json()` / `res.write()` / a bare SSE preamble, none of
 *         which name the number.
 *   401 — only when the deployment injects an authMiddleware.
 *   413 — produced by the HTTP transport's body cap before any handler
 *         runs, so it appears in no handler's source.
 */
const AMBIENT_STATUSES = new Set([200, 401, 413]);

// ---------------------------------------------------------------------------
// A tiny YAML reader — just enough of the subset this spec is written in
// ---------------------------------------------------------------------------
//
// Handles block mappings, block sequences, block scalars (`|`, `>`) and
// quoted keys. Flow collections (`{ type: string }`, `[a, b]`) are kept
// as opaque strings: nothing below needs to look inside one.

type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

interface Line { indent: number; text: string }

function tokenize(src: string): Line[] {
  const out: Line[] = [];
  const raw = src.split('\n');
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    out.push({ indent, text });
    // Block scalar: swallow its body, which is free text, not structure.
    if (/:\s*[|>][+-]?\d*\s*$/.test(text)) {
      while (i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next.trim() === '') { i++; continue; }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent <= indent) break;
        i++;
      }
    }
  }
  return out;
}

function splitKey(text: string): { key: string; rest: string } | null {
  // Quoted key: '200': ... / "200": ...
  const quoted = /^(['"])(.*?)\1\s*:(?:\s+(.*))?$/.exec(text);
  if (quoted) return { key: quoted[2], rest: quoted[3] ?? '' };
  // Keys may contain path templating (`/api/events/{name}`), so only
  // whitespace and the separating colon are excluded.
  const plain = /^([^\s:]+)\s*:(?:\s+(.*))?$/.exec(text);
  if (plain) return { key: plain[1], rest: plain[2] ?? '' };
  return null;
}

/** Advance past a block nested deeper than `indent`. */
function skipNested(lines: Line[], i: number, indent: number): number {
  while (i < lines.length && lines[i].indent > indent) i++;
  return i;
}

/** Parse the block starting at `i`, whose entries sit at `indent`. */
function parseBlock(lines: Line[], i: number, indent: number): [YamlValue, number] {
  if (i >= lines.length || lines[i].indent < indent) return ['', i];

  if (lines[i].text.startsWith('- ') || lines[i].text === '-') {
    const seq: YamlValue[] = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const rest = lines[i].text.replace(/^-\s*/, '');
      if (rest === '') {
        const [value, next] = parseBlock(lines, i + 1, lines[i + 1]?.indent ?? indent + 2);
        seq.push(value);
        i = next;
      } else if (splitKey(rest)) {
        // Inline map opening a sequence item: `- in: query`. Re-indent the
        // first line so the item's remaining keys parse as one mapping.
        const shifted: Line[] = [{ indent: indent + 2, text: rest }, ...lines.slice(i + 1)];
        const [value, next] = parseBlock(shifted, 0, indent + 2);
        seq.push(value);
        i = i + next; // `next` counts the injected line, which stands in for lines[i]
      } else {
        seq.push(rest);
        i++;
      }
    }
    return [seq, i];
  }

  const map: { [key: string]: YamlValue } = {};
  while (i < lines.length && lines[i].indent >= indent) {
    // A line deeper than this block belongs to something we chose not to
    // descend into; swallow it rather than ending the block early.
    if (lines[i].indent > indent) { i = skipNested(lines, i, indent); continue; }
    const parsed = splitKey(lines[i].text);
    if (!parsed) { i = skipNested(lines, i + 1, indent); continue; }
    const { key, rest } = parsed;
    if (rest === '' || /^[|>][+-]?\d*$/.test(rest)) {
      const childIndent = lines[i + 1]?.indent ?? -1;
      if (childIndent > indent) {
        const [value, next] = parseBlock(lines, i + 1, childIndent);
        map[key] = value;
        i = next;
      } else {
        map[key] = '';
        i++;
      }
    } else {
      map[key] = rest;
      i++;
    }
  }
  return [map, i];
}

function isMap(v: YamlValue | undefined): v is { [key: string]: YamlValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const specSrc = readFileSync(resolve(ROOT, 'openapi/event-catalog.yaml'), 'utf8');
const specDoc = parseBlock(tokenize(specSrc), 0, 0)[0];
if (!isMap(specDoc)) {
  console.error('❌ could not parse openapi/event-catalog.yaml');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The route table: path + method → the handler module that serves it
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

interface CodeRoute {
  method: string;
  /** OpenAPI-shaped path, e.g. /api/events/{name} */
  path: string;
  /** Absolute path of the module holding the handler body. */
  handlerFile: string;
}

const routesFile = resolve(ROOT, 'src/server/routes.ts');
const indexFile = resolve(ROOT, 'src/server/index.ts');
const routesSrc = readFileSync(routesFile, 'utf8');
const indexSrc = readFileSync(indexFile, 'utf8');

function expressToOpenApi(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}').replace(/\/$/, '');
}

/** `createEventHandlers` → src/server/routes/events.ts */
const factoryToFile = new Map<string, string>();
for (const m of routesSrc.matchAll(/import\s*\{\s*(create\w+)\s*\}\s*from\s*'(\.[^']+)'/g)) {
  factoryToFile.set(m[1], resolve(dirname(routesFile), m[2].replace(/\.js$/, '.ts')));
}

/** `events` (the local const) → src/server/routes/events.ts */
const varToFile = new Map<string, string>();
for (const m of routesSrc.matchAll(/const\s+(\w+)\s*=\s*(create\w+)\(/g)) {
  const file = factoryToFile.get(m[2]);
  if (file) varToFile.set(m[1], file);
}

const codeRoutes: CodeRoute[] = [];

for (const m of routesSrc.matchAll(
  /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\./g,
)) {
  const file = varToFile.get(m[3]);
  if (!file) continue;
  codeRoutes.push({ method: m[1], path: `/api${expressToOpenApi(m[2])}`, handlerFile: file });
}

// Root-level routes live inline in index.ts (was app.METHOD pre-AdmissionHttpServer).
for (const m of indexSrc.matchAll(/\brootRouter\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)) {
  const raw = m[2];
  if (raw === '*' || raw.startsWith('/*')) continue;
  codeRoutes.push({ method: m[1], path: expressToOpenApi(raw), handlerFile: indexFile });
}

// ---------------------------------------------------------------------------
// 2. Handler source sets — the module plus its local imports
// ---------------------------------------------------------------------------
//
// `badRequest` (400), `eventNotFound` (404) and the SSE-cap 503 all live in
// sibling modules, so a route's evidence is its module plus the files it
// imports from within src/.

const sourceCache = new Map<string, string>();
function readSource(file: string): string {
  let src = sourceCache.get(file);
  if (src === undefined) {
    src = existsSync(file) ? readFileSync(file, 'utf8') : '';
    sourceCache.set(file, src);
  }
  return src;
}

const closureCache = new Map<string, string[]>();
function sourceClosure(file: string): string[] {
  const cached = closureCache.get(file);
  if (cached) return cached;
  const files = [file];
  for (const m of readSource(file).matchAll(/from\s*'(\.[^']+\.js)'/g)) {
    const dep = resolve(dirname(file), m[1].replace(/\.js$/, '.ts'));
    if (existsSync(dep) && !files.includes(dep)) files.push(dep);
  }
  closureCache.set(file, files);
  return files;
}

/** Status codes reachable from a route's handler, by source evidence. */
function reachableStatuses(handlerFile: string): Set<number> {
  const out = new Set<number>(AMBIENT_STATUSES);
  for (const file of sourceClosure(handlerFile)) {
    const src = readSource(file);
    for (const m of src.matchAll(/\.status\(\s*(\d{3})\s*\)/g)) out.add(Number(m[1]));
    for (const m of src.matchAll(/\.json\(\s*(\d{3})\s*,/g)) out.add(Number(m[1]));
    // `res.status(httpStatus)` — the code is computed. Fall back to every
    // HTTP-shaped literal in that file rather than pretending we know.
    if (/\.status\(\s*[A-Za-z_]/.test(src)) {
      for (const m of src.matchAll(/\b([1-5]\d{2})\b/g)) out.add(Number(m[1]));
    }
  }
  return out;
}

/** Query-param names the handler module actually reads. */
function readQueryParams(handlerFile: string): Set<string> {
  const src = readSource(handlerFile);
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:single|string|enum)Param\(\s*\w+\s*,\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\.query\[\s*'([^']+)'\s*\]/g)) out.add(m[1]);
  for (const m of src.matchAll(/\.query\.([A-Za-z_][\w-]*)/g)) out.add(m[1]);
  return out;
}

/** Does the handler module mention this parameter name at all? */
function mentionsParam(handlerFile: string, name: string): boolean {
  const src = readSource(handlerFile);
  if (src.includes(`'${name}'`) || src.includes(`"${name}"`)) return true;
  if (new RegExp(`\\.(query|params)\\.${name.replace(/[-.]/g, '\\$&')}\\b`).test(src)) return true;
  // Headers are matched case-insensitively: `req.header('x-...')`.
  return src.toLowerCase().includes(`'${name.toLowerCase()}'`);
}

// ---------------------------------------------------------------------------
// 3. The documented operations
// ---------------------------------------------------------------------------

interface SpecOperation {
  method: string;
  path: string;
  statuses: number[];
  /** Documented parameters, including any declared at the path level. */
  params: Array<{ name: string; in: string }>;
}

function collectParams(node: YamlValue | undefined): Array<{ name: string; in: string }> {
  if (!Array.isArray(node)) return [];
  const out: Array<{ name: string; in: string }> = [];
  for (const entry of node) {
    if (!isMap(entry)) continue;
    const name = entry.name;
    const location = entry.in;
    if (typeof name === 'string' && typeof location === 'string') {
      out.push({ name: name.replace(/^['"]|['"]$/g, ''), in: location });
    }
  }
  return out;
}

const specOps: SpecOperation[] = [];
const pathsNode = specDoc.paths;
if (isMap(pathsNode)) {
  for (const [path, pathItem] of Object.entries(pathsNode)) {
    if (!isMap(pathItem)) continue;
    const sharedParams = collectParams(pathItem.parameters);
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isMap(op)) continue;
      const statuses: number[] = [];
      if (isMap(op.responses)) {
        for (const code of Object.keys(op.responses)) {
          const n = Number(code);
          if (Number.isInteger(n)) statuses.push(n);
        }
      }
      specOps.push({
        method,
        path,
        statuses,
        params: [...sharedParams, ...collectParams(op.parameters)],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Run the checks
// ---------------------------------------------------------------------------

const errors: string[] = [];
const warnings: string[] = [];

const key = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

const specByKey = new Map(specOps.map(op => [key(op.method, op.path), op]));
const codeByKey = new Map(codeRoutes.map(r => [key(r.method, r.path), r]));

// --- 1. Routes -------------------------------------------------------------

for (const r of codeRoutes) {
  if (!specByKey.has(key(r.method, r.path))) {
    errors.push(`undocumented endpoint: ${key(r.method, r.path)} (${r.handlerFile.slice(ROOT.length + 1)})`);
  }
}
for (const op of specOps) {
  if (!codeByKey.has(key(op.method, op.path))) {
    (strict ? errors : warnings).push(`phantom endpoint: ${key(op.method, op.path)} is documented but no route serves it`);
  }
}

// --- 2 + 3. Statuses and parameters ----------------------------------------

/** Every documented query param for a handler file, unioned across its ops. */
const documentedByFile = new Map<string, Set<string>>();

for (const op of specOps) {
  const route = codeByKey.get(key(op.method, op.path));
  if (!route) continue; // already reported as phantom

  const reachable = reachableStatuses(route.handlerFile);
  for (const status of op.statuses) {
    if (!reachable.has(status)) {
      errors.push(
        `invented status: ${key(op.method, op.path)} documents ${status}, but nothing in `
        + `${route.handlerFile.slice(ROOT.length + 1)} (or its local imports) can return it`,
      );
    }
  }

  for (const p of op.params) {
    if (p.in === 'path') {
      // Path params must appear in the route pattern itself.
      if (!op.path.includes(`{${p.name}}`)) {
        errors.push(`unknown path parameter: ${key(op.method, op.path)} documents {${p.name}}, not present in the path`);
      }
      continue;
    }
    if (!mentionsParam(route.handlerFile, p.name)) {
      errors.push(
        `invented parameter: ${key(op.method, op.path)} documents ${p.in} parameter `
        + `"${p.name}", which ${route.handlerFile.slice(ROOT.length + 1)} never reads`,
      );
    }
    if (p.in === 'query') {
      let set = documentedByFile.get(route.handlerFile);
      if (!set) { set = new Set(); documentedByFile.set(route.handlerFile, set); }
      set.add(p.name);
    }
  }
}

for (const [file, documented] of documentedByFile) {
  for (const name of readQueryParams(file)) {
    if (!documented.has(name)) {
      errors.push(
        `undocumented parameter: ${file.slice(ROOT.length + 1)} reads ?${name}=, `
        + `which no operation it serves documents`,
      );
    }
  }
}

// --- 4. Component refs -----------------------------------------------------

const components = isMap(specDoc.components) ? specDoc.components : {};
const defined = new Set<string>();
for (const section of ['schemas', 'responses', 'parameters'] as const) {
  const node = components[section];
  if (isMap(node)) for (const name of Object.keys(node)) defined.add(`${section}/${name}`);
}

const referenced = new Set<string>();
for (const m of specSrc.matchAll(/\$ref:\s*'#\/components\/(\w+)\/([\w.-]+)'/g)) {
  referenced.add(`${m[1]}/${m[2]}`);
}
for (const ref of referenced) {
  if (!defined.has(ref)) errors.push(`dangling $ref: #/components/${ref} is not defined`);
}
for (const name of defined) {
  if (!referenced.has(name)) {
    warnings.push(`orphan component: #/components/${name} is defined but never referenced`);
  }
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------

if (errors.length === 0) {
  console.log(
    `✓ OpenAPI spec is in sync with routes.ts `
    + `(${codeRoutes.length} routes, ${specOps.length} documented operations)`,
  );
  console.log('  routes ✓  status codes ✓  parameters ✓  component refs ✓');
}

for (const w of warnings) console.log(`⚠️  ${w}`);
if (errors.length > 0) {
  console.log('\n❌ OpenAPI spec does not match the handlers:\n');
  for (const e of errors) console.log(`   ${e}`);
  console.log('\n   The CODE is the source of truth — fix openapi/event-catalog.yaml.');
  process.exit(1);
}
if (warnings.length > 0 && !strict) {
  console.log('\n  (Pass --strict to treat phantom endpoints as errors)');
}
process.exit(0);
