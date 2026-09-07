"use strict";
// src/queue-names.ts
//
// Shared MQ queue-name constants (wave7-d).
//
// Single source of truth for message-queue queue names used across services.
// Both producers (platform-api) and consumers (gateway) import from here
// so a rename is caught at compile time rather than silently at runtime.
//
// DO NOT duplicate these strings in any service. Import this module instead.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSCRIPTION_SUMMARIES = exports.TRANSCRIPTION_JOBS = exports.ACTIVITY_RECORDED = exports.MQ_QUEUE_NAMES = void 0;
/**
 * Canonical message-queue queue names used across platform services.
 *
 * All values match the literal queue names created by the MQ service at
 * runtime — changing a value here IS a breaking rename and must be
 * coordinated with the MQ operator config.
 */
exports.MQ_QUEUE_NAMES = {
    /** Pipeline lifecycle + approval events (M4.4). Producer: platform-api. Consumer: gateway. */
    PIPELINE_EVENTS: 'pipeline-events',
    /**
     * Activity recording events (Block A.1). Producer: gateway (ActivityService).
     * Multi-consumer: platform-api + any analytics consumer (e.g. orgiq-analytics-group).
     * Registering here makes multi-consumer fan-out first-class and prevents
     * silent string drift between producer and consumer config.
     */
    // 'activity-recorded', not 'activity.recorded': both publish and
    // subscribe route through DurableTransport.eventNameToQueueName, which
    // replaces [:.] with '-'. The dotted value named a queue nothing ever
    // created, so anything configuring MQ from this constant would have
    // listened on an empty queue. No repo consumed it, so this corrects a
    // latent trap rather than changing live behaviour.
    ACTIVITY_RECORDED: 'activity-recorded',
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
    TRANSCRIPTION_JOBS: 'transcription-job-queued',
    /**
     * Transcript-ready handoff for LLM summarization. Producer:
     * transcription-worker (after writing transcript.json). Consumer:
     * platform-api summary subscriber (calls createLLMClient + COE-style
     * markdown prompt). Separate queue from TRANSCRIPTION_JOBS so the two
     * consumers don't compete for messages on the same queue. Name
     * matches `transcription:transcript.ready` event-catalog derivation.
     */
    TRANSCRIPTION_SUMMARIES: 'transcription-transcript-ready',
};
/**
 * Standalone re-export for callers that only need the activity.recorded
 * constant without importing the full MQ_QUEUE_NAMES map.
 */
exports.ACTIVITY_RECORDED = exports.MQ_QUEUE_NAMES.ACTIVITY_RECORDED;
/**
 * Standalone re-export for the transcription-jobs queue.
 */
exports.TRANSCRIPTION_JOBS = exports.MQ_QUEUE_NAMES.TRANSCRIPTION_JOBS;
/**
 * Standalone re-export for the transcription-summaries queue.
 */
exports.TRANSCRIPTION_SUMMARIES = exports.MQ_QUEUE_NAMES.TRANSCRIPTION_SUMMARIES;
//# sourceMappingURL=queue-names.js.map