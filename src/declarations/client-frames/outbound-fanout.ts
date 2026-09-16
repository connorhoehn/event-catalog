// src/declarations/client-frames/outbound-fanout.ts
//
// OUTBOUND (client → gateway) frames addressed to a gateway fan-out service
// whose handleAction set was verified against the gateway-instantiated
// service (hub#1497 re-audit): chat, presence, reaction, activity, crdt —
// plus the generic `subscribe` channel multiplexer that rides over all of
// them. The client-hook-only outbound contracts live in ./outbound-media.ts.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { CLIENT_PRODUCER, CLIENT_BASE_TAGS, clientFrameSchema } from './_shared';

// ===========================================================================
// OUTBOUND — chat (useChat.ts + GatewaySocketProvider.tsx)
//
// GROUND TRUTH (hub#1497 re-audit): gateway ChatService.handleAction accepts
// join | leave | send | history. The previously declared `subscribe` action
// was never accepted ("Unknown chat action: subscribe") — corrected to `join`.
// ===========================================================================

/** Sent by GatewaySocketProvider when the 'chat' feature is active. */
export const clientChatJoin: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.join',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to join a chat channel and start receiving its messages. Sent by GatewaySocketProvider on connect when the chat feature is declared. GROUND TRUTH (hub#1497): the gateway ChatService verb is "join" — the previously declared "subscribe" was never accepted. channel is required; on success the gateway replies chat/joined and auto-pushes recent channel history.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'join', {}, ['channel']),
};

/** Sent by useChat cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export const clientChatLeave: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.leave',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to leave a chat channel and stop receiving its messages. Sent by useChat cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ChatService.handleLeaveChannel requires channel ("Channel name is required") and replies with a chat/left action frame; in distributed mode it also drops the message-router channel subscription.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'leave', {}, ['channel']),
};

/** Sent by useChat.sendMessage(). */
export const clientChatSend: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.send',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to post a text chat message to a channel (useChat.sendMessage). The gateway ChatService requires a prior join on the channel ("You must join the channel before sending messages"). metadata is optional and size-validated server-side.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'send', {
        message: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'message']),
};

/** Sent by useChat.setTyping(): the person is composing (or has stopped). */
export const clientChatTyping: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.typing',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client signal that the person is typing in a channel (useChat.setTyping). `typing: true` while composing, re-sent at most every few seconds; `typing: false` when they stop or send. The gateway ChatService relays it to the channel as {type:"chat", action:"typing", channel, userId, displayName, typing} to everyone but the sender; never persisted, never in history. Requires a prior join.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'typing', {
        typing: { type: 'boolean', description: 'True while the person is composing in the channel; false once they stop or send.' },
    }, ['channel', 'typing']),
};

/** Sent by useChatMembers on mount: who is in the channel. */
export const clientChatMembers: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.members',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for a chat channel\'s membership (useChatMembers). The gateway ChatService replies to the sender with {type:"chat", action:"members", channel, open, members:[{userId, role, addedBy, addedAt, historyFrom}]}. `open` is true when the channel has no membership rows (everyone the gateway admits is in it); a dm channel reports the ids in its name.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'members', {}, ['channel']),
};

/** Sent by useChatMembers.addMembers(): add people, with the history they may read. */
export const clientChatAddMembers: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.addMembers',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to add people to a chat channel (useChatMembers.addMembers). The requester must be a member, or the channel open — then they become its owner and the channel closes. `history` decides each added person\'s history floor: none (from now), days (the last N days), all. The ChatService writes the rows, posts a stored message from the requester with metadata.kind "membership" (event "added"), and broadcasts {type:"chat", action:"membersUpdated", channel, open, members} to the channel. Errors carry code not-a-member | forbidden | bad-request.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'addMembers', {
        userIds: { type: 'array', items: { type: 'string', description: 'The user id (auth subject) of a person to add.' }, minItems: 1, maxItems: 50, description: 'The people to add, by user id.' },
        history: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['none', 'days', 'all'], description: 'none: only what is said from now on; days: the last N days; all: everything.' },
                days: { type: 'number', description: 'With mode "days": how many days back they may read (1..3650).' },
            },
            required: ['mode'],
            additionalProperties: false,
            description: 'How much of the channel\'s history the added people may read.',
        },
        names: { type: 'object', additionalProperties: { type: 'string', description: 'A display name.' }, description: 'Display names by userId, so the thread\'s membership line can name them.' },
    }, ['channel', 'userIds', 'history']),
};

/** Sent by useChatMembers.removeMember(): an owner removes someone, or a member leaves. */
export const clientChatRemoveMember: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.removeMember',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to remove a person from a chat channel (useChatMembers.removeMember). An owner may remove anyone; anyone may remove themselves. The ChatService marks the row removed, posts a membership message (event "removed"), and broadcasts membersUpdated. A removed person can no longer join, send or read the channel.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'removeMember', {
        userId: { type: 'string', description: 'The user id (auth subject) of the person to remove.' },
        name: { type: 'string', description: 'Their display name, for the thread\'s membership line.' },
    }, ['channel', 'userId']),
};

/** Sent by useChat.editMessage(): the author changes what they said. */
export const clientChatEdit: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.edit',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to edit one of the sender\'s own chat messages (useChat.editMessage). The gateway ChatService updates the stored record in place (message text, optional metadata merge, editedAt) and broadcasts {type:"chat", action:"messageUpdated", channel, message:<the updated record>, timestamp} to every subscriber. Only the author may edit; errors carry code forbidden | not-found | gone (already deleted) | bad-request (empty text).',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'edit', {
        messageId: { type: 'string', description: 'The id of the message to change.' },
        message: { type: 'string', minLength: 1, description: 'The new text.' },
        metadata: { type: 'object', description: 'Metadata to merge over the stored metadata (mentions, html).' },
    }, ['channel', 'messageId', 'message']),
};

/** Sent by useChat.deleteMessage(): the author takes a message back. */
export const clientChatDelete: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.delete',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to delete one of the sender\'s own chat messages (useChat.deleteMessage). A soft delete: the record keeps its id, channel, author and timestamp; its text becomes empty, its metadata {deleted:true}, and deletedAt is set. The ChatService broadcasts {type:"chat", action:"messageDeleted", channel, messageId, deletedAt, timestamp}. Only the author may delete; errors carry code forbidden | not-found.',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'delete', {
        messageId: { type: 'string', description: 'The id of the message to delete.' },
    }, ['channel', 'messageId']),
};

/** Sent by useChat.loadHistory(). */
export const clientChatHistory: EventDeclaration = {
    namespace: 'client',
    name: 'client.chat.history',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for recent chat message history for a channel (useChat.loadHistory). limit is optional — the gateway ChatService falls back to its configured default history limit when omitted (hub#1497 re-audit: limit was wrongly declared required).',
    tags: [...CLIENT_BASE_TAGS, 'chat'],
    schema: clientFrameSchema('chat', 'history', {
        limit: { type: 'number' },
    }, ['channel']),
};

// ===========================================================================
// OUTBOUND — presence (usePresence.ts + GatewaySocketProvider.tsx)
// ===========================================================================

/** Sent by usePresence on mount and by GatewaySocketProvider on connect. */
export const clientPresenceSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared. GROUND TRUTH (hub#1497): the gateway PresenceService rejects the frame without channel ("Channel is required") — channel is REQUIRED, not optional as previously declared.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'subscribe', {}, ['channel']),
};

/** Sent by usePresence on unmount/channel change. */
export const clientPresenceUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to stop receiving presence events for a channel (usePresence cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'unsubscribe', {}, ['channel']),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientPresenceGet: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.get',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to read presence data for a single client (targetClientId) or a whole channel (channel). GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleGetPresence requires AT LEAST ONE of targetClientId or channel ("Either targetClientId or channel is required" — an either-or constraint JSON-schema-encodable only via anyOf, which the type generator does not support, so both fields are declared optional here). targetClientId wins when both are present; unknown targetClientId yields "Client not found". Replies with a presence/presence action frame carrying the data. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'get', {
        targetClientId: {
            type: 'string',
            description: 'client id to fetch a single PresenceEntry for — takes precedence over channel',
        },
        channel: {
            type: 'string',
            description: 'channel to fetch the full channel-presence list for (used when targetClientId is absent)',
        },
    }),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientPresenceHeartbeat: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.heartbeat',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client keep-alive that refreshes lastSeen/lastHeartbeat on its existing presence entry so the stale-presence sweep does not reap it. GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleHeartbeat reads NO payload fields beyond service/action (data is ignored) and sends no reply; it is a silent no-op when the client has no presence entry (set first). PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'heartbeat'),
};

/** Sent by usePresence.setStatus() / updateMetadata(). */
export const clientPresenceSet: EventDeclaration = {
    namespace: 'client',
    name: 'client.presence.set',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to set its presence entry (usePresence setStatus / updateMetadata). GROUND TRUTH (hub#1497): the gateway PresenceService requires status ("Status is required") and reads only { status, metadata, channels } — the channel field is sent by the hook but IGNORED by the service (presence pinning uses the channels array). Previously declared with channel required + status optional; both were wrong.',
    tags: [...CLIENT_BASE_TAGS, 'presence'],
    schema: clientFrameSchema('presence', 'set', {
        channel: {
            type: 'string',
            description: 'DEPRECATED: sent by usePresence but ignored by the gateway PresenceService — channel pinning uses the channels array',
            deprecated: true,
        },
        status: { type: 'string', description: 'PresenceStatus, e.g. "online" | "away" | "busy"' },
        metadata: { type: 'object', additionalProperties: true },
        channels: {
            type: 'array',
            items: { type: 'string' },
            description: 'channels to pin this presence entry to (defaults to [] server-side)',
        },
    }, ['status']),
};

// ===========================================================================
// OUTBOUND — reaction (useReactions.ts)
//
// GROUND TRUTH (hub#1497 re-audit): gateway ReactionService.handleAction
// accepts subscribe | unsubscribe | send | getAvailable. The previously
// declared `react` action was never accepted ("Unknown reaction action:
// react") — corrected to `send`. The useReactions header comment's outbound
// `{ action: 'history' }` frame remains unsent by any code path.
// ===========================================================================

/** Sent by useReactions on mount (channel subscribe) as of realtime-modules 0.14.0. */
export const clientReactionSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to receive emoji reactions for a channel. Sent by useReactions on mount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleSubscribeToReactions requires channel ("Channel name is required", length-validated 1..maxChannelNameLength) and runs the consumer authz hook; on success it replies with a reaction/reaction_subscribed success frame whose data includes the availableReactions emoji list.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'subscribe', {}, ['channel']),
};

/** Sent by useReactions cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export const clientReactionUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to stop receiving emoji reactions for a channel. Sent by useReactions cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleUnsubscribeFromReactions requires channel ("Channel name is required") and replies with a reaction/reaction_unsubscribed success frame.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'unsubscribe', {}, ['channel']),
};

/** Sent by useReactions.react() — the gateway verb is `send`. */
export const clientReactionSend: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.send',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to send an emoji reaction to a channel (useReactions.react). GROUND TRUTH (hub#1497): the gateway ReactionService verb is "send" — the previously declared "react" was never accepted. emoji must be in the gateway\'s available-reactions catalog; position is optional overlay placement; metadata passes through. NOTE: targetId is sent by useReactions for entity-scoped reactions but the current gateway ReactionService does NOT forward it to subscribers.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'send', {
        emoji: { type: 'string' },
        position: {
            type: 'object',
            additionalProperties: true,
            description: 'optional overlay placement, forwarded verbatim to subscribers',
        },
        targetId: {
            type: 'string',
            description: 'DEPRECATED: sent by useReactions but dropped by the current gateway ReactionService (not forwarded to subscribers)',
            deprecated: true,
        },
        metadata: { type: 'object', additionalProperties: true },
    }, ['channel', 'emoji']),
};

/** No hook sender today — gateway-verified verb declared for contract completeness. */
export const clientReactionGetAvailable: EventDeclaration = {
    namespace: 'client',
    name: 'client.reaction.getAvailable',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for the gateway\'s available-reactions catalog (emoji → effect map). GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleGetAvailableReactions reads NO payload fields beyond service/action (channel is ignored) and replies with a reaction/available_reactions success frame carrying the full reactions catalog. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 (subscribers get the emoji list in the reaction_subscribed reply instead) — declared as the gateway-verified verb for any WS client.',
    tags: [...CLIENT_BASE_TAGS, 'reaction'],
    schema: clientFrameSchema('reaction', 'getAvailable'),
};

// ===========================================================================
// OUTBOUND — activity (useActivity.ts)
//
// GROUND TRUTH (hub#1497, verified against realtime-modules a295f13 + the
// gateway-instantiated ActivityService): subscribe / unsubscribe / getHistory
// all key on `channelId` (NOT `channel`), the history verb is `getHistory`
// (NOT `history`), and there is NO auto-history-on-subscribe. The fixed
// useActivity hook still sends a legacy `channel` field alongside channelId
// for tolerance — declared optional + deprecated below.
// ===========================================================================

/** Legacy `channel` field the fixed useActivity hook still sends for tolerance. */
const activityLegacyChannelField = {
    channel: {
        type: 'string',
        description: 'DEPRECATED: legacy alias still sent by useActivity for old-server tolerance; the gateway ActivityService reads channelId only',
        deprecated: true,
    },
    channelId: { type: 'string', description: 'activity feed channel id — the field the gateway ActivityService reads' },
} as const;

/** Sent by useActivity on mount. */
export const clientActivitySubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to the activity feed for a channel (useActivity mount). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. No history is auto-pushed on subscribe; clients request it explicitly via client.activity.getHistory.',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'subscribe', { ...activityLegacyChannelField }, ['channelId']),
};

/** Sent by useActivity on unmount/channel change. */
export const clientActivityUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from the activity feed for a channel (useActivity cleanup). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read.',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'unsubscribe', { ...activityLegacyChannelField }, ['channelId']),
};

/** Sent by useActivity.loadHistory() — the gateway verb is `getHistory`. */
export const clientActivityGetHistory: EventDeclaration = {
    namespace: 'client',
    name: 'client.activity.getHistory',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request for prior activity events for a channel (useActivity.loadHistory). GROUND TRUTH (hub#1497): the gateway verb is "getHistory" — the previously declared "history" action was rejected ("Unknown activity action"). Keys on channelId; limit is optional (server clamps to 1..maxHistoryItems, default 50).',
    tags: [...CLIENT_BASE_TAGS, 'activity'],
    schema: clientFrameSchema('activity', 'getHistory', {
        ...activityLegacyChannelField,
        limit: { type: 'number', description: 'optional — server default 50, clamped to 1..maxHistoryItems' },
    }, ['channelId']),
};

// ===========================================================================
// OUTBOUND — crdt (useCRDT.ts, useYjsDoc.ts, GatewayProvider.ts)
// ===========================================================================

/** Sent by useCRDT/useYjsDoc when (re)connecting to a CRDT channel. */
export const clientCrdtSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to subscribe to a CRDT document channel (useCRDT/useYjsDoc). Gateway replies with crdt:subscribed and pushes the latest crdt:snapshot when one exists.',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'subscribe', {}, ['channel']),
};

/** Sent by useCRDT/useYjsDoc on unmount/channel change. */
export const clientCrdtUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client request to unsubscribe from a CRDT document channel (useCRDT/useYjsDoc cleanup).',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'unsubscribe', {}, ['channel']),
};

/** Sent by GatewayProvider doc-update handler and useCRDT.applyLocalEdit(). */
export const clientCrdtUpdate: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.update',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client broadcast of a local Y.js document update, base64-encoded (GatewayProvider update handler / useCRDT.applyLocalEdit).',
    tags: [...CLIENT_BASE_TAGS, 'crdt'],
    schema: clientFrameSchema('crdt', 'update', {
        update: { type: 'string', description: 'base64-encoded Y.js update' },
    }, ['channel', 'update']),
};

/** Sent (debounced 50ms) by GatewayProvider awareness handler. */
export const clientCrdtAwareness: EventDeclaration = {
    namespace: 'client',
    name: 'client.crdt.awareness',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Client broadcast of local Y.js awareness state, base64-encoded and debounced (GatewayProvider). `mode` and `idle` are lifted out of awareness local state as top-level fields so the gateway DocumentPresenceService can update without decoding the Y.js binary.',
    tags: [...CLIENT_BASE_TAGS, 'crdt', 'awareness'],
    schema: clientFrameSchema('crdt', 'awareness', {
        update: { type: 'string', description: 'base64-encoded Y.js awareness update' },
        mode: { type: 'string', enum: ['editor', 'reviewer', 'reader'] },
        idle: { type: 'boolean' },
    }, ['channel', 'update']),
};

// ===========================================================================
// OUTBOUND — generic channel subscribe multiplexer (useWebSocket.ts)
//
// NOTE: service is literally 'subscribe' on the wire. Not in the gateway
// MessageValidator allow-list today — declared as the client-hook contract.
// ===========================================================================

/** Sent by useWebSocket.subscribe() and the auto-resubscribe-on-reconnect path. */
export const clientSubscribeSubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.subscribe.subscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Generic channel subscribe frame from the useWebSocket channel multiplexer (also re-sent on reconnect when autoResubscribe is enabled). Wire service is literally "subscribe".',
    tags: [...CLIENT_BASE_TAGS, 'subscribe'],
    schema: clientFrameSchema('subscribe', 'subscribe', {}, ['channel']),
};

/** Sent by useWebSocket.unsubscribe(). */
export const clientSubscribeUnsubscribe: EventDeclaration = {
    namespace: 'client',
    name: 'client.subscribe.unsubscribe',
    transport: 'signal',
    producer: CLIENT_PRODUCER,
    description: 'Generic channel unsubscribe frame from the useWebSocket channel multiplexer. Wire service is literally "subscribe".',
    tags: [...CLIENT_BASE_TAGS, 'subscribe'],
    schema: clientFrameSchema('subscribe', 'unsubscribe', {}, ['channel']),
};
