// src/declarations/gateway-signal/subscribe.ts
//
// Acks for the generic channel multiplexer — src/realtime-fanout/subscribe-service.ts.
//
// ADDED 2026-09-07. The INBOUND half of this pair has been declared for a
// while (`client.subscribe.subscribe` / `client.subscribe.unsubscribe` in
// ../client-frames/outbound-fanout.ts); the gateway's ack back had no
// declaration on either side — not here, and not in the gateway's own
// `WS_FRAME_DECLARATIONS`. A request/ack pair with only the request declared
// is the half of the contract a client cannot act on.
//
// NOT built with `wsSchema`, deliberately. That helper injects an optional
// `timestamp` property, and these two frames genuinely do not carry one:
// `SubscribeService.send` (:250) hands the object straight to
// `messageRouter.sendToClient` with no envelope stamping, and the object
// literals at :191 and :206 are the whole frame. Declaring a `timestamp` the
// producer never sends is the same defect this repo records against
// `sfu.recording.completed $.composedUrl`.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, BASE_TAGS } from './_shared';

/** `{ type, action, channel }` — the entire frame, no envelope. */
function subscribeAckSchema(action: string): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: 'subscribe' },
            action: { type: 'string', const: action },
            channel: {
                type: 'string',
                description: 'The raw channel name the multiplexer acted on, echoed back verbatim from the client\'s request.',
            },
        },
        required: ['type', 'action', 'channel'],
        additionalProperties: true,
    };
}

/** The client's `subscribe` request was accepted. */
export const wsSubscribeSubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.subscribe.subscribed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Acknowledges that a client\'s generic-multiplexer subscribe took effect '
        + '(realtime-fanout/subscribe-service.ts:191). Its ABSENCE is meaningful and is the reason '
        + 'this needed declaring: the handler returns early without an ack on either authz denial '
        + '(the interceptor has already sent AUTHZ_CHANNEL_DENIED) or an unknown client, so a client '
        + 'that treats "no ack" as "probably fine" will believe it is subscribed to a channel the '
        + 'gateway refused it. Wait for this frame before assuming delivery.',
    tags: [...BASE_TAGS, 'subscribe'],
    schema: subscribeAckSchema('subscribed'),
};

/** The client's `unsubscribe` request was applied. */
export const wsSubscribeUnsubscribed: EventDeclaration = {
    namespace: 'ws',
    name: 'ws.subscribe.unsubscribed',
    transport: 'signal',
    producer: PRODUCER,
    description:
        'Acknowledges that a client\'s generic-multiplexer unsubscribe was applied '
        + '(realtime-fanout/subscribe-service.ts:206). Unlike the subscribe ack this one is '
        + 'unconditional: leaving a channel has no authz gate and the router no-ops for a channel '
        + 'the client was not on, so the frame is idempotent and always sent.',
    tags: [...BASE_TAGS, 'subscribe'],
    schema: subscribeAckSchema('unsubscribed'),
};
