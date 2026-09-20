import type { EventDeclaration } from '../../types/index';
/** Sent by GatewaySocketProvider when the 'chat' feature is active. */
export declare const clientChatJoin: EventDeclaration;
/** Sent by useChat cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export declare const clientChatLeave: EventDeclaration;
/** Sent by useChat.sendMessage(). */
export declare const clientChatSend: EventDeclaration;
/** Sent by useChat.setTyping(): the person is composing (or has stopped). */
export declare const clientChatTyping: EventDeclaration;
/** Sent by useChatMembers on mount: who is in the channel. */
export declare const clientChatMembers: EventDeclaration;
/** Sent by useChatMembers.addMembers(): add people, with the history they may read. */
export declare const clientChatAddMembers: EventDeclaration;
/** Sent by useChatMembers.removeMember(): an owner removes someone, or a member leaves. */
export declare const clientChatRemoveMember: EventDeclaration;
/** Sent by useChat.editMessage(): the author changes what they said. */
export declare const clientChatEdit: EventDeclaration;
/** Sent by useChat.deleteMessage(): the author takes a message back. */
export declare const clientChatDelete: EventDeclaration;
/** Sent by useChat.loadHistory(). */
export declare const clientChatHistory: EventDeclaration;
/** Sent by usePresence on mount and by GatewaySocketProvider on connect. */
export declare const clientPresenceSubscribe: EventDeclaration;
/** Sent by usePresence on unmount/channel change. */
export declare const clientPresenceUnsubscribe: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientPresenceGet: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientPresenceHeartbeat: EventDeclaration;
/** Sent by usePresence.setStatus() / updateMetadata(). */
export declare const clientPresenceSet: EventDeclaration;
/** Sent by useReactions on mount (channel subscribe) as of realtime-modules 0.14.0. */
export declare const clientReactionSubscribe: EventDeclaration;
/** Sent by useReactions cleanup (channel change / unmount) as of realtime-modules 0.14.0. */
export declare const clientReactionUnsubscribe: EventDeclaration;
/** Sent by useReactions.react() — the gateway verb is `send`. */
export declare const clientReactionSend: EventDeclaration;
/** No hook sender today — gateway-verified verb declared for contract completeness. */
export declare const clientReactionGetAvailable: EventDeclaration;
/** Sent by useActivity on mount. */
export declare const clientActivitySubscribe: EventDeclaration;
/** Sent by useActivity on unmount/channel change. */
export declare const clientActivityUnsubscribe: EventDeclaration;
/** Sent by useActivity.loadHistory() — the gateway verb is `getHistory`. */
export declare const clientActivityGetHistory: EventDeclaration;
/** Sent by useCRDT/useYjsDoc when (re)connecting to a CRDT channel. */
export declare const clientCrdtSubscribe: EventDeclaration;
/** Sent by useCRDT/useYjsDoc on unmount/channel change. */
export declare const clientCrdtUnsubscribe: EventDeclaration;
/** Sent by GatewayProvider doc-update handler and useCRDT.applyLocalEdit(). */
export declare const clientCrdtUpdate: EventDeclaration;
/** Sent (debounced 50ms) by GatewayProvider awareness handler. */
export declare const clientCrdtAwareness: EventDeclaration;
/** Sent by useWebSocket.subscribe() and the auto-resubscribe-on-reconnect path. */
export declare const clientSubscribeSubscribe: EventDeclaration;
/** Sent by useWebSocket.unsubscribe(). */
export declare const clientSubscribeUnsubscribe: EventDeclaration;
/** Trusted initial migration; requires a narrow seed-only document grant. */
export declare const clientCrdtSeedDocument: EventDeclaration;
//# sourceMappingURL=outbound-fanout.d.ts.map