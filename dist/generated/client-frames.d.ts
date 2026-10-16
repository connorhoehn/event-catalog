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
    /** Client request to join a chat channel and start receiving its messages. Sent by GatewaySocketProvider on connect when the chat feature is declared. GROUND TRUTH (hub#1497): the gateway ChatService verb is "join" — the previously declared "subscribe" was never accepted. channel is required; on success the gateway replies chat/joined and auto-pushes recent channel history. */
    'client.chat.join': {
        service: 'chat';
        action: 'join';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to leave a chat channel and stop receiving its messages. Sent by useChat cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ChatService.handleLeaveChannel requires channel ("Channel name is required") and replies with a chat/left action frame; in distributed mode it also drops the message-router channel subscription. */
    'client.chat.leave': {
        service: 'chat';
        action: 'leave';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to post a text chat message to a channel (useChat.sendMessage). The gateway ChatService requires a prior join on the channel ("You must join the channel before sending messages"). metadata is optional and size-validated server-side. */
    'client.chat.send': {
        service: 'chat';
        action: 'send';
        channel: string;
        message: string;
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Client signal that the person is typing in a channel (useChat.setTyping). `typing: true` while composing, re-sent at most every few seconds; `typing: false` when they stop or send. The gateway ChatService relays it to the channel as {type:"chat", action:"typing", channel, userId, displayName, typing} to everyone but the sender; never persisted, never in history. Requires a prior join. */
    'client.chat.typing': {
        service: 'chat';
        action: 'typing';
        channel: string;
        typing: boolean;
        [key: string]: unknown;
    };
    /** Client request for a chat channel's membership (useChatMembers). The gateway ChatService replies to the sender with {type:"chat", action:"members", channel, open, members:[{userId, role, addedBy, addedAt, historyFrom}]}. `open` is true when the channel has no membership rows (everyone the gateway admits is in it); a dm channel reports the ids in its name. */
    'client.chat.members': {
        service: 'chat';
        action: 'members';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to add people to a chat channel (useChatMembers.addMembers). The requester must be a member, or the channel open — then they become its owner and the channel closes. `history` decides each added person's history floor: none (from now), days (the last N days), all. The ChatService writes the rows, posts a stored message from the requester with metadata.kind "membership" (event "added"), and broadcasts {type:"chat", action:"membersUpdated", channel, open, members} to the channel. Errors carry code not-a-member | forbidden | bad-request. */
    'client.chat.addMembers': {
        service: 'chat';
        action: 'addMembers';
        channel: string;
        userIds: string[];
        history: {
            mode: 'none' | 'days' | 'all';
            days?: number;
        };
        names?: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Client request to remove a person from a chat channel (useChatMembers.removeMember). An owner may remove anyone; anyone may remove themselves. The ChatService marks the row removed, posts a membership message (event "removed"), and broadcasts membersUpdated. A removed person can no longer join, send or read the channel. */
    'client.chat.removeMember': {
        service: 'chat';
        action: 'removeMember';
        channel: string;
        userId: string;
        name?: string;
        [key: string]: unknown;
    };
    /** Client request to edit one of the sender's own chat messages (useChat.editMessage). The gateway ChatService updates the stored record in place (message text, optional metadata merge, editedAt) and broadcasts {type:"chat", action:"messageUpdated", channel, message:<the updated record>, timestamp} to every subscriber. Only the author may edit; errors carry code forbidden | not-found | gone (already deleted) | bad-request (empty text). */
    'client.chat.edit': {
        service: 'chat';
        action: 'edit';
        channel: string;
        messageId: string;
        message: string;
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Client request to delete one of the sender's own chat messages (useChat.deleteMessage). A soft delete: the record keeps its id, channel, author and timestamp; its text becomes empty, its metadata {deleted:true}, and deletedAt is set. The ChatService broadcasts {type:"chat", action:"messageDeleted", channel, messageId, deletedAt, timestamp}. Only the author may delete; errors carry code forbidden | not-found. */
    'client.chat.delete': {
        service: 'chat';
        action: 'delete';
        channel: string;
        messageId: string;
        [key: string]: unknown;
    };
    /** Client request for recent chat message history for a channel (useChat.loadHistory). limit is optional — the gateway ChatService falls back to its configured default history limit when omitted (hub#1497 re-audit: limit was wrongly declared required). */
    'client.chat.history': {
        service: 'chat';
        action: 'history';
        channel: string;
        limit?: number;
        [key: string]: unknown;
    };
    /** Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared. GROUND TRUTH (hub#1497): the gateway PresenceService rejects the frame without channel ("Channel is required") — channel is REQUIRED, not optional as previously declared. */
    'client.presence.subscribe': {
        service: 'presence';
        action: 'subscribe';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to stop receiving presence events for a channel (usePresence cleanup). */
    'client.presence.unsubscribe': {
        service: 'presence';
        action: 'unsubscribe';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to set its presence entry (usePresence setStatus / updateMetadata). GROUND TRUTH (hub#1497): the gateway PresenceService requires status ("Status is required") and reads only { status, metadata, channels } — the channel field is sent by the hook but IGNORED by the service (presence pinning uses the channels array). Previously declared with channel required + status optional; both were wrong. */
    'client.presence.set': {
        service: 'presence';
        action: 'set';
        channel?: string;
        status: string;
        metadata?: Record<string, unknown>;
        channels?: string[];
        [key: string]: unknown;
    };
    /** Client request to read presence data for a single client (targetClientId) or a whole channel (channel). GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleGetPresence requires AT LEAST ONE of targetClientId or channel ("Either targetClientId or channel is required" — an either-or constraint JSON-schema-encodable only via anyOf, which the type generator does not support, so both fields are declared optional here). targetClientId wins when both are present; unknown targetClientId yields "Client not found". Replies with a presence/presence action frame carrying the data. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client. */
    'client.presence.get': {
        service: 'presence';
        action: 'get';
        channel?: string;
        targetClientId?: string;
        [key: string]: unknown;
    };
    /** Client keep-alive that refreshes lastSeen/lastHeartbeat on its existing presence entry so the stale-presence sweep does not reap it. GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleHeartbeat reads NO payload fields beyond service/action (data is ignored) and sends no reply; it is a silent no-op when the client has no presence entry (set first). PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client. */
    'client.presence.heartbeat': {
        service: 'presence';
        action: 'heartbeat';
        channel?: string;
        [key: string]: unknown;
    };
    /** Client request to receive emoji reactions for a channel. Sent by useReactions on mount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleSubscribeToReactions requires channel ("Channel name is required", length-validated 1..maxChannelNameLength) and runs the consumer authz hook; on success it replies with a reaction/reaction_subscribed success frame whose data includes the availableReactions emoji list. */
    'client.reaction.subscribe': {
        service: 'reaction';
        action: 'subscribe';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to stop receiving emoji reactions for a channel. Sent by useReactions cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleUnsubscribeFromReactions requires channel ("Channel name is required") and replies with a reaction/reaction_unsubscribed success frame. */
    'client.reaction.unsubscribe': {
        service: 'reaction';
        action: 'unsubscribe';
        channel: string;
        [key: string]: unknown;
    };
    /** Client request to send an emoji reaction to a channel (useReactions.react). GROUND TRUTH (hub#1497): the gateway ReactionService verb is "send" — the previously declared "react" was never accepted. emoji must be in the gateway's available-reactions catalog; position is optional overlay placement; metadata passes through. NOTE: targetId is sent by useReactions for entity-scoped reactions but the current gateway ReactionService does NOT forward it to subscribers. */
    'client.reaction.send': {
        service: 'reaction';
        action: 'send';
        channel: string;
        emoji: string;
        position?: Record<string, unknown>;
        targetId?: string;
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Client request for the gateway's available-reactions catalog (emoji → effect map). GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleGetAvailableReactions reads NO payload fields beyond service/action (channel is ignored) and replies with a reaction/available_reactions success frame carrying the full reactions catalog. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 (subscribers get the emoji list in the reaction_subscribed reply instead) — declared as the gateway-verified verb for any WS client. */
    'client.reaction.getAvailable': {
        service: 'reaction';
        action: 'getAvailable';
        channel?: string;
        [key: string]: unknown;
    };
    /** Client request to subscribe to the activity feed for a channel (useActivity mount). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. No history is auto-pushed on subscribe; clients request it explicitly via client.activity.getHistory. */
    'client.activity.subscribe': {
        service: 'activity';
        action: 'subscribe';
        channel?: string;
        channelId: string;
        [key: string]: unknown;
    };
    /** Client request to unsubscribe from the activity feed for a channel (useActivity cleanup). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. */
    'client.activity.unsubscribe': {
        service: 'activity';
        action: 'unsubscribe';
        channel?: string;
        channelId: string;
        [key: string]: unknown;
    };
    /** Client request for prior activity events for a channel (useActivity.loadHistory). GROUND TRUTH (hub#1497): the gateway verb is "getHistory" — the previously declared "history" action was rejected ("Unknown activity action"). Keys on channelId; limit is optional (server clamps to 1..maxHistoryItems, default 50). */
    'client.activity.getHistory': {
        service: 'activity';
        action: 'getHistory';
        channel?: string;
        channelId: string;
        limit?: number;
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
        updateId?: string;
        [key: string]: unknown;
    };
    /** Idempotent schema-version-2 binary canvas bootstrap under source-revision authority. Does not replace existing documents. */
    'client.crdt.seed-document': {
        service: 'crdt';
        action: 'seedDocument';
        channel: string;
        snapshot: string;
        sourceRevision: string;
        title?: string;
        type?: string;
        requestId?: string;
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
    /** Ask for a document call's live meta. The gateway replies to the sender only with ws.call.call-meta. */
    'client.call.meta': {
        service: 'call';
        action: 'meta';
        channel?: string;
        callId: string;
        [key: string]: unknown;
    };
    /** Replace a document call's review documents (host document stays first). Any participant. Broadcasts ws.call.call-meta. */
    'client.call.set-documents': {
        service: 'call';
        action: 'set-documents';
        channel?: string;
        callId: string;
        documentIds: string[];
        documentTitles?: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Present a review document, or stop with documentId null. Only the current presenter or the host may replace a presenter. Broadcasts ws.call.call-meta. */
    'client.call.present': {
        service: 'call';
        action: 'present';
        channel?: string;
        callId: string;
        documentId?: string | null;
        [key: string]: unknown;
    };
    /** Rename a document call. Host only. Broadcasts ws.call.call-meta. */
    'client.call.set-title': {
        service: 'call';
        action: 'set-title';
        channel?: string;
        callId: string;
        title: string;
        [key: string]: unknown;
    };
    /** Host asks a participant to mute. The gateway sends ws.call.mute-participant to that person's connections only. */
    'client.call.mute-participant': {
        service: 'call';
        action: 'mute-participant';
        channel?: string;
        callId: string;
        userId: string;
        [key: string]: unknown;
    };
    /** Host removes a participant. The gateway sends ws.call.remove-participant to them, user-status left (reason removed) and call-meta to everyone else. */
    'client.call.remove-participant': {
        service: 'call';
        action: 'remove-participant';
        channel?: string;
        callId: string;
        userId: string;
        [key: string]: unknown;
    };
    /** Host hands the host role to another participant. The gateway broadcasts ws.call.call-meta with the new hostUserId. */
    'client.call.transfer-host': {
        service: 'call';
        action: 'transfer-host';
        channel?: string;
        callId: string;
        userId: string;
        [key: string]: unknown;
    };
    /** Join a meeting's coordination channel. The gateway replies to the sender only with ws.meeting.meeting.snapshot (or ws.meeting.error FORBIDDEN when the channel guard refuses). The first subscriber becomes the default organizer. Sent again after every reconnect. */
    'client.meeting.subscribe': {
        service: 'meeting';
        action: 'subscribe';
        channel?: string;
        meetingId: string;
        [key: string]: unknown;
    };
    /** Leave a meeting's coordination channel. The gateway replies with ws.meeting.meeting.unsubscribed; when this was the user's last connection in the meeting their raised hand goes down (ws.meeting.hands.changed). */
    'client.meeting.unsubscribe': {
        service: 'meeting';
        action: 'unsubscribe';
        channel?: string;
        meetingId: string;
        [key: string]: unknown;
    };
    /** Raise your own hand. Any subscribed, signed-in participant. A hand already raised is a no-op; otherwise broadcasts ws.meeting.hands.changed. */
    'client.meeting.hand.raise': {
        service: 'meeting';
        action: 'hand.raise';
        channel?: string;
        meetingId: string;
        displayName?: string;
        [key: string]: unknown;
    };
    /** Lower your own hand (no userId), or someone else's — organizer only when userId names another user (ws.meeting.error FORBIDDEN otherwise). A hand not raised is a no-op; otherwise broadcasts ws.meeting.hands.changed. */
    'client.meeting.hand.lower': {
        service: 'meeting';
        action: 'hand.lower';
        channel?: string;
        meetingId: string;
        userId?: string;
        [key: string]: unknown;
    };
    /** Organizer only. Lower every raised hand. Broadcasts ws.meeting.hands.changed unless no hand was up. */
    'client.meeting.hand.lowerAll': {
        service: 'meeting';
        action: 'hand.lowerAll';
        channel?: string;
        meetingId: string;
        [key: string]: unknown;
    };
    /** Organizer only. Replace the breakout plan: rooms (all closed), mode and settings; clears the timer, returned list and latest announcement. Refused with CONFLICT while rooms are open. At most maxRooms rooms (host config, default 50). An empty list ends the session (phase none). Malformed fields are refused with INVALID_PAYLOAD, never ignored (realtime-modules 0.131.0): a mode other than assigned/self-select, a non-boolean allowReturnToMain, a room draft that is not an object, a room name that is neither a string nor null, or members that are not an array of userIds. Absent mode and allowReturnToMain keep their current values. The announcement history (breakout.announcements) is kept. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.configure': {
        service: 'meeting';
        action: 'breakout.configure';
        channel?: string;
        meetingId: string;
        rooms: ({
            id?: string;
            name?: string | null;
            members?: string[];
            [key: string]: unknown;
        })[];
        mode?: 'assigned' | 'self-select';
        allowReturnToMain?: boolean;
        [key: string]: unknown;
    };
    /** Organizer only. Add one closed room in any phase (open it with client.meeting.breakout.open and its id). CONFLICT at maxRooms (default 50) or on a duplicate id. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.addRoom': {
        service: 'meeting';
        action: 'breakout.addRoom';
        channel?: string;
        meetingId: string;
        id?: string;
        name?: string | null;
        [key: string]: unknown;
    };
    /** Organizer only. Rename a room in any phase. NOT_FOUND for an unknown room; the same name is a no-op. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.rename': {
        service: 'meeting';
        action: 'breakout.rename';
        channel?: string;
        meetingId: string;
        roomId: string;
        name: string;
        [key: string]: unknown;
    };
    /** Organizer only. Place or unplace people: each entry moves that user to the room (out of any other) or, with null, out of every room. An unknown room id is INVALID_PAYLOAD. Assigned users drop off the returned list. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.assign': {
        service: 'meeting';
        action: 'breakout.assign';
        channel?: string;
        meetingId: string;
        assignments: Record<string, unknown>;
        [key: string]: unknown;
    };
    /** Organizer only. Replace every room's members by dealing the listed users round-robin across the rooms in order; clears the returned list. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.autoAssign': {
        service: 'meeting';
        action: 'breakout.autoAssign';
        channel?: string;
        meetingId: string;
        userIds?: string[];
        [key: string]: unknown;
    };
    /** Organizer only. Open the listed rooms, or all of them. Cancels a closing countdown. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.open': {
        service: 'meeting';
        action: 'breakout.open';
        channel?: string;
        meetingId: string;
        roomIds?: string[];
        [key: string]: unknown;
    };
    /** Organizer only. Close the listed rooms at once, or all of them. Closing all while rooms are open starts the host's closing grace (breakout.closing true, endsAt the end of the grace) unless immediate is set or a grace is already running. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.close': {
        service: 'meeting';
        action: 'breakout.close';
        channel?: string;
        meetingId: string;
        roomIds?: string[];
        immediate?: boolean;
        [key: string]: unknown;
    };
    /** Organizer only. Start a timer that closes every room when it runs out, or clear it with null. A duration needs open rooms (CONFLICT otherwise) and must be above 0 and at most maxTimerMs (host config, default 4 h = 14400000; INVALID_PAYLOAD otherwise). Cancels a closing countdown. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.timer': {
        service: 'meeting';
        action: 'breakout.timer';
        channel?: string;
        meetingId: string;
        durationMs?: number | null;
        [key: string]: unknown;
    };
    /** Organizer only. Send an announcement to every room and the main meeting. Stored as breakout.announcement and broadcast as ws.meeting.breakout.changed then ws.meeting.breakout.announcement. */
    'client.meeting.breakout.broadcast': {
        service: 'meeting';
        action: 'breakout.broadcast';
        channel?: string;
        meetingId: string;
        message: string;
        displayName?: string;
        [key: string]: unknown;
    };
    /** Move yourself into an open room. Any participant in self-select mode; in assigned mode only your own room (FORBIDDEN otherwise) — organizers may visit any room. NOT_FOUND for an unknown room, CONFLICT when it is closed or the rooms are closing. Rejoining your assigned room after returning to main takes you off the returned list. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.join': {
        service: 'meeting';
        action: 'breakout.join';
        channel?: string;
        meetingId: string;
        roomId: string;
        [key: string]: unknown;
    };
    /** Return from your room to the main meeting. FORBIDDEN when settings.allowReturnToMain is false (organizers exempt). In self-select mode you leave the room; in assigned mode you stay assigned and join the returned list. Not in a room is a no-op. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.leave': {
        service: 'meeting';
        action: 'breakout.leave';
        channel?: string;
        meetingId: string;
        [key: string]: unknown;
    };
    /** Organizer only. End the breakout session: every room closes and everyone returns to the main meeting (rooms are kept as a draft). While rooms are open this starts the host's closing grace unless immediate is set or a grace is already running. No session is a no-op. Broadcasts ws.meeting.breakout.changed. */
    'client.meeting.breakout.end': {
        service: 'meeting';
        action: 'breakout.end';
        channel?: string;
        meetingId: string;
        immediate?: boolean;
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
/** Union of every outbound client→gateway frame for the `chat` service. */
export type ChatOutboundFrame = ClientFramePayloadMap['client.chat.join'] | ClientFramePayloadMap['client.chat.leave'] | ClientFramePayloadMap['client.chat.send'] | ClientFramePayloadMap['client.chat.typing'] | ClientFramePayloadMap['client.chat.members'] | ClientFramePayloadMap['client.chat.addMembers'] | ClientFramePayloadMap['client.chat.removeMember'] | ClientFramePayloadMap['client.chat.edit'] | ClientFramePayloadMap['client.chat.delete'] | ClientFramePayloadMap['client.chat.history'];
/** Union of every outbound client→gateway frame for the `presence` service. */
export type PresenceOutboundFrame = ClientFramePayloadMap['client.presence.subscribe'] | ClientFramePayloadMap['client.presence.unsubscribe'] | ClientFramePayloadMap['client.presence.set'] | ClientFramePayloadMap['client.presence.get'] | ClientFramePayloadMap['client.presence.heartbeat'];
/** Union of every outbound client→gateway frame for the `reaction` service. */
export type ReactionOutboundFrame = ClientFramePayloadMap['client.reaction.subscribe'] | ClientFramePayloadMap['client.reaction.unsubscribe'] | ClientFramePayloadMap['client.reaction.send'] | ClientFramePayloadMap['client.reaction.getAvailable'];
/** Union of every outbound client→gateway frame for the `activity` service. */
export type ActivityOutboundFrame = ClientFramePayloadMap['client.activity.subscribe'] | ClientFramePayloadMap['client.activity.unsubscribe'] | ClientFramePayloadMap['client.activity.getHistory'];
/** Union of every outbound client→gateway frame for the `crdt` service. */
export type CrdtOutboundFrame = ClientFramePayloadMap['client.crdt.subscribe'] | ClientFramePayloadMap['client.crdt.unsubscribe'] | ClientFramePayloadMap['client.crdt.update'] | ClientFramePayloadMap['client.crdt.seed-document'] | ClientFramePayloadMap['client.crdt.awareness'];
/** Union of every outbound client→gateway frame for the `fileupload` service. */
export type FileuploadOutboundFrame = ClientFramePayloadMap['client.fileupload.request-upload'] | ClientFramePayloadMap['client.fileupload.complete'] | ClientFramePayloadMap['client.fileupload.cancel'];
/** Union of every outbound client→gateway frame for the `videohangout` service. */
export type VideohangoutOutboundFrame = ClientFramePayloadMap['client.videohangout.start'] | ClientFramePayloadMap['client.videohangout.join'] | ClientFramePayloadMap['client.videohangout.leave'] | ClientFramePayloadMap['client.videohangout.end'] | ClientFramePayloadMap['client.videohangout.toggle-video'] | ClientFramePayloadMap['client.videohangout.toggle-audio'];
/** Union of every outbound client→gateway frame for the `subscribe` service. */
export type SubscribeOutboundFrame = ClientFramePayloadMap['client.subscribe.subscribe'] | ClientFramePayloadMap['client.subscribe.unsubscribe'];
/** Union of every outbound client→gateway frame for the `call` service. */
export type CallOutboundFrame = ClientFramePayloadMap['client.call.meta'] | ClientFramePayloadMap['client.call.set-documents'] | ClientFramePayloadMap['client.call.present'] | ClientFramePayloadMap['client.call.set-title'] | ClientFramePayloadMap['client.call.mute-participant'] | ClientFramePayloadMap['client.call.remove-participant'] | ClientFramePayloadMap['client.call.transfer-host'];
/** Union of every outbound client→gateway frame for the `meeting` service. */
export type MeetingOutboundFrame = ClientFramePayloadMap['client.meeting.subscribe'] | ClientFramePayloadMap['client.meeting.unsubscribe'] | ClientFramePayloadMap['client.meeting.hand.raise'] | ClientFramePayloadMap['client.meeting.hand.lower'] | ClientFramePayloadMap['client.meeting.hand.lowerAll'] | ClientFramePayloadMap['client.meeting.breakout.configure'] | ClientFramePayloadMap['client.meeting.breakout.addRoom'] | ClientFramePayloadMap['client.meeting.breakout.rename'] | ClientFramePayloadMap['client.meeting.breakout.assign'] | ClientFramePayloadMap['client.meeting.breakout.autoAssign'] | ClientFramePayloadMap['client.meeting.breakout.open'] | ClientFramePayloadMap['client.meeting.breakout.close'] | ClientFramePayloadMap['client.meeting.breakout.timer'] | ClientFramePayloadMap['client.meeting.breakout.broadcast'] | ClientFramePayloadMap['client.meeting.breakout.join'] | ClientFramePayloadMap['client.meeting.breakout.leave'] | ClientFramePayloadMap['client.meeting.breakout.end'];
/** Union of every inbound gateway→client push frame for the `chat` service. */
export type ChatInboundFrame = EventPayloadMap['ws.chat.joined'] | EventPayloadMap['ws.chat.left'] | EventPayloadMap['ws.chat.message'] | EventPayloadMap['ws.chat.sent'] | EventPayloadMap['ws.chat.history'];
/** Union of every inbound gateway→client push frame for the `cursor` service. */
export type CursorInboundFrame = EventPayloadMap['ws.cursor.subscribed'] | EventPayloadMap['ws.cursor.unsubscribed'] | EventPayloadMap['ws.cursor.update'] | EventPayloadMap['ws.cursor.remove'] | EventPayloadMap['ws.cursor.cursors'] | EventPayloadMap['ws.cursor.modes'] | EventPayloadMap['ws.cursor.clear'] | EventPayloadMap['ws.cursor.batch'];
/** Union of every inbound gateway→client push frame for the `activity` service. */
export type ActivityInboundFrame = EventPayloadMap['ws.activity.subscribed'] | EventPayloadMap['ws.activity.unsubscribed'] | EventPayloadMap['ws.activity.published'] | EventPayloadMap['ws.activity.history'] | EventPayloadMap['ws.activity.event'];
/** Union of every inbound gateway→client push frame for the `crdt` service. */
export type CrdtInboundFrame = EventPayloadMap['ws.crdt.subscribed'] | EventPayloadMap['ws.crdt.unsubscribed'] | EventPayloadMap['ws.crdt.snapshot'] | EventPayloadMap['ws.crdt.update'] | EventPayloadMap['ws.crdt.persisted'] | EventPayloadMap['ws.crdt.persistence-error'] | EventPayloadMap['ws.crdt.seeded'] | EventPayloadMap['ws.crdt.doc-replaced'] | EventPayloadMap['ws.crdt.sync-request'] | EventPayloadMap['ws.crdt.sync-response'] | EventPayloadMap['ws.crdt.snapshot-stored'] | EventPayloadMap['ws.crdt.awareness-batch'] | EventPayloadMap['ws.crdt.awareness'];
/** Union of every inbound gateway→client push frame for the `presence` service. */
export type PresenceInboundFrame = EventPayloadMap['ws.presence.set'] | EventPayloadMap['ws.presence.update'] | EventPayloadMap['ws.presence.subscribed'] | EventPayloadMap['ws.presence.unsubscribed'] | EventPayloadMap['ws.presence.data'] | EventPayloadMap['ws.presence.offline'] | EventPayloadMap['ws.presence.joined'] | EventPayloadMap['ws.presence.left'];
/** Union of every inbound gateway→client push frame for the `reaction` service. */
export type ReactionInboundFrame = EventPayloadMap['ws.reaction.subscribed'] | EventPayloadMap['ws.reaction.received'] | EventPayloadMap['ws.reaction.removed'] | EventPayloadMap['ws.reaction.list'] | EventPayloadMap['ws.reaction.history'] | EventPayloadMap['ws.reaction.sent'] | EventPayloadMap['ws.reaction.unsubscribed'] | EventPayloadMap['ws.reaction.available'];
/** Union of every inbound gateway→client push frame for the `call` service. */
export type CallInboundFrame = EventPayloadMap['ws.call.invite'] | EventPayloadMap['ws.call.accepted'] | EventPayloadMap['ws.call.declined'] | EventPayloadMap['ws.call.cancelled'] | EventPayloadMap['ws.call.ended'] | EventPayloadMap['ws.call.video-on'] | EventPayloadMap['ws.call.video-off'] | EventPayloadMap['ws.call.recording-started'] | EventPayloadMap['ws.call.recording-completed'] | EventPayloadMap['ws.call.call-meta'] | EventPayloadMap['ws.call.invite-expired'] | EventPayloadMap['ws.call.participant-state'] | EventPayloadMap['ws.call.user-status'] | EventPayloadMap['ws.call.mute-participant'] | EventPayloadMap['ws.call.remove-participant'];
/** Union of every inbound gateway→client push frame for the `meeting` service. */
export type MeetingInboundFrame = EventPayloadMap['ws.meeting.meeting.snapshot'] | EventPayloadMap['ws.meeting.hands.changed'] | EventPayloadMap['ws.meeting.breakout.changed'] | EventPayloadMap['ws.meeting.breakout.announcement'] | EventPayloadMap['ws.meeting.meeting.unsubscribed'] | EventPayloadMap['ws.meeting.error'];
/** Union of every inbound gateway→client push frame for the `upload` service. */
export type UploadInboundFrame = EventPayloadMap['ws.upload.requested'] | EventPayloadMap['ws.upload.url-issued'] | EventPayloadMap['ws.upload.completed'] | EventPayloadMap['ws.upload.failed'] | EventPayloadMap['ws.upload.scanned'] | EventPayloadMap['ws.upload.scan-quarantined'] | EventPayloadMap['ws.upload.url-revoked'];
/** Union of every inbound gateway→client push frame for the `pipeline` service. */
export type PipelineInboundFrame = EventPayloadMap['ws.pipeline.subscribed'] | EventPayloadMap['ws.pipeline.unsubscribed'] | EventPayloadMap['ws.pipeline.ack'] | EventPayloadMap['ws.pipeline.snapshot'] | EventPayloadMap['ws.pipeline.history'] | EventPayloadMap['ws.pipeline.event'];
/** Union of every inbound gateway→client push frame for the `session` service. */
export type SessionInboundFrame = EventPayloadMap['ws.session.connected'];
/** Union of every inbound gateway→client push frame for the `subscribe` service. */
export type SubscribeInboundFrame = EventPayloadMap['ws.subscribe.subscribed'] | EventPayloadMap['ws.subscribe.unsubscribed'];
/** Union of every inbound gateway→client push frame for the `fileupload` service. */
export type FileuploadInboundFrame = EventPayloadMap['ws.fileupload.url'] | EventPayloadMap['ws.fileupload.complete'] | EventPayloadMap['ws.fileupload.failed'] | EventPayloadMap['ws.fileupload.started'] | EventPayloadMap['ws.fileupload.progress'] | EventPayloadMap['ws.fileupload.scanning'] | EventPayloadMap['ws.fileupload.cancelled'];
/** Union of every inbound gateway→client push frame for the `videohangout` service. */
export type VideohangoutInboundFrame = EventPayloadMap['ws.videohangout.participant'] | EventPayloadMap['ws.videohangout.media'];
/** Union of every inbound gateway→client push frame for the `notification` service. */
export type NotificationInboundFrame = EventPayloadMap['ws.notification.new'] | EventPayloadMap['ws.notification.read'] | EventPayloadMap['ws.notification.bulk-update'];
/** Union of every inbound gateway→client push frame for the `capability` service. */
export type CapabilityInboundFrame = EventPayloadMap['ws.capability.updated'];
/** Union of every inbound gateway→client push frame for the `feature-flag` service. */
export type FeatureFlagInboundFrame = EventPayloadMap['ws.feature-flag.updated'];
//# sourceMappingURL=client-frames.d.ts.map