// scripts/generate-types.ts
//
// Generates `src/generated/event-types.ts` — a TypeScript EventPayloadMap
// keyed by every event name declared in this package.
//
// Run: npm run generate-types
//
// The output file is committed so consumers get types without running the
// generator themselves.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDeclarations } from '../src/declarations/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'src', 'generated', 'event-types.ts');

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
