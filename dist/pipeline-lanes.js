"use strict";
// src/pipeline-lanes.ts
//
// Which live pipeline events ride the MQ `pipeline-events` queue and which
// stay on the Redis bus only (the "hot lane").
//
// Single source of truth for BOTH sides: platform-api's MQ relay publishes
// exactly the events `isPipelineMqLaneEvent` accepts, and the gateway's hot
// lane subscribes Redis for exactly the rest. Keep them in one place so a
// new event family can never fall between the two lanes (realtime-examples
// NFR #130: in MQ-only mode checkpoints, heartbeats, LLM token streams and
// step context patches reached no browser because nothing carried them).
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIPELINE_MQ_MAX_BODY_BYTES = exports.PIPELINE_HOT_LANE_PREFIXES = exports.PIPELINE_MQ_LANE_PREFIXES = exports.PIPELINE_HOT_LANE_EVENT_TYPES = void 0;
exports.isPipelineMqLaneEvent = isPipelineMqLaneEvent;
exports.isPipelineHotLaneEvent = isPipelineHotLaneEvent;
/** Event types excluded from MQ by name (high rate or large context). */
exports.PIPELINE_HOT_LANE_EVENT_TYPES = Object.freeze([
    'pipeline:run:checkpoint',
    'pipeline:step:heartbeat',
]);
/** Prefixes that make an event MQ-lane, unless excluded above or below. */
exports.PIPELINE_MQ_LANE_PREFIXES = Object.freeze([
    'pipeline:run:',
    'pipeline:step:',
    'pipeline:approval:',
    'pipeline:deck:revise:',
]);
/** Prefixes that stay on the hot lane even though a lane prefix matches. */
exports.PIPELINE_HOT_LANE_PREFIXES = Object.freeze([
    'pipeline:step:context.',
]);
/**
 * MQ's default max message is 256 KiB; the relay leaves room for the
 * envelope and skips a body whose JSON is larger than this, so such an event
 * rides the hot lane only.
 */
exports.PIPELINE_MQ_MAX_BODY_BYTES = 200 * 1024;
const HOT_TYPES = new Set(exports.PIPELINE_HOT_LANE_EVENT_TYPES);
/**
 * True when platform-api publishes this event type to MQ. Everything else
 * (including every `pipeline:llm:*` event) is hot-lane: Redis only.
 */
function isPipelineMqLaneEvent(type) {
    if (typeof type !== 'string' || HOT_TYPES.has(type))
        return false;
    for (const p of exports.PIPELINE_HOT_LANE_PREFIXES)
        if (type.startsWith(p))
            return false;
    for (const p of exports.PIPELINE_MQ_LANE_PREFIXES)
        if (type.startsWith(p))
            return true;
    return false;
}
/**
 * True when an event carried on Redis would NOT also arrive over MQ: its type
 * is hot-lane, or its JSON body is over `PIPELINE_MQ_MAX_BODY_BYTES` (the
 * relay skipped it). `bodyBytes` is the UTF-8 length of `JSON.stringify(event)`;
 * omit it to decide by type alone.
 */
function isPipelineHotLaneEvent(type, bodyBytes) {
    if (!isPipelineMqLaneEvent(type))
        return true;
    return typeof bodyBytes === 'number' && bodyBytes > exports.PIPELINE_MQ_MAX_BODY_BYTES;
}
//# sourceMappingURL=pipeline-lanes.js.map