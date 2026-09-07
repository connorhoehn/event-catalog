import type { EventDeclaration } from '../../types/index';
/** Sent to the joining client after they successfully join a chat channel. */
export declare const wsChatJoined: EventDeclaration;
/** Sent to the leaving client after they successfully leave a chat channel. */
export declare const wsChatLeft: EventDeclaration;
/** Broadcast to all channel subscribers when a new chat message is posted. */
export declare const wsChatMessage: EventDeclaration;
/** Confirmation sent to the message sender after their message is stored+broadcast. */
export declare const wsChatSent: EventDeclaration;
/** Recent message history delivered to a client on join or explicit history request. */
export declare const wsChatHistory: EventDeclaration;
//# sourceMappingURL=chat.d.ts.map