/** Outbound (client → gateway) frames are produced by the realtime-modules hooks. */
export declare const CLIENT_PRODUCER = "realtime-modules-client";
export declare const CLIENT_BASE_TAGS: string[];
/** Inbound (gateway → client) push frames are produced by the gateway. */
export declare const GATEWAY_PRODUCER = "websocket-gateway";
export declare const GATEWAY_BASE_TAGS: string[];
/**
 * Build an outbound client→gateway frame schema. Every outbound frame is a
 * JSON object with `service` + `action` literals plus per-action fields.
 * additionalProperties: true — the gateway's MessageValidator only enforces
 * service/action/channel structure, so extra fields pass through.
 */
export declare function clientFrameSchema(service: string, action: string, extra?: Record<string, unknown>, required?: string[]): Record<string, unknown>;
/** Build an inbound gateway→client frame schema keyed by a colon-form `type`. */
export declare function inboundSchema(typeLiteral: string, extra?: Record<string, unknown>, required?: string[]): Record<string, unknown>;
//# sourceMappingURL=_shared.d.ts.map