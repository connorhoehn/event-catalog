/**
 * Wire envelope contracts used by signal-transport publishers.
 *
 * These shapes flow over Redis pub/sub between platform-api and
 * websocket-gateway (and any future signal-transport publisher) and are
 * defined here as the single source of truth — eliminating the prior
 * drift hazard where both ends hand-rolled the same shape independently.
 *
 * Phase 55 of the event-catalog roadmap (E2.1).
 */

/**
 * Inner per-event message shape produced by `publishSignal`-style call sites.
 * Sits inside `ChannelMessageEnvelope.message`.
 */
export interface SignalMessage<TPayload = unknown> {
  /** Event name (e.g. 'social:post', 'doc:comment_added'). */
  type: string;
  /** Channel/room identifier the message is scoped to. */
  channel: string;
  /** Application payload. */
  payload: TPayload;
  /** ISO-8601 timestamp at producer wall clock. */
  timestamp: string;
}

/**
 * Outer envelope published on Redis channel `websocket:route:{channel}`.
 * The gateway's MessageRouter parses this on receive and fans out to local
 * WebSocket subscribers.
 *
 * The `seq` field is producer-assigned. The gateway maintains a per-channel
 * monotonic counter; platform-api currently emits `0` (no sequencing on the
 * platform-api → gateway hop).
 */
export interface ChannelMessageEnvelope<TMessage = SignalMessage> {
  type: 'channel_message';
  channel: string;
  message: TMessage;
  excludeClientId: string | null;
  fromNode: string;
  seq: number;
  timestamp: string;
  /**
   * Optional list of gateway node IDs this envelope is addressed to.
   * Omit for peer-to-peer point delivery (handled by distributed-core
   * PeerMessaging) — the routing layer assumes the message is for the
   * single target node when this field is absent.
   */
  targetNodes?: string[];
}

export interface BuildSignalMessageArgs<TPayload> {
  eventName: string;
  channel: string;
  payload: TPayload;
  /** Defaults to `new Date().toISOString()`. */
  timestamp?: string;
}

export function buildSignalMessage<TPayload>(
  args: BuildSignalMessageArgs<TPayload>,
): SignalMessage<TPayload> {
  return {
    type: args.eventName,
    channel: args.channel,
    payload: args.payload,
    timestamp: args.timestamp ?? new Date().toISOString(),
  };
}

export interface BuildChannelMessageEnvelopeArgs<TMessage> {
  channel: string;
  message: TMessage;
  fromNode: string;
  /** Defaults to 0 (no sequencing). */
  seq?: number;
  /** Defaults to null. */
  excludeClientId?: string | null;
  /** Defaults to `new Date().toISOString()`. */
  timestamp?: string;
  /** Omit for point-to-peer deliveries. */
  targetNodes?: string[];
}

export function buildChannelMessageEnvelope<TMessage>(
  args: BuildChannelMessageEnvelopeArgs<TMessage>,
): ChannelMessageEnvelope<TMessage> {
  const envelope: ChannelMessageEnvelope<TMessage> = {
    type: 'channel_message',
    channel: args.channel,
    message: args.message,
    excludeClientId: args.excludeClientId ?? null,
    fromNode: args.fromNode,
    seq: args.seq ?? 0,
    timestamp: args.timestamp ?? new Date().toISOString(),
  };
  if (args.targetNodes !== undefined) {
    envelope.targetNodes = args.targetNodes;
  }
  return envelope;
}

export function isChannelMessageEnvelope(
  value: unknown,
): value is ChannelMessageEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'channel_message'
    && typeof v.channel === 'string'
    && typeof v.message === 'object'
    && v.message !== null
    && typeof v.fromNode === 'string'
    && typeof v.seq === 'number'
    && typeof v.timestamp === 'string'
  );
}

/**
 * Redis channel pattern producers publish to and the gateway pSubscribes.
 * Exported so consumers don't hard-code the string.
 */
export function channelMessageRedisChannel(channelId: string): string {
  return `websocket:route:${channelId}`;
}

/**
 * Redis key for the set of gateway node IDs subscribed to a given channel.
 * Producers read this to populate `targetNodes`; the gateway's NodeManager
 * writes it.
 */
export function channelNodesRedisKey(channelId: string): string {
  return `websocket:channel:${channelId}:nodes`;
}

// ── JSON Schemas (Phase E2.1 close-out) ───────────────────────────────
//
// The TS types above describe the shape at compile time. The schemas
// below describe the same shape at runtime — for cross-language
// consumers, registry storage, and gateway-side drift guards on the
// pSubscribe path (today an envelope missing `targetNodes` would crash
// the gateway's `data.targetNodes.includes()` call; with a validator,
// the publisher can be rejected before that path runs).
//
// Schemas are draft-07. The `payload` field on SignalMessage is left
// unconstrained — per-event payload schemas live on individual
// EventDeclaration entries, not on the transport envelope.

/** JSON Schema for {@link SignalMessage}. */
export const signalMessageSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://event-catalog/schemas/SignalMessage',
  type: 'object',
  properties: {
    type: { type: 'string' },
    channel: { type: 'string' },
    payload: {},
    timestamp: { type: 'string', format: 'date-time' },
  },
  required: ['type', 'channel', 'payload', 'timestamp'],
  additionalProperties: true,
} as const;

/** JSON Schema for {@link ChannelMessageEnvelope}. */
export const channelMessageEnvelopeSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://event-catalog/schemas/ChannelMessageEnvelope',
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['channel_message'] },
    channel: { type: 'string' },
    message: signalMessageSchema,
    excludeClientId: { type: ['string', 'null'] },
    fromNode: { type: 'string' },
    seq: { type: 'number' },
    timestamp: { type: 'string', format: 'date-time' },
    targetNodes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'type',
    'channel',
    'message',
    'excludeClientId',
    'fromNode',
    'seq',
    'timestamp',
  ],
  additionalProperties: false,
} as const;
