// src/declarations/client-frames/_shared.ts
//
// Producer identities + the two frame-schema builders shared by every module
// in this directory. Split out of the former single-file `client-frames.ts`;
// the declarations themselves are unchanged.
//
// The field glossary that annotates these schemas deliberately does NOT live
// here — it stays next to the single `annotateDeclarations()` call in the
// `../client-frames.ts` barrel, so there is exactly one place that decides
// which descriptions land on which events.

/** Outbound (client → gateway) frames are produced by the realtime-modules hooks. */
export const CLIENT_PRODUCER = 'realtime-modules-client';
export const CLIENT_BASE_TAGS = ['gateway', 'signal', 'client-frame', `producer:${CLIENT_PRODUCER}`];

/** Inbound (gateway → client) push frames are produced by the gateway. */
export const GATEWAY_PRODUCER = 'websocket-gateway';
export const GATEWAY_BASE_TAGS = ['gateway', 'signal', `producer:${GATEWAY_PRODUCER}`];

/**
 * Build an outbound client→gateway frame schema. Every outbound frame is a
 * JSON object with `service` + `action` literals plus per-action fields.
 * additionalProperties: true — the gateway's MessageValidator only enforces
 * service/action/channel structure, so extra fields pass through.
 */
export function clientFrameSchema(
    service: string,
    action: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            service: { type: 'string', const: service },
            action: { type: 'string', const: action },
            channel: { type: 'string' },
            ...extra,
        },
        required: ['service', 'action', ...required],
        additionalProperties: true,
    };
}

/** Build an inbound gateway→client frame schema keyed by a colon-form `type`. */
export function inboundSchema(
    typeLiteral: string,
    extra: Record<string, unknown> = {},
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            type: { type: 'string', const: typeLiteral },
            timestamp: { type: 'string', description: 'ISO-8601 timestamp at which the producer emitted this frame.' },
            ...extra,
        },
        required: ['type', ...required],
        additionalProperties: true,
    };
}
