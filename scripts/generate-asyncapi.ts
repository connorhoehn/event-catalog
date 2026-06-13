// scripts/generate-asyncapi.ts
//
// Generates `contracts/asyncapi.yaml` — an AsyncAPI 2.6.0 document describing
// the websocket-gateway WebSocket protocol, derived FROM the event-catalog
// declarations (the same `allDeclarations` import generate-types.ts uses) so
// the contract stays in sync with the schemas.
//
// Why AsyncAPI 2.6 (not 3.x): 2.6 keeps `messages` with an embedded JSON
// Schema `payload` (`schemaFormat: application/schema+json`), which lets us
// drop each declaration's existing JSON Schema in verbatim with zero
// translation. The declarations already ARE JSON Schema — we don't re-derive
// frame shapes here.
//
// Coverage:
//   - Session bootstrap frame ({type:'session'}) — the gateway's welcome
//     frame, declared inline here (it has no event-catalog declaration; it is
//     produced directly by websocket-gateway src/server.ts, see note below).
//   - OUTBOUND client→gateway frames: every `client.*` declaration
//     (chat join/leave/send/history, presence subscribe/set/..., reaction
//     send/subscribe/..., activity, crdt, fileupload, videohangout,
//     subscribe).
//   - INBOUND gateway→client send-backs: every `ws.*` declaration.
//
// Run: npm run generate-asyncapi
//
// The output file is committed so non-JS adopters get the contract without
// running the generator.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { allDeclarations } from '../src/declarations/index.js';
import type { EventDeclaration } from '../src/types/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'contracts', 'asyncapi.yaml');

// ---------------------------------------------------------------------------
// Session bootstrap frame.
//
// This frame is NOT in event-catalog (it is emitted directly by
// websocket-gateway src/server.ts on connect, not through the catalog). It is
// declared inline so the AsyncAPI contract is complete for adopters — without
// it a non-JS client cannot tell what the first frame after connect looks
// like. Keep in sync with server.ts `sendToClient(clientId, { type:'session', ... })`.
// ---------------------------------------------------------------------------

const sessionBootstrapSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'session' },
    status: { type: 'string', const: 'connected' },
    clientId: { type: 'string', description: 'gateway-assigned connection id, echoed on all client frames' },
    sessionToken: { type: 'string', description: 'opaque token for resume-on-reconnect' },
    restored: { type: 'boolean', description: 'true when this connection restored a prior session' },
    nodeId: { type: 'string', description: 'id of the gateway node serving this connection' },
    enabledServices: {
      type: 'array',
      items: { type: 'string' },
      description: 'services this gateway has enabled (chat, presence, reaction, ...)',
    },
    timestamp: { type: 'string', description: 'ISO-8601' },
  },
  required: ['type', 'status', 'clientId'],
  additionalProperties: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize an event name into a component key (AsyncAPI keys must be safe). */
function componentKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/** 'client.chat.send' → operationId 'sendClientChatSend' style camel id. */
function operationId(prefix: string, name: string): string {
  const camel = name
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
  return prefix + camel.charAt(0).toUpperCase() + camel.slice(1);
}

interface MessageComponent {
  messageId: string;
  name: string;
  title: string;
  summary?: string;
  schemaFormat: string;
  payload: Record<string, unknown>;
}

function toMessageComponent(decl: EventDeclaration): MessageComponent {
  return {
    messageId: decl.name,
    name: decl.name,
    title: decl.name,
    ...(decl.description ? { summary: decl.description } : {}),
    schemaFormat: 'application/schema+json;version=draft-07',
    payload: decl.schema as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Partition declarations
// ---------------------------------------------------------------------------

const outbound = allDeclarations.filter((d) => d.name.startsWith('client.'));
const inbound = allDeclarations.filter((d) => d.name.startsWith('ws.'));

// ---------------------------------------------------------------------------
// Build components.messages
// ---------------------------------------------------------------------------

const messages: Record<string, MessageComponent> = {
  SessionBootstrap: {
    messageId: 'session',
    name: 'session',
    title: 'session',
    summary:
      'Gateway welcome frame, sent once immediately after the WebSocket connection opens (before any client frame). Carries the assigned clientId, a resume token, and the list of enabled services. Produced directly by websocket-gateway src/server.ts (not via event-catalog).',
    schemaFormat: 'application/schema+json;version=draft-07',
    payload: sessionBootstrapSchema,
  },
};

for (const decl of [...outbound, ...inbound]) {
  messages[componentKey(decl.name)] = toMessageComponent(decl);
}

// ---------------------------------------------------------------------------
// Build channels.
//
// The gateway multiplexes EVERY frame over a single WebSocket connection
// (no per-topic URLs). We model that as one AsyncAPI channel `/` (the WS
// endpoint) whose `subscribe` operation delivers all gateway→client frames
// and whose `publish` operation accepts all client→gateway frames, each as a
// `oneOf` over the message components.
// ---------------------------------------------------------------------------

const publishMessages = outbound.map((d) => ({
  $ref: `#/components/messages/${componentKey(d.name)}`,
}));

const subscribeMessages = [
  { $ref: '#/components/messages/SessionBootstrap' },
  ...inbound.map((d) => ({ $ref: `#/components/messages/${componentKey(d.name)}` })),
];

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
    //   subscribe → frames YOU receive from the gateway (session + ws.*)
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
        'The first frame after connect is always the SessionBootstrap (`type:"session"`). Thereafter the gateway pushes `ws.*` send-back / broadcast frames discriminated by `type`.',
      message: {
        oneOf: subscribeMessages,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Assemble the document
// ---------------------------------------------------------------------------

const doc = {
  asyncapi: '2.6.0',
  info: {
    title: 'websocket-gateway WebSocket protocol',
    version: '1.0.0',
    description: [
      'Machine-readable contract for the websocket-gateway real-time WebSocket',
      'protocol, generated from the `@connorhoehn/event-catalog` declarations',
      '(`client.*` outbound frames + `ws.*` inbound send-backs) plus the',
      'session-bootstrap welcome frame.',
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
      'REGENERATE: `npm run generate-asyncapi` in @connorhoehn/event-catalog.',
      'DO NOT hand-edit — frame shapes are owned by src/declarations/.',
    ].join('\n'),
    license: { name: 'UNLICENSED' },
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

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const header =
  '# AUTO-GENERATED — do not edit manually. Run: npm run generate-asyncapi\n' +
  `# Generated at: ${new Date().toISOString()}\n` +
  '# Source of truth: @connorhoehn/event-catalog src/declarations/\n';

const yamlBody = stringify(doc, { lineWidth: 0 });

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, header + yamlBody, 'utf8');

console.log(
  `wrote ${outFile} ` +
    `(${outbound.length} outbound client frames + ${inbound.length} inbound ws frames + 1 session bootstrap = ` +
    `${outbound.length + inbound.length + 1} messages)`,
);
