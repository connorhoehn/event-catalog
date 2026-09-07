// src/declarations/client-frames/inbound-fanout.ts
//
// INBOUND (gateway → client) push frames from the verified fan-out services:
// the presence join/leave pair the client hooks consume, and the reaction /
// crdt send-back envelopes recorded under divergence note b.
//
// Sliced verbatim out of the former single-file client-frames.ts.

import type { EventDeclaration } from '../../types/index';
import { GATEWAY_PRODUCER, GATEWAY_BASE_TAGS, inboundSchema } from './_shared';

// --- presence ---------------------------------------------------------------

/** Consumed by usePresence: a client joined the presence channel. */
export const wsPresenceJoined: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.joined',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Broadcast when a client joins a presence channel, carrying the joining client\'s PresenceEntry. NOTE: the gateway presence service currently emits type:"presence" action frames (ws.presence.update / ws.presence.offline); presence:joined is the usePresence hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'presence', 'client-contract'],
    schema: inboundSchema('presence:joined', {
        channel: { type: 'string' },
        client: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                status: { type: 'string' },
                metadata: { type: 'object', additionalProperties: true },
                channels: { type: 'array', items: { type: 'string' } },
                nodeId: { type: 'string' },
                timestamp: { type: 'string' },
                lastSeen: { type: 'string' },
                lastHeartbeat: { type: 'number' },
            },
            required: ['clientId', 'status'],
            additionalProperties: true,
        },
    }, ['channel', 'client']),
};

/** Consumed by usePresence: a client left the presence channel. */
export const wsPresenceLeft: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.presence.left',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Broadcast when a client leaves a presence channel. NOTE: the gateway presence service currently emits type:"presence" action frames; presence:left is the usePresence hook contract — naming tension documented per Wave A2, not renamed.',
    tags: [...GATEWAY_BASE_TAGS, 'presence', 'client-contract'],
    schema: inboundSchema('presence:left', {
        channel: { type: 'string' },
        clientId: { type: 'string' },
    }, ['channel', 'clientId']),
};

// --- gateway send-back envelopes (divergence note b) -------------------------
//
// GROUND TRUTH (2026-06-12): re-audited against the gateway-instantiated
// service dist the gateway actually runs — websocket-gateway/node_modules/
// @connorhoehn/realtime-modules/dist/{chat,presence,reactions,cursor,activity,
// crdt}/. These are the type:'<service>' / type:'<service>:<variant>' action-
// frame envelopes the gateway services emit to the client, which the 0.15.x
// realtime-modules hooks parse payload-first (useChat/usePresence/useReactions
// per divergence note b in the contract test). Most send-backs were ALREADY
// declared in gateway-signal.ts (ws.chat.*, ws.presence.*, ws.reaction.*,
// ws.cursor.*, ws.activity.*, ws.crdt.*) and those declarations were verified
// against the dist and RECONCILED there (see the correction notes in
// gateway-signal.ts). The three declarations below are the send-back frames
// the dist emits that had NO ws.* declaration anywhere — added here so the
// inbound unions + EventPayloadMap are complete and the contract test can
// assert the hooks' parsers against the full send-back set.

/**
 * Consumed by useReactions: confirmation that an unsubscribe was accepted.
 * GROUND TRUTH: ReactionService.handleUnsubscribeFromReactions →
 * sendSuccess('reaction_unsubscribed', { channel, message }) which wraps as
 * { type:'reaction', action:'reaction_unsubscribed', success:true, data }.
 * The sibling reaction_subscribed frame is declared as ws.reaction.subscribed
 * in gateway-signal.ts (reconciled there to add success + data.message).
 */
export const wsReactionUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.unsubscribed',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Confirmation sent to a client when their reaction unsubscribe is accepted. GROUND TRUTH (gateway dist ReactionService.handleUnsubscribeFromReactions → sendSuccess): wire frame is { type:"reaction", action:"reaction_unsubscribed", success:true, data:{ channel, message } }. No ws.* declaration existed for this verified send-back before — added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'reaction', 'send-back', 'client-contract'],
    schema: inboundSchema('reaction', {
        action: { type: 'string', const: 'reaction_unsubscribed' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                channel: { type: 'string' },
                message: { type: 'string' },
            },
            required: ['channel'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/**
 * Consumed by clients that send client.reaction.getAvailable: the emoji →
 * effect catalog. GROUND TRUTH: ReactionService.handleGetAvailableReactions →
 * sendSuccess('available_reactions', { reactions }) wrapping as
 * { type:'reaction', action:'available_reactions', success:true, data }.
 */
export const wsReactionAvailable: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.reaction.available',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'The gateway\'s available-reactions catalog (emoji → effect map), sent in reply to a getAvailable request. GROUND TRUTH (gateway dist ReactionService.handleGetAvailableReactions → sendSuccess): wire frame is { type:"reaction", action:"available_reactions", success:true, data:{ reactions } } where reactions maps each emoji to its { effect } config. No ws.* declaration existed before — added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'reaction', 'send-back', 'client-contract'],
    schema: inboundSchema('reaction', {
        action: { type: 'string', const: 'available_reactions' },
        success: { type: 'boolean', const: true },
        data: {
            type: 'object',
            properties: {
                reactions: { type: 'object', additionalProperties: true, description: 'emoji → { effect } map' },
            },
            required: ['reactions'],
            additionalProperties: true,
        },
    }, ['action', 'data']),
};

/**
 * Broadcast to CRDT channel subscribers: coalesced Y.js awareness updates.
 * GROUND TRUTH: server/AwarenessCoalescer._broadcast → sendToChannel(channel,
 * { type:'crdt:awareness', channel, updates:[{ clientId, update }] }). This is
 * the frame the dist actually emits — distinct from the historical
 * ws.crdt.awareness-batch declaration in gateway-signal.ts (different type
 * literal `crdt:awareness-batch` and different per-entry shape
 * { clientId, awareness }), which the current dist does NOT emit (noted there).
 */
export const wsCrdtAwareness: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.crdt.awareness',
    transport: 'signal',
    producer: GATEWAY_PRODUCER,
    description: 'Coalesced Y.js awareness updates broadcast to all CRDT channel subscribers. GROUND TRUTH (gateway dist server/AwarenessCoalescer._broadcast): wire frame is { type:"crdt:awareness", channel, updates:[{ clientId, update }] } where each update is a base64-encoded Y.js awareness delta. This is the frame the running dist emits — distinct from the historical ws.crdt.awareness-batch (type "crdt:awareness-batch", per-entry { clientId, awareness }) which the current dist does NOT emit. Added per divergence note (b).',
    tags: [...GATEWAY_BASE_TAGS, 'crdt', 'awareness', 'send-back', 'client-contract'],
    schema: inboundSchema('crdt:awareness', {
        channel: { type: 'string' },
        updates: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    clientId: { type: 'string' },
                    update: { type: 'string', description: 'base64-encoded Y.js awareness delta' },
                },
                required: ['clientId', 'update'],
                additionalProperties: true,
            },
        },
    }, ['channel', 'updates']),
};
