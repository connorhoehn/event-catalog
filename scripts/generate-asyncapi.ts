// scripts/generate-asyncapi.ts
//
// Generates the two committed AsyncAPI documents in `contracts/`.
//
// Run: npm run generate-asyncapi
//
// ---------------------------------------------------------------------------
// WHY TWO DOCUMENTS
// ---------------------------------------------------------------------------
//
// The registry holds 229 declarations. They do not share a protocol, and they
// do not share an addressing model — so they cannot honestly share an
// AsyncAPI document.
//
//   contracts/asyncapi.yaml           AsyncAPI 2.6   the gateway WebSocket
//   contracts/asyncapi.registry.yaml  AsyncAPI 3.0   the broker backbone
//
// The split is not the `client.` / `ws.` name prefix it looks like. It is a
// property of the declarations, and the prefix merely happens to name it:
//
//   * Every declaration in namespace `client` / `ws` has NO `channel` and NO
//     `queue`, because it has no broker address to declare. All 110 are
//     multiplexed over one WebSocket connection and discriminated in-band by
//     `{service, action}` (outbound) or `type` (inbound). AsyncAPI models
//     that as ONE channel whose operations carry a `oneOf` over every frame.
//   * Every other declaration IS broker-addressed — a Redis pub/sub channel
//     or a message-queue queue, one address per event. AsyncAPI models that
//     as one channel PER event, each with its own address and server.
//
// `tests/asyncapi-structure.test.ts` asserts that property rather than
// trusting the comment, so the day a gateway frame grows a `channel` the
// split is re-examined instead of silently mis-describing it.
//
// Cramming both into one file would mean two incompatible channel styles, a
// `ws://` server sitting next to a `redis://` and an `http://` one, and
// codegen that produces nonsense for whichever half it guesses wrong. Two
// documents, each internally consistent, each stating its own coverage in
// machine-readable form (`info.x-event-catalog-coverage`), is the honest
// shape. Union of the two = all 229; intersection = empty; both asserted in
// the tests.
//
// ---------------------------------------------------------------------------
// WHY AsyncAPI 2.6 FOR THE WEBSOCKET DOCUMENT
// ---------------------------------------------------------------------------
//
// 2.6 is application-centric: `publish` / `subscribe` on a single channel is
// exactly "frames you send / frames you receive on this socket", which is
// what a WebSocket adopter needs. It also keeps `messages` with an embedded
// JSON Schema `payload` (`schemaFormat: application/schema+json`), which lets
// us drop each declaration's existing JSON Schema in verbatim with zero
// translation. The declarations already ARE JSON Schema — frame shapes are
// never re-derived here.
//
// The backbone document is 3.0 because per-event channels want 3.0's
// `servers` / `operations` split, and because it is produced by the SAME
// `buildAsyncApiSpec` the server renders live at `GET /api/asyncapi` — the
// published artifact and the live endpoint cannot drift into describing the
// backbone differently.
//
// Both output files are committed so non-JS adopters get the contracts
// without running the generator.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { allDeclarations } from '../src/declarations/index.js';
import { Registry } from '../src/registry/index.js';
import { buildAsyncApiSpec } from '../src/server/asyncapi.js';
import type { EventDeclaration } from '../src/types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, '..', 'contracts');

export const WS_OUT_FILE = join(contractsDir, 'asyncapi.yaml');
export const REGISTRY_OUT_FILE = join(contractsDir, 'asyncapi.registry.yaml');

const pkgVersion = (
  JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string }
).version ?? '0.0.0';

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

/**
 * Namespaces whose events are gateway WebSocket frames: no broker address,
 * multiplexed over one connection. See the WHY TWO DOCUMENTS note above.
 */
export const GATEWAY_FRAME_NAMESPACES = ['client', 'ws'] as const;

/** A declaration's namespace, explicit or derived from the dotted prefix. */
function namespaceOf(decl: EventDeclaration): string {
  return decl.namespace ?? decl.name.split(/[.:]/)[0]!;
}

export function isGatewayFrame(decl: EventDeclaration): boolean {
  return (GATEWAY_FRAME_NAMESPACES as readonly string[]).includes(namespaceOf(decl));
}

const outbound = allDeclarations.filter((d) => d.name.startsWith('client.'));
const inbound = allDeclarations.filter((d) => d.name.startsWith('ws.'));
const gatewayFrames = allDeclarations.filter(isGatewayFrame);
const backboneEvents = allDeclarations.filter((d) => !isGatewayFrame(d));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize an event name into a component key (AsyncAPI keys must be safe). */
export function componentKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

interface MessageComponent {
  messageId: string;
  name: string;
  title: string;
  summary?: string;
  schemaFormat: string;
  payload: Record<string, unknown>;
  'x-aliases'?: unknown;
}

function toMessageComponent(decl: EventDeclaration): MessageComponent {
  return {
    messageId: decl.name,
    name: decl.name,
    title: decl.name,
    ...(decl.description ? { summary: decl.description } : {}),
    schemaFormat: 'application/schema+json;version=draft-07',
    payload: decl.schema as Record<string, unknown>,
    // A deprecated alias is a frame name still on the wire. 2.6 has no native
    // slot for it, so it rides as an extension rather than being dropped —
    // silently omitting it would make a client written from this document
    // ignore live frames. No gateway frame has one today; this is here so
    // that stays a fact about the declarations and not a gap in the generator.
    ...(decl.aliases && decl.aliases.length > 0 ? { 'x-aliases': decl.aliases } : {}),
  };
}

/**
 * The machine-readable coverage statement both documents carry in `info`.
 * A reader who never opens the README still learns, from the artifact
 * itself, exactly what it does and does not describe.
 */
function coverageBlock(describedHere: number, companionFile: string): Record<string, unknown> {
  return {
    registryDeclarations: allDeclarations.length,
    describedInThisDocument: describedHere,
    describedInCompanionDocument: {
      file: companionFile,
      count: allDeclarations.length - describedHere,
    },
    partitionRule:
      'Declarations in namespace `client` or `ws` are gateway WebSocket frames: they carry no '
      + '`channel` and no `queue` because they are multiplexed over one connection, so they are '
      + 'described in contracts/asyncapi.yaml as a single channel with a oneOf per direction. '
      + 'Every other declaration is broker-addressed (a Redis pub/sub channel or a message-queue '
      + 'queue) and is described in contracts/asyncapi.registry.yaml as one channel per event.',
    fullInventory:
      'contracts/registry.snapshot.json lists all '
      + `${allDeclarations.length} events with their schema fingerprints.`,
  };
}

// ---------------------------------------------------------------------------
// Document 1 — the gateway WebSocket protocol (AsyncAPI 2.6)
// ---------------------------------------------------------------------------

export function buildGatewayWsDoc(): Record<string, unknown> {
  const messages: Record<string, MessageComponent> = {};
  for (const decl of [...outbound, ...inbound]) {
    messages[componentKey(decl.name)] = toMessageComponent(decl);
  }

  // The gateway multiplexes EVERY frame over a single WebSocket connection
  // (no per-topic URLs). We model that as one AsyncAPI channel `/` (the WS
  // endpoint) whose `subscribe` operation delivers all gateway→client frames
  // and whose `publish` operation accepts all client→gateway frames, each as
  // a `oneOf` over the message components.
  const publishMessages = outbound.map((d) => ({
    $ref: `#/components/messages/${componentKey(d.name)}`,
  }));
  const subscribeMessages = inbound.map((d) => ({
    $ref: `#/components/messages/${componentKey(d.name)}`,
  }));

  const channels = {
    '/': {
      description:
        'The single multiplexed gateway WebSocket. All frames flow over this one connection — there are no per-topic URLs. Outbound (client→gateway) frames are JSON objects discriminated by `{ service, action }`; inbound (gateway→client) frames are discriminated by `type` (colon-form `service:variant` or an `{ type, action }` envelope). The connect URL accepts an auth token (Bearer header or `?token=` query per gateway config).',
      bindings: {
        ws: {
          bindingVersion: '0.1.0',
          method: 'GET',
        },
      },
      // From the SERVER's perspective: `publish` = messages the app/client sends
      // to the server; `subscribe` = messages the app/client receives. AsyncAPI
      // 2.x is application-centric, so for a client adopter:
      //   publish   → frames YOU send to the gateway (client.*)
      //   subscribe → frames YOU receive from the gateway (ws.*)
      publish: {
        operationId: 'sendClientFrame',
        summary: 'Frames the client SENDS to the gateway (client→gateway).',
        description:
          'Every outbound frame is a JSON object with `service` + `action` string literals plus per-action fields. The gateway MessageValidator enforces the service/action/channel structure; extra fields pass through (additionalProperties: true).',
        message: {
          oneOf: publishMessages,
        },
      },
      subscribe: {
        operationId: 'receiveGatewayFrame',
        summary: 'Frames the client RECEIVES from the gateway (gateway→client).',
        description:
          'The first frame after connect is always `ws.session.connected` (`type:"session"`) — the gateway queues every other outbound frame until it has gone out. Thereafter the gateway pushes `ws.*` send-back / broadcast frames discriminated by `type`.',
        message: {
          oneOf: subscribeMessages,
        },
      },
    },
  };

  return {
    asyncapi: '2.6.0',
    info: {
      title: 'websocket-gateway WebSocket protocol',
      version: '1.0.0',
      description: [
        'Machine-readable contract for the websocket-gateway real-time WebSocket',
        'protocol, generated from the `@connorhoehn/event-catalog` declarations',
        '(`client.*` outbound frames + `ws.*` inbound send-backs).',
        '',
        'AUDIENCE: non-React / non-JS adopters who cannot read the',
        '`@connorhoehn/realtime-modules/client` hook source. JS/TS adopters',
        'should prefer the generated types (`@connorhoehn/event-catalog/types` +',
        '`/client-frames`).',
        '',
        'TRANSPORT: a single multiplexed WebSocket. All frames share one',
        'connection; there are no per-topic URLs. Frames are JSON. Outbound',
        'frames carry `{ service, action, channel?, ... }`; inbound frames carry',
        'a `type` discriminator.',
        '',
        `SCOPE: this document describes ${gatewayFrames.length} of the registry's`,
        `${allDeclarations.length} declarations — the gateway WebSocket frames, and`,
        'only those. It is NOT the platform event inventory. The other',
        `${backboneEvents.length} declarations are broker-addressed backbone events`,
        '(Redis pub/sub and the durable message-queue) and are described in the',
        'companion document `contracts/asyncapi.registry.yaml`. See',
        '`info.x-event-catalog-coverage` below for the exact partition rule.',
        '',
        'REGENERATE: `npm run generate-asyncapi` in @connorhoehn/event-catalog.',
        'DO NOT hand-edit — frame shapes are owned by src/declarations/.',
      ].join('\n'),
      license: { name: 'UNLICENSED' },
      'x-event-catalog-coverage': coverageBlock(
        gatewayFrames.length,
        'contracts/asyncapi.registry.yaml',
      ),
    },
    externalDocs: {
      description:
        'Companion document: the broker-addressed backbone events this file does not cover.',
      url: './asyncapi.registry.yaml',
    },
    servers: {
      localDev: {
        url: 'ws://localhost:8080/ws',
        protocol: 'ws',
        description: 'Local dev gateway (Tilt). Path/port may differ per deployment.',
      },
      production: {
        url: 'wss://{host}/ws',
        protocol: 'wss',
        description: 'Deployed gateway. `host` is environment-specific.',
        variables: {
          host: { default: 'gateway.example.com', description: 'gateway hostname' },
        },
      },
    },
    defaultContentType: 'application/json',
    channels,
    components: {
      messages,
    },
    tags: [
      { name: 'chat' },
      { name: 'presence' },
      { name: 'reaction' },
      { name: 'activity' },
      { name: 'crdt' },
      { name: 'cursor' },
      { name: 'fileupload' },
      { name: 'videohangout' },
      { name: 'call' },
      { name: 'pipeline' },
      { name: 'upload' },
      { name: 'notification' },
      { name: 'capability' },
      { name: 'feature-flag' },
      { name: 'subscribe' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Document 2 — the broker-addressed backbone (AsyncAPI 3.0)
// ---------------------------------------------------------------------------

/**
 * Seed a fresh in-memory Registry with every declaration. No Redis, no
 * network — `Registry` without a client is a pure map plus schema-shape
 * validation, which is exactly the validation we want at generate time.
 */
export function seededRegistry(): Registry {
  const registry = new Registry();
  for (const decl of allDeclarations) registry.declare(decl);
  return registry;
}

export function buildRegistryDoc(): Record<string, unknown> {
  return buildAsyncApiSpec(seededRegistry(), {
    title: 'event-catalog backbone events',
    version: pkgVersion,
    // The one place the partition is applied to the shared builder.
    excludeNamespaces: [...GATEWAY_FRAME_NAMESPACES],
    infoExtensions: {
      'x-event-catalog-coverage': coverageBlock(backboneEvents.length, 'contracts/asyncapi.yaml'),
    },
    externalDocs: {
      description:
        'Companion document: the gateway WebSocket frames this file does not cover.',
      url: './asyncapi.yaml',
    },
    description: [
      'Machine-readable contract for the cross-service events that move over the',
      "platform's brokers: Redis pub/sub (ephemeral `signal`) and the",
      '@connorhoehn/message-queue service (persisted, retryable `durable`).',
      'Generated from the `@connorhoehn/event-catalog` declarations.',
      '',
      'Each event gets its own channel, addressed by the Redis channel or queue',
      'name it is actually published to, and attached to the server that address',
      'is valid on. A `transport: both` event appears twice — once per server —',
      'because it genuinely goes to both.',
      '',
      `SCOPE: this document describes ${backboneEvents.length} of the registry's`,
      `${allDeclarations.length} declarations. The other ${gatewayFrames.length} are`,
      'gateway WebSocket frames with no broker address; they are described in the',
      'companion document `contracts/asyncapi.yaml`. See',
      '`info.x-event-catalog-coverage` for the exact partition rule.',
      '',
      'OPERATIONS are producer-side only (`action: send`). The registry records',
      'producers at declare time; consumers register at runtime, so ask a live',
      'catalog (`GET /api/subscribers`) for who reads an event.',
      '',
      'REGENERATE: `npm run generate-asyncapi` in @connorhoehn/event-catalog.',
      'DO NOT hand-edit — event shapes are owned by src/declarations/.',
    ].join('\n'),
  });
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * `aliasDuplicateObjects: false` is load-bearing. The `yaml` package emits a
 * YAML anchor/alias (`&a1` / `*a1`) whenever the same object appears twice in
 * the tree — which happens here because the field glossary reuses property
 * objects across schemas, and because a `transport: both` event's aliases
 * array is shared by its two messages. Anchors are legal YAML 1.2, but they
 * make a published contract depend on the reader's parser resolving them, and
 * they are unreadable in a diff. Duplicating the value costs bytes and buys a
 * self-contained artifact. (The committed asyncapi.yaml carried three such
 * anchors before this change.)
 */
const YAML_OPTS = { lineWidth: 0, aliasDuplicateObjects: false } as const;

function header(scope: string): string {
  return (
    '# AUTO-GENERATED — do not edit manually. Run: npm run generate-asyncapi\n'
    + `# Scope: ${scope}\n`
    + '# Source of truth: @connorhoehn/event-catalog src/declarations/\n'
  );
}

export function writeContracts(): void {
  mkdirSync(contractsDir, { recursive: true });

  const wsDoc = buildGatewayWsDoc();
  writeFileSync(
    WS_OUT_FILE,
    header(
      `the gateway WebSocket protocol — ${gatewayFrames.length} of ${allDeclarations.length} declarations`,
    ) + stringify(wsDoc, YAML_OPTS),
    'utf8',
  );

  const registryDoc = buildRegistryDoc();
  writeFileSync(
    REGISTRY_OUT_FILE,
    header(
      `broker-addressed backbone events — ${backboneEvents.length} of ${allDeclarations.length} declarations`,
    ) + stringify(registryDoc, YAML_OPTS),
    'utf8',
  );

  const registryChannels = Object.keys(
    (registryDoc as { channels: Record<string, unknown> }).channels,
  ).length;
  console.log(
    `wrote ${WS_OUT_FILE} `
    + `(${outbound.length} outbound client frames + ${inbound.length} inbound ws frames = `
    + `${gatewayFrames.length} messages)`,
  );
  console.log(
    `wrote ${REGISTRY_OUT_FILE} `
    + `(${backboneEvents.length} backbone events over ${registryChannels} channels)`,
  );
  console.log(
    `coverage: ${gatewayFrames.length} + ${backboneEvents.length} = ${allDeclarations.length} declarations, no gaps`,
  );
}

// Writing is the point when run as `npm run generate-asyncapi`; it must NOT
// happen when `tests/asyncapi*.test.ts` imports the builders to check the
// committed files against a fresh render.
if (!process.env.VITEST) {
  writeContracts();
}
