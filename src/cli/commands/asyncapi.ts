// src/cli/commands/asyncapi.ts
//
// wave25-c — `event-catalog asyncapi --catalog-url=<url> [--output=file.json]
//                                    [--title=T] [--version=V] [--namespace=ns]`
//
// Fetches the wave24-c AsyncAPI 3.0 spec and either writes it to a
// file or echoes it to stdout. Use case: CI step that regenerates
// asyncapi.json on every catalog change so docs stay in sync.
//
// Examples:
//   event-catalog asyncapi --catalog-url=https://catalog > asyncapi.json
//   event-catalog asyncapi --catalog-url=https://catalog --output=asyncapi.json
//   event-catalog asyncapi --catalog-url=https://catalog --namespace=auth

import { writeFileSync } from 'node:fs';
import { formatError, parseFlags, usageError } from '../_args.js';

const BIN = 'event-catalog asyncapi';
const USAGE = 'event-catalog asyncapi --catalog-url=<url> [--output=file] [--title=T] [--version=V] [--namespace=ns]';

export const ASYNCAPI_HELP = `
event-catalog asyncapi — fetch the catalog's AsyncAPI 3.0 spec

USAGE
  ${USAGE}

OPTIONS
  --catalog-url=<url>   Catalog base URL (required)
  --output=<file>       Write the spec to a file instead of stdout
  --title=<text>        Override the spec's info.title
  --version=<semver>    Override the spec's info.version
  --namespace=<ns>      Restrict the spec to one namespace
  --help, -h            Show this help

EXIT CODES
  0   Spec written
  1   Catalog unreachable, non-2xx response, or the output file is unwritable
  2   Usage error
`.trim();

const SPEC = { value: ['catalog-url', 'output', 'title', 'version', 'namespace'] } as const;

export async function asyncapi(args: string[]): Promise<number> {
  const parsed = parseFlags(args, SPEC);
  if (!parsed.ok) return usageError(BIN, parsed.error, USAGE);
  if (parsed.args.help) {
    console.log(ASYNCAPI_HELP);
    return 0;
  }
  const { positional, values } = parsed.args;
  if (positional.length > 0) {
    return usageError(BIN, `unexpected argument "${positional[0]}" — asyncapi takes flags only`, USAGE);
  }

  const url = values['catalog-url'];
  if (!url) {
    return usageError(BIN, '--catalog-url is required', USAGE);
  }
  const output = values['output'];

  const params = new URLSearchParams();
  if (values['title']) params.set('title', values['title']);
  if (values['version']) params.set('version', values['version']);
  if (values['namespace']) params.set('namespace', values['namespace']);
  const qs = params.toString();
  const ep = `${url.replace(/\/$/, '')}/api/asyncapi${qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(ep);
  } catch (err) {
    console.error(`${BIN}: fetch failed: ${formatError(err)}`);
    return 1;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`${BIN}: HTTP ${res.status}: ${body.slice(0, 200)}`);
    return 1;
  }

  let spec: string;
  try {
    spec = await res.text();
  } catch (err) {
    console.error(`${BIN}: could not read response from ${ep}: ${formatError(err)}`);
    return 1;
  }

  if (output) {
    try {
      writeFileSync(output, spec);
      console.error(`${BIN}: wrote ${spec.length} bytes to ${output}`);
    } catch (err) {
      console.error(`${BIN}: write failed: ${formatError(err, false)}`);
      return 1;
    }
  } else {
    process.stdout.write(spec);
  }
  return 0;
}
