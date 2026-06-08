/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
export declare const MQ_QUEUE_NAMES: {
    /** Pipeline lifecycle + approval events (M4.4). Producer: platform-api. Consumer: gateway. */
    readonly PIPELINE_EVENTS: "pipeline-events";
    /**
     * Activity recording events (Block A.1). Producer: gateway (ActivityService).
     * Multi-consumer: platform-api + any analytics consumer (e.g. orgiq-analytics-group).
     * Registering here makes multi-consumer fan-out first-class and prevents
     * silent string drift between producer and consumer config.
     */
    readonly ACTIVITY_RECORDED: "activity.recorded";
    /**
     * Hangout-recording transcription jobs. Producer: platform-api (lvsWebhooks
     * on recording.completed when transcribe flag set). Consumer: the
     * transcription-worker container (live-video-streaming/services/
     * transcription-worker). Payload carries {recordingId, callId, tracks[]}
     * — worker fetches per-peer mp4s and runs faster-whisper per leg.
     * Long-running: visibility_timeout=3600s, dlq after 3 attempts.
     *
     * Name matches the auto-derived queue from event-catalog's
     * `transcription:job.queued` event (colon → dash, dot → dash). The
     * `queue:` field on catalog.declare() is informational; the durable
     * transport always routes by event-name-derived queue, so consumer
     * + producer must align on this string.
     */
    readonly TRANSCRIPTION_JOBS: "transcription-job-queued";
    /**
     * Transcript-ready handoff for LLM summarization. Producer:
     * transcription-worker (after writing transcript.json). Consumer:
     * platform-api summary subscriber (calls createLLMClient + COE-style
     * markdown prompt). Separate queue from TRANSCRIPTION_JOBS so the two
     * consumers don't compete for messages on the same queue. Name
     * matches `transcription:transcript.ready` event-catalog derivation.
     */
    readonly TRANSCRIPTION_SUMMARIES: "transcription-transcript-ready";
};
export type MQQueueName = (typeof MQ_QUEUE_NAMES)[keyof typeof MQ_QUEUE_NAMES];
/**
 * Standalone re-export for callers that only need the activity.recorded
 * constant without importing the full MQ_QUEUE_NAMES map.
 */
export declare const ACTIVITY_RECORDED: "activity.recorded";
/**
 * Standalone re-export for the transcription-jobs queue.
 */
export declare const TRANSCRIPTION_JOBS: "transcription-job-queued";
/**
 * Standalone re-export for the transcription-summaries queue.
 */
export declare const TRANSCRIPTION_SUMMARIES: "transcription-transcript-ready";
//# sourceMappingURL=queue-names.d.ts.map