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

import { validateSchemaShape } from '../../registry/schema-shape.js';
import { parseFlags, readJsonFile, usageError } from '../_args.js';

const BIN = 'event-catalog lint';
const USAGE = 'event-catalog lint <file>';

export const LINT_HELP = `
event-catalog lint — check event declarations for JSON Schema shape errors

USAGE
  ${USAGE}

ARGUMENTS
  <file>       JSON file holding either \`[{name, schema}, ...]\` or
               \`{ "events": [{name, schema}, ...] }\`
  --help, -h   Show this help

EXIT CODES
  0   Every declaration has a well-formed schema
  1   At least one declaration has shape errors
  2   Usage error, unreadable file, or malformed JSON
`.trim();

interface LintInput {
  events?: unknown;
}

export async function lint(args: string[]): Promise<number> {
  const parsed = parseFlags(args, {});
  if (!parsed.ok) return usageError(BIN, parsed.error, USAGE);
  if (parsed.args.help) {
    console.log(LINT_HELP);
    return 0;
  }

  const [file, ...extra] = parsed.args.positional;
  if (!file) {
    return usageError(BIN, 'a declarations file is required', USAGE);
  }
  if (extra.length > 0) {
    return usageError(BIN, `unexpected extra argument "${extra[0]}" — lint takes one file`, USAGE);
  }

  const loaded = readJsonFile(file, 'declarations file');
  if (!loaded.ok) {
    console.error(`${BIN}: ${loaded.error}`);
    return 2;
  }

  // Accept both `[...]` and `{events: [...]}` for ergonomics.
  const raw: unknown = Array.isArray(loaded.value)
    ? loaded.value
    : loaded.value && typeof loaded.value === 'object'
      ? (loaded.value as LintInput).events
      : undefined;

  if (!Array.isArray(raw) || raw.length === 0) {
    console.error(
      `${BIN}: "${file}" contained no events to lint `
      + '(expected an array of declarations or {"events": [...]})',
    );
    return 2;
  }

  const events = raw as unknown[];

  let bad = 0;
  for (const [i, entry] of events.entries()) {
    if (entry === null || typeof entry !== 'object') {
      console.log(`✗ <event #${i}> — declaration is not an object`);
      bad += 1;
      continue;
    }
    const evt = entry as { name?: unknown; schema?: unknown };
    const name = typeof evt.name === 'string' ? evt.name : `<event #${i}>`;
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
