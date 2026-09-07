"use strict";
// src/declarations/gateway-signal/_shared.ts
//
// Producer identity + the frame-schema helper shared by every module in this
// directory. Split out of the former single-file `gateway-signal.ts`; the
// declarations themselves are unchanged.
//
// The field glossary that annotates these schemas deliberately does NOT live
// here — it stays next to the single `annotateDeclarations()` call in the
// `../gateway-signal.ts` barrel, so there is exactly one place that decides
// which descriptions land on which events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASE_TAGS = exports.PRODUCER = void 0;
exports.wsSchema = wsSchema;
exports.PRODUCER = 'websocket-gateway';
exports.BASE_TAGS = ['gateway', 'signal', `producer:${exports.PRODUCER}`];
/** Build a loose WS frame schema with an explicit `type` value. */
function wsSchema(typeLiteral, extra = {}, required = []) {
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
//# sourceMappingURL=_shared.js.map