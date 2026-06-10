// AUTO-GENERATED — do not edit manually. Run: npm run generate-types
// Generated at: 2026-06-10T13:49:14.392Z

// prettier-ignore-file
/* eslint-disable */

import type { EventPayloadMap } from './event-types';

/**
 * Map from every declared OUTBOUND client→gateway WS frame name
 * (`client.<service>.<action>`) to its frame payload type.
 *
 * Usage:
 * ```ts
 * import type { ClientFramePayloadMap, ClientFramePayload } from '@connorhoehn/event-catalog/client-frames';
 *
 * function send<K extends keyof ClientFramePayloadMap>(name: K, frame: ClientFramePayload<K>) {
 *   // frame is fully typed
 * }
 * ```
 */
export interface ClientFramePayloadMap {
  /** Client request to subscribe to chat messages for a channel. Sent by GatewaySocketProvider on connect when the chat feature is declared; channel may be omitted when no channel is active. */
  'client.chat.subscribe': {
    service: 'chat';
    action: 'subscribe';
    channel?: string;
    [key: string]: unknown;
  };
  /** Client request to post a text chat message to a channel (useChat.sendMessage). */
  'client.chat.send': {
    service: 'chat';
    action: 'send';
    channel: string;
    message: string;
    [key: string]: unknown;
  };
  /** Client request for recent chat message history for a channel (useChat.loadHistory). */
  'client.chat.history': {
    service: 'chat';
    action: 'history';
    channel: string;
    limit: number;
    [key: string]: unknown;
  };
  /** Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared; channel may be omitted when no channel is active. */
  'client.presence.subscribe': {
    service: 'presence';
    action: 'subscribe';
    channel?: string;
    [key: string]: unknown;
  };
  /** Client request to stop receiving presence events for a channel (usePresence cleanup). */
  'client.presence.unsubscribe': {
    service: 'presence';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to set its presence entry. Two call sites: setStatus sends { status }, updateMetadata sends { metadata } — each field is therefore optional but at least one is present in practice. */
  'client.presence.set': {
    service: 'presence';
    action: 'set';
    channel: string;
    status?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to send an emoji reaction to a channel (useReactions.react). targetId optionally scopes the reaction to an entity (messageId, articleId, …) and passes through the gateway opaquely. */
  'client.reaction.react': {
    service: 'reaction';
    action: 'react';
    channel: string;
    emoji: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to subscribe to the activity feed for a channel (useActivity mount). */
  'client.activity.subscribe': {
    service: 'activity';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to unsubscribe from the activity feed for a channel (useActivity cleanup). */
  'client.activity.unsubscribe': {
    service: 'activity';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request for prior activity events for a channel (useActivity.loadHistory). */
  'client.activity.history': {
    service: 'activity';
    action: 'history';
    channel: string;
    limit: number;
    [key: string]: unknown;
  };
  /** Client request to subscribe to a CRDT document channel (useCRDT/useYjsDoc). Gateway replies with crdt:subscribed and pushes the latest crdt:snapshot when one exists. */
  'client.crdt.subscribe': {
    service: 'crdt';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to unsubscribe from a CRDT document channel (useCRDT/useYjsDoc cleanup). */
  'client.crdt.unsubscribe': {
    service: 'crdt';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client broadcast of a local Y.js document update, base64-encoded (GatewayProvider update handler / useCRDT.applyLocalEdit). */
  'client.crdt.update': {
    service: 'crdt';
    action: 'update';
    channel: string;
    update: string;
    [key: string]: unknown;
  };
  /** Client broadcast of local Y.js awareness state, base64-encoded and debounced (GatewayProvider). `mode` and `idle` are lifted out of awareness local state as top-level fields so the gateway DocumentPresenceService can update without decoding the Y.js binary. */
  'client.crdt.awareness': {
    service: 'crdt';
    action: 'awareness';
    channel: string;
    update: string;
    mode?: 'editor' | 'reviewer' | 'reader';
    idle?: boolean;
    [key: string]: unknown;
  };
  /** Client request for a presigned upload URL (useFileUpload.upload step 1). `id` is a client-generated upload identifier echoed back on all subsequent fileupload:* frames. */
  'client.fileupload.request-upload': {
    service: 'fileupload';
    action: 'request-upload';
    channel: string;
    id: string;
    filename: string;
    size: number;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client notification that the presigned-URL PUT finished (useFileUpload.upload step 4). Gateway replies with fileupload:complete / fileupload:scanning depending on scan policy. */
  'client.fileupload.complete': {
    service: 'fileupload';
    action: 'complete';
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Client request to cancel an in-flight upload (useFileUpload.cancel). Gateway acknowledges with fileupload:cancelled. */
  'client.fileupload.cancel': {
    service: 'fileupload';
    action: 'cancel';
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Client request to start a video hangout/call session on a channel (useVideoHangout.start). Gateway replies with videohangout:created. */
  'client.videohangout.start': {
    service: 'videohangout';
    action: 'start';
    channel: string;
    type?: 'hangout' | 'call';
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to join an existing hangout session (useVideoHangout.join). Gateway replies with videohangout:joined. */
  'client.videohangout.join': {
    service: 'videohangout';
    action: 'join';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client notification that it is leaving the hangout session (useVideoHangout.leave). */
  'client.videohangout.leave': {
    service: 'videohangout';
    action: 'leave';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client (host) request to end the hangout session for all participants (useVideoHangout.end). */
  'client.videohangout.end': {
    service: 'videohangout';
    action: 'end';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client notification that it toggled its video feed on/off (useVideoHangout.toggleVideo). Gateway fans out videohangout:media. */
  'client.videohangout.toggle-video': {
    service: 'videohangout';
    action: 'toggle-video';
    channel: string;
    sessionId: string;
    videoOn: boolean;
    [key: string]: unknown;
  };
  /** Client notification that it toggled its audio feed on/off (useVideoHangout.toggleAudio). Gateway fans out videohangout:media. */
  'client.videohangout.toggle-audio': {
    service: 'videohangout';
    action: 'toggle-audio';
    channel: string;
    sessionId: string;
    audioOn: boolean;
    [key: string]: unknown;
  };
  /** Generic channel subscribe frame from the useWebSocket channel multiplexer (also re-sent on reconnect when autoResubscribe is enabled). Wire service is literally "subscribe". */
  'client.subscribe.subscribe': {
    service: 'subscribe';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Generic channel unsubscribe frame from the useWebSocket channel multiplexer. Wire service is literally "subscribe". */
  'client.subscribe.unsubscribe': {
    service: 'subscribe';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
}

/**
 * Utility type — get the frame payload type for a specific outbound
 * client frame by name.
 *
 * @example
 *   type SendFrame = ClientFramePayload<'client.chat.send'>;
 */
export type ClientFramePayload<K extends keyof ClientFramePayloadMap> = ClientFramePayloadMap[K];

// ---------------------------------------------------------------------------
// Per-service OUTBOUND frame unions (client → gateway)
// ---------------------------------------------------------------------------

/** Union of every outbound client→gateway frame for the `chat` service. */
export type ChatOutboundFrame =
  | ClientFramePayloadMap['client.chat.subscribe']
  | ClientFramePayloadMap['client.chat.send']
  | ClientFramePayloadMap['client.chat.history'];

/** Union of every outbound client→gateway frame for the `presence` service. */
export type PresenceOutboundFrame =
  | ClientFramePayloadMap['client.presence.subscribe']
  | ClientFramePayloadMap['client.presence.unsubscribe']
  | ClientFramePayloadMap['client.presence.set'];

/** Union of every outbound client→gateway frame for the `reaction` service. */
export type ReactionOutboundFrame =
  | ClientFramePayloadMap['client.reaction.react'];

/** Union of every outbound client→gateway frame for the `activity` service. */
export type ActivityOutboundFrame =
  | ClientFramePayloadMap['client.activity.subscribe']
  | ClientFramePayloadMap['client.activity.unsubscribe']
  | ClientFramePayloadMap['client.activity.history'];

/** Union of every outbound client→gateway frame for the `crdt` service. */
export type CrdtOutboundFrame =
  | ClientFramePayloadMap['client.crdt.subscribe']
  | ClientFramePayloadMap['client.crdt.unsubscribe']
  | ClientFramePayloadMap['client.crdt.update']
  | ClientFramePayloadMap['client.crdt.awareness'];

/** Union of every outbound client→gateway frame for the `fileupload` service. */
export type FileuploadOutboundFrame =
  | ClientFramePayloadMap['client.fileupload.request-upload']
  | ClientFramePayloadMap['client.fileupload.complete']
  | ClientFramePayloadMap['client.fileupload.cancel'];

/** Union of every outbound client→gateway frame for the `videohangout` service. */
export type VideohangoutOutboundFrame =
  | ClientFramePayloadMap['client.videohangout.start']
  | ClientFramePayloadMap['client.videohangout.join']
  | ClientFramePayloadMap['client.videohangout.leave']
  | ClientFramePayloadMap['client.videohangout.end']
  | ClientFramePayloadMap['client.videohangout.toggle-video']
  | ClientFramePayloadMap['client.videohangout.toggle-audio'];

/** Union of every outbound client→gateway frame for the `subscribe` service. */
export type SubscribeOutboundFrame =
  | ClientFramePayloadMap['client.subscribe.subscribe']
  | ClientFramePayloadMap['client.subscribe.unsubscribe'];

// ---------------------------------------------------------------------------
// Per-service INBOUND frame unions (gateway → client, ws.* declarations)
// ---------------------------------------------------------------------------

/** Union of every inbound gateway→client push frame for the `chat` service. */
export type ChatInboundFrame =
  | EventPayloadMap['ws.chat.joined']
  | EventPayloadMap['ws.chat.left']
  | EventPayloadMap['ws.chat.message']
  | EventPayloadMap['ws.chat.sent']
  | EventPayloadMap['ws.chat.history'];

/** Union of every inbound gateway→client push frame for the `cursor` service. */
export type CursorInboundFrame =
  | EventPayloadMap['ws.cursor.subscribed']
  | EventPayloadMap['ws.cursor.unsubscribed']
  | EventPayloadMap['ws.cursor.update']
  | EventPayloadMap['ws.cursor.remove']
  | EventPayloadMap['ws.cursor.cursors']
  | EventPayloadMap['ws.cursor.modes']
  | EventPayloadMap['ws.cursor.clear']
  | EventPayloadMap['ws.cursor.batch'];

/** Union of every inbound gateway→client push frame for the `activity` service. */
export type ActivityInboundFrame =
  | EventPayloadMap['ws.activity.subscribed']
  | EventPayloadMap['ws.activity.unsubscribed']
  | EventPayloadMap['ws.activity.published']
  | EventPayloadMap['ws.activity.history']
  | EventPayloadMap['ws.activity.event'];

/** Union of every inbound gateway→client push frame for the `crdt` service. */
export type CrdtInboundFrame =
  | EventPayloadMap['ws.crdt.subscribed']
  | EventPayloadMap['ws.crdt.unsubscribed']
  | EventPayloadMap['ws.crdt.snapshot']
  | EventPayloadMap['ws.crdt.update']
  | EventPayloadMap['ws.crdt.doc-replaced']
  | EventPayloadMap['ws.crdt.sync-request']
  | EventPayloadMap['ws.crdt.sync-response']
  | EventPayloadMap['ws.crdt.snapshot-stored']
  | EventPayloadMap['ws.crdt.awareness-batch'];

/** Union of every inbound gateway→client push frame for the `presence` service. */
export type PresenceInboundFrame =
  | EventPayloadMap['ws.presence.set']
  | EventPayloadMap['ws.presence.update']
  | EventPayloadMap['ws.presence.subscribed']
  | EventPayloadMap['ws.presence.unsubscribed']
  | EventPayloadMap['ws.presence.data']
  | EventPayloadMap['ws.presence.offline']
  | EventPayloadMap['ws.presence.joined']
  | EventPayloadMap['ws.presence.left'];

/** Union of every inbound gateway→client push frame for the `reaction` service. */
export type ReactionInboundFrame =
  | EventPayloadMap['ws.reaction.subscribed']
  | EventPayloadMap['ws.reaction.received']
  | EventPayloadMap['ws.reaction.removed']
  | EventPayloadMap['ws.reaction.list']
  | EventPayloadMap['ws.reaction.sent'];

/** Union of every inbound gateway→client push frame for the `call` service. */
export type CallInboundFrame =
  | EventPayloadMap['ws.call.invite']
  | EventPayloadMap['ws.call.accepted']
  | EventPayloadMap['ws.call.declined']
  | EventPayloadMap['ws.call.cancelled']
  | EventPayloadMap['ws.call.ended']
  | EventPayloadMap['ws.call.video-on']
  | EventPayloadMap['ws.call.video-off']
  | EventPayloadMap['ws.call.recording-started']
  | EventPayloadMap['ws.call.recording-completed'];

/** Union of every inbound gateway→client push frame for the `upload` service. */
export type UploadInboundFrame =
  | EventPayloadMap['ws.upload.requested']
  | EventPayloadMap['ws.upload.url-issued']
  | EventPayloadMap['ws.upload.completed']
  | EventPayloadMap['ws.upload.failed']
  | EventPayloadMap['ws.upload.scanned']
  | EventPayloadMap['ws.upload.scan-quarantined']
  | EventPayloadMap['ws.upload.url-revoked'];

/** Union of every inbound gateway→client push frame for the `pipeline` service. */
export type PipelineInboundFrame =
  | EventPayloadMap['ws.pipeline.subscribed']
  | EventPayloadMap['ws.pipeline.unsubscribed']
  | EventPayloadMap['ws.pipeline.ack']
  | EventPayloadMap['ws.pipeline.snapshot']
  | EventPayloadMap['ws.pipeline.history']
  | EventPayloadMap['ws.pipeline.event'];

/** Union of every inbound gateway→client push frame for the `fileupload` service. */
export type FileuploadInboundFrame =
  | EventPayloadMap['ws.fileupload.progress']
  | EventPayloadMap['ws.fileupload.scanning']
  | EventPayloadMap['ws.fileupload.cancelled'];

/** Union of every inbound gateway→client push frame for the `videohangout` service. */
export type VideohangoutInboundFrame =
  | EventPayloadMap['ws.videohangout.participant']
  | EventPayloadMap['ws.videohangout.media'];

/** Union of every inbound gateway→client push frame for the `notification` service. */
export type NotificationInboundFrame =
  | EventPayloadMap['ws.notification.new']
  | EventPayloadMap['ws.notification.read']
  | EventPayloadMap['ws.notification.bulk-update'];

/** Union of every inbound gateway→client push frame for the `capability` service. */
export type CapabilityInboundFrame =
  | EventPayloadMap['ws.capability.updated'];

/** Union of every inbound gateway→client push frame for the `feature-flag` service. */
export type FeatureFlagInboundFrame =
  | EventPayloadMap['ws.feature-flag.updated'];
