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
export declare function buildSignalMessage<TPayload>(args: BuildSignalMessageArgs<TPayload>): SignalMessage<TPayload>;
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
export declare function buildChannelMessageEnvelope<TMessage>(args: BuildChannelMessageEnvelopeArgs<TMessage>): ChannelMessageEnvelope<TMessage>;
export declare function isChannelMessageEnvelope(value: unknown): value is ChannelMessageEnvelope;
/**
 * Redis channel pattern producers publish to and the gateway pSubscribes.
 * Exported so consumers don't hard-code the string.
 */
export declare function channelMessageRedisChannel(channelId: string): string;
/**
 * Redis key for the set of gateway node IDs subscribed to a given channel.
 * Producers read this to populate `targetNodes`; the gateway's NodeManager
 * writes it.
 */
export declare function channelNodesRedisKey(channelId: string): string;
export interface DirectMessageEnvelope<TMessage = unknown> {
    type: 'direct_message';
    clientId: string;
    message: TMessage;
    fromNode: string;
    targetNode: string;
    timestamp: string;
}
export interface BuildDirectMessageEnvelopeArgs<TMessage> {
    clientId: string;
    message: TMessage;
    fromNode: string;
    targetNode: string;
    /** Defaults to `new Date().toISOString()`. */
    timestamp?: string;
}
export declare function buildDirectMessageEnvelope<TMessage>(args: BuildDirectMessageEnvelopeArgs<TMessage>): DirectMessageEnvelope<TMessage>;
/** Redis channel a DirectMessageEnvelope is published on. */
export declare function directMessageRedisChannel(targetNode: string): string;
export interface BroadcastEnvelope<TMessage = unknown> {
    type: 'broadcast';
    message: TMessage;
    excludeClientId: string | null;
    fromNode: string;
    timestamp: string;
}
export interface BuildBroadcastEnvelopeArgs<TMessage> {
    message: TMessage;
    fromNode: string;
    /** Defaults to null. */
    excludeClientId?: string | null;
    /** Defaults to `new Date().toISOString()`. */
    timestamp?: string;
}
export declare function buildBroadcastEnvelope<TMessage>(args: BuildBroadcastEnvelopeArgs<TMessage>): BroadcastEnvelope<TMessage>;
/** Redis channel a BroadcastEnvelope is published on (always the same). */
export declare const broadcastRedisChannel: "websocket:broadcast:all";
/** JSON Schema for {@link SignalMessage}. */
export declare const signalMessageSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://event-catalog/schemas/SignalMessage";
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly type: "string";
        };
        readonly channel: {
            readonly type: "string";
        };
        readonly payload: {};
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
        };
    };
    readonly required: readonly ["type", "channel", "payload", "timestamp"];
    readonly additionalProperties: true;
};
/** JSON Schema for {@link ChannelMessageEnvelope}. */
export declare const channelMessageEnvelopeSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://event-catalog/schemas/ChannelMessageEnvelope";
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly type: "string";
            readonly enum: readonly ["channel_message"];
        };
        readonly channel: {
            readonly type: "string";
        };
        readonly message: {
            readonly $schema: "http://json-schema.org/draft-07/schema#";
            readonly $id: "https://event-catalog/schemas/SignalMessage";
            readonly type: "object";
            readonly properties: {
                readonly type: {
                    readonly type: "string";
                };
                readonly channel: {
                    readonly type: "string";
                };
                readonly payload: {};
                readonly timestamp: {
                    readonly type: "string";
                    readonly format: "date-time";
                };
            };
            readonly required: readonly ["type", "channel", "payload", "timestamp"];
            readonly additionalProperties: true;
        };
        readonly excludeClientId: {
            readonly type: readonly ["string", "null"];
        };
        readonly fromNode: {
            readonly type: "string";
        };
        readonly seq: {
            readonly type: "number";
        };
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
        };
        readonly targetNodes: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
    };
    readonly required: readonly ["type", "channel", "message", "excludeClientId", "fromNode", "seq", "timestamp"];
    readonly additionalProperties: false;
};
/** JSON Schema for {@link DirectMessageEnvelope}. */
export declare const directMessageEnvelopeSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://event-catalog/schemas/DirectMessageEnvelope";
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly type: "string";
            readonly enum: readonly ["direct_message"];
        };
        readonly clientId: {
            readonly type: "string";
        };
        readonly message: {};
        readonly fromNode: {
            readonly type: "string";
        };
        readonly targetNode: {
            readonly type: "string";
        };
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
        };
    };
    readonly required: readonly ["type", "clientId", "message", "fromNode", "targetNode", "timestamp"];
    readonly additionalProperties: false;
};
/** JSON Schema for {@link BroadcastEnvelope}. */
export declare const broadcastEnvelopeSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://event-catalog/schemas/BroadcastEnvelope";
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly type: "string";
            readonly enum: readonly ["broadcast"];
        };
        readonly message: {};
        readonly excludeClientId: {
            readonly type: readonly ["string", "null"];
        };
        readonly fromNode: {
            readonly type: "string";
        };
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
        };
    };
    readonly required: readonly ["type", "message", "excludeClientId", "fromNode", "timestamp"];
    readonly additionalProperties: false;
};
//# sourceMappingURL=envelopes.d.ts.map