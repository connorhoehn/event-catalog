// scripts/generate-types.ts
//
// Generates:
//   - `src/generated/event-types.ts`   — EventPayloadMap keyed by every event
//     name declared in this package.
//   - `src/generated/client-frames.ts` — ClientFramePayloadMap for the
//     outbound client→gateway WS frames (`client.*` namespace) plus
//     per-service Inbound/Outbound frame union types (Wave A2).
//
// Run: npm run generate-types
//
// The output files are committed so consumers get types without running the
// generator themselves.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDeclarations } from '../src/declarations/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'src', 'generated', 'event-types.ts');
const clientFramesOutFile = join(here, '..', 'src', 'generated', 'client-frames.ts');

// ---------------------------------------------------------------------------
// JSON Schema → TypeScript type string converter (recursive, no deps)
// ---------------------------------------------------------------------------

function jsonSchemaToTs(schema: Record<string, unknown>, indent: number): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);

  // Union types: { type: ['string', 'null'] }
  if (Array.isArray(schema['type'])) {
    const types = (schema['type'] as string[]).map((t) => primitiveToTs(t));
    return types.join(' | ');
  }

  const type = schema['type'] as string | undefined;

  // Object
  if (type === 'object' || (!type && schema['properties'])) {
    const props = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
    const required = new Set<string>((schema['required'] as string[] | undefined) ?? []);
    const addlProps = schema['additionalProperties'];

    if (!props || Object.keys(props).length === 0) {
      // No declared properties — use Record<string, unknown> when additionalProperties
      if (addlProps === true || (typeof addlProps === 'object' && addlProps !== null)) {
        return 'Record<string, unknown>';
      }
      return 'Record<string, never>';
    }

    const lines: string[] = ['{'];
    for (const [key, propSchema] of Object.entries(props)) {
      // Skip empty schemas (unknown type) — they become `unknown`
      const tsType = jsonSchemaToTs(propSchema as Record<string, unknown>, indent + 1);
      const optMark = required.has(key) ? '' : '?';
      // Quote keys that contain special chars (colons, dots, dashes)
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
      lines.push(`${inner}${safeKey}${optMark}: ${tsType};`);
    }
    // When additionalProperties is true / an object, add index signature
    if (addlProps === true || (typeof addlProps === 'object' && addlProps !== null && addlProps !== false)) {
      lines.push(`${inner}[key: string]: unknown;`);
    }
    lines.push(`${pad}}`);
    return lines.join('\n');
  }

  // Array
  if (type === 'array') {
    const items = schema['items'] as Record<string, unknown> | undefined;
    if (!items || Object.keys(items).length === 0) {
      return 'unknown[]';
    }
    const itemType = jsonSchemaToTs(items, indent);
    // Wrap in parens if it's a union or object to avoid ambiguity
    if (itemType.includes('|') || itemType.startsWith('{')) {
      return `(${itemType})[]`;
    }
    return `${itemType}[]`;
  }

  // Enum (string literal union)
  if (schema['enum'] && Array.isArray(schema['enum'])) {
    return (schema['enum'] as unknown[])
      .map((v) => (typeof v === 'string' ? `'${v}'` : String(v)))
      .join(' | ');
  }

  // Const (single literal)
  if (schema['const'] !== undefined) {
    const c = schema['const'];
    return typeof c === 'string' ? `'${c}'` : String(c);
  }

  // Primitives
  if (type) return primitiveToTs(type);

  // Catch-all (empty schema, $ref, oneOf, anyOf, etc.) → unknown
  return 'unknown';
}

function primitiveToTs(type: string): string {
  switch (type) {
    case 'string': return 'string';
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    default: return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Sanitize an event name to a TS interface entry key
// ---------------------------------------------------------------------------

function quoteEventKey(name: string): string {
  return `'${name}'`;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const lines: string[] = [
  '// AUTO-GENERATED — do not edit manually. Run: npm run generate-types',
  `// Generated at: ${new Date().toISOString()}`,
  '',
  '// prettier-ignore-file',
  '/* eslint-disable */',
  '',
  '/**',
  ' * Map from every declared event name to its payload type.',
  ' *',
  ' * Usage:',
  ' * ```ts',
  " * import type { EventPayloadMap, EventPayload } from '@connorhoehn/event-catalog';",
  ' *',
  " * function publish<K extends keyof EventPayloadMap>(name: K, payload: EventPayload<K>) {",
  ' *   // payload is fully typed',
  ' * }',
  ' * ```',
  ' */',
  'export interface EventPayloadMap {',
];

for (const decl of allDeclarations) {
  const tsType = jsonSchemaToTs(decl.schema as Record<string, unknown>, 1);
  if (decl.description) {
    lines.push(`  /** ${decl.description.replace(/\*\//g, '* /')} */`);
  }
  lines.push(`  ${quoteEventKey(decl.name)}: ${tsType};`);
}

lines.push('}');
lines.push('');
lines.push('/**');
lines.push(' * Utility type — get the payload type for a specific event by name.');
lines.push(' *');
lines.push(' * @example');
lines.push(" *   type StartedPayload = EventPayload<'pipeline:run:started'>;");
lines.push(' */');
lines.push('export type EventPayload<K extends keyof EventPayloadMap> = EventPayloadMap[K];');
lines.push('');

const output = lines.join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, output, 'utf8');

console.log(
  `wrote ${outFile} (${allDeclarations.length} events)`,
);

// ---------------------------------------------------------------------------
// Wave A2 — src/generated/client-frames.ts
//
// Emits:
//   - ClientFramePayloadMap: every outbound client→gateway frame
//     (declarations in the `client.*` namespace), keyed by event name.
//   - ClientFramePayload<K> utility type.
//   - Per-service union types:
//       <Service>OutboundFrame — union of client.<service>.* payloads
//       <Service>InboundFrame  — union of ws.<service>.* payloads
//     (inbound unions reference EventPayloadMap from ./event-types so the
//      payload shapes are defined exactly once).
// ---------------------------------------------------------------------------

/** 'feature-flag' → 'FeatureFlag', 'chat' → 'Chat', etc. */
function pascalCase(segment: string): string {
  return segment
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Extract the service segment from `client.<service>.<action>` / `ws.<service>.<variant>`. */
function serviceOf(name: string): string | null {
  const parts = name.split('.');
  return parts.length >= 3 ? parts[1]! : null; // skips 2-segment names like 'ws.error'
}

const clientFrameDecls = allDeclarations.filter((d) => d.name.startsWith('client.'));
const inboundWsDecls = allDeclarations.filter((d) => d.name.startsWith('ws.'));

const cfLines: string[] = [
  '// AUTO-GENERATED — do not edit manually. Run: npm run generate-types',
  `// Generated at: ${new Date().toISOString()}`,
  '',
  '// prettier-ignore-file',
  '/* eslint-disable */',
  '',
  "import type { EventPayloadMap } from './event-types';",
  '',
  '/**',
  ' * Map from every declared OUTBOUND client→gateway WS frame name',
  ' * (`client.<service>.<action>`) to its frame payload type.',
  ' *',
  ' * Usage:',
  ' * ```ts',
  " * import type { ClientFramePayloadMap, ClientFramePayload } from '@connorhoehn/event-catalog/client-frames';",
  ' *',
  " * function send<K extends keyof ClientFramePayloadMap>(name: K, frame: ClientFramePayload<K>) {",
  ' *   // frame is fully typed',
  ' * }',
  ' * ```',
  ' */',
  'export interface ClientFramePayloadMap {',
];

for (const decl of clientFrameDecls) {
  const tsType = jsonSchemaToTs(decl.schema as Record<string, unknown>, 1);
  if (decl.description) {
    cfLines.push(`  /** ${decl.description.replace(/\*\//g, '* /')} */`);
  }
  cfLines.push(`  ${quoteEventKey(decl.name)}: ${tsType};`);
}

cfLines.push('}');
cfLines.push('');
cfLines.push('/**');
cfLines.push(' * Utility type — get the frame payload type for a specific outbound');
cfLines.push(' * client frame by name.');
cfLines.push(' *');
cfLines.push(' * @example');
cfLines.push(" *   type SendFrame = ClientFramePayload<'client.chat.send'>;");
cfLines.push(' */');
cfLines.push('export type ClientFramePayload<K extends keyof ClientFramePayloadMap> = ClientFramePayloadMap[K];');
cfLines.push('');

// Per-service OUTBOUND unions (client.<service>.*).
const outboundByService = new Map<string, string[]>();
for (const decl of clientFrameDecls) {
  const svc = serviceOf(decl.name);
  if (!svc) continue;
  const list = outboundByService.get(svc) ?? [];
  list.push(decl.name);
  outboundByService.set(svc, list);
}

cfLines.push('// ---------------------------------------------------------------------------');
cfLines.push('// Per-service OUTBOUND frame unions (client → gateway)');
cfLines.push('// ---------------------------------------------------------------------------');
cfLines.push('');
for (const [svc, names] of outboundByService) {
  const typeName = `${pascalCase(svc)}OutboundFrame`;
  const union = names.map((n) => `ClientFramePayloadMap['${n}']`).join('\n  | ');
  cfLines.push(`/** Union of every outbound client→gateway frame for the \`${svc}\` service. */`);
  cfLines.push(`export type ${typeName} =`);
  cfLines.push(`  | ${union};`);
  cfLines.push('');
}

// Per-service INBOUND unions (ws.<service>.*), referencing EventPayloadMap.
const inboundByService = new Map<string, string[]>();
for (const decl of inboundWsDecls) {
  const svc = serviceOf(decl.name);
  if (!svc) continue;
  const list = inboundByService.get(svc) ?? [];
  list.push(decl.name);
  inboundByService.set(svc, list);
}

cfLines.push('// ---------------------------------------------------------------------------');
cfLines.push('// Per-service INBOUND frame unions (gateway → client, ws.* declarations)');
cfLines.push('// ---------------------------------------------------------------------------');
cfLines.push('');
for (const [svc, names] of inboundByService) {
  const typeName = `${pascalCase(svc)}InboundFrame`;
  const union = names.map((n) => `EventPayloadMap['${n}']`).join('\n  | ');
  cfLines.push(`/** Union of every inbound gateway→client push frame for the \`${svc}\` service. */`);
  cfLines.push(`export type ${typeName} =`);
  cfLines.push(`  | ${union};`);
  cfLines.push('');
}

writeFileSync(clientFramesOutFile, cfLines.join('\n'), 'utf8');

console.log(
  `wrote ${clientFramesOutFile} (${clientFrameDecls.length} outbound frames, ` +
  `${outboundByService.size} outbound unions, ${inboundByService.size} inbound unions)`,
);
