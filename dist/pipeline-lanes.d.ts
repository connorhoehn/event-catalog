/** Event types excluded from MQ by name (high rate or large context). */
export declare const PIPELINE_HOT_LANE_EVENT_TYPES: readonly string[];
/** Prefixes that make an event MQ-lane, unless excluded above or below. */
export declare const PIPELINE_MQ_LANE_PREFIXES: readonly string[];
/** Prefixes that stay on the hot lane even though a lane prefix matches. */
export declare const PIPELINE_HOT_LANE_PREFIXES: readonly string[];
/**
 * MQ's default max message is 256 KiB; the relay leaves room for the
 * envelope and skips a body whose JSON is larger than this, so such an event
 * rides the hot lane only.
 */
export declare const PIPELINE_MQ_MAX_BODY_BYTES: number;
/**
 * True when platform-api publishes this event type to MQ. Everything else
 * (including every `pipeline:llm:*` event) is hot-lane: Redis only.
 */
export declare function isPipelineMqLaneEvent(type: unknown): boolean;
/**
 * True when an event carried on Redis would NOT also arrive over MQ: its type
 * is hot-lane, or its JSON body is over `PIPELINE_MQ_MAX_BODY_BYTES` (the
 * relay skipped it). `bodyBytes` is the UTF-8 length of `JSON.stringify(event)`;
 * omit it to decide by type alone.
 */
export declare function isPipelineHotLaneEvent(type: unknown, bodyBytes?: number): boolean;
//# sourceMappingURL=pipeline-lanes.d.ts.map