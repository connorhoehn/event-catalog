// src/cli/commands/lint.ts
//
// wave24-a — `event-catalog lint <file>`. Reads a JSON file
// containing either an array of EventDeclaration-shaped objects or
// `{ events: [...] }`, runs validateSchemaShape on each, prints a
// per-event report, and exits non-zero if any are malformed.
//
// CI usage:
//   event-catalog lint declarations.json
//   echo $?  # 0 = clean, 1 = at least one declaration has shape errors

import { readFileSync } from 'node:fs';
import { validateSchemaShape } from '../../registry/schema-shape.js';

interface LintInput {
  events?: Array<{ name?: string; schema?: unknown }>;
}

export async function lint(args: string[]): Promise<number> {
  const file = args[0];
  if (!file) {
    console.error('usage: event-catalog lint <file>');
    return 2;
  }

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`event-catalog lint: cannot read "${file}": ${(err as Error).message}`);
    return 2;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`event-catalog lint: "${file}" is not valid JSON: ${(err as Error).message}`);
    return 2;
  }

  // Accept both `[...]` and `{events: [...]}` for ergonomics.
  const events: Array<{ name?: string; schema?: unknown }> = Array.isArray(parsed)
    ? (parsed as Array<{ name?: string; schema?: unknown }>)
    : (parsed as LintInput).events ?? [];

  if (!Array.isArray(events) || events.length === 0) {
    console.error(`event-catalog lint: "${file}" contained no events to lint`);
    return 2;
  }

  let bad = 0;
  for (const [i, evt] of events.entries()) {
    const name = evt.name ?? `<event #${i}>`;
    if (!evt.schema || typeof evt.schema !== 'object') {
      console.log(`✗ ${name} — missing or non-object schema`);
      bad += 1;
      continue;
    }
    const r = validateSchemaShape(evt.schema as Record<string, unknown>);
    if (r.ok) {
      console.log(`✓ ${name}`);
    } else {
      bad += 1;
      console.log(`✗ ${name}`);
      for (const err of r.errors) console.log(`    ${err}`);
    }
  }

  console.log('');
  console.log(`${events.length - bad} valid, ${bad} invalid (of ${events.length})`);
  return bad === 0 ? 0 : 1;
}
