// call-captions.ts — live in-call caption stream + the transcription
// queue events that predate this file but were never declared.
//
// LIVE CHAIN (2026-08-25): LVS per-participant `webhook-pcm` audio taps →
// live-captions whisper sidecar (services/live-captions in the LVS repo)
// → Redis publish on `captions:<channelArn>` → gateway caption-relay →
// WS frame `{ type: 'caption', channel: 'captions:<arn>', data: <line> }`
// to clients subscribed via the generic subscribe service. The speaker's
// OWN client injects final lines into the call's chat channel, so chat
// attribution needs no server-side identity mapping.
//
// Modeled on pipeline-image-vision's streaming-token conventions:
// transport 'signal' (never durable), per-speaker monotonic `seq`,
// hot-path tags, cheap-subscriber contract.

import type { EventDeclaration } from '../types';

const TAGS = ['call', 'captions'];

/**
 * One transcribed utterance window from one speaker. High volume during
 * active speech (one event every ~2-4s per speaker). Subscribers MUST be
 * cheap — in-memory ring-buffer mutation only; the relay dispatches
 * fire-and-forget.
 */
export const callCaptionLine: EventDeclaration = {
    namespace: 'call',
    name: 'call:caption:line',
    transport: 'signal',
    producer: 'live-captions-sidecar',
    description:
        'A transcribed utterance from one call participant, produced by the live-ASR sidecar and relayed to captions:<channelArn> WS subscribers. `id` is stable per line so interim→final updates replace in place.',
    tags: [...TAGS, 'streaming', 'hot-path'],
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            participantId: {
                type: 'string',
                description: 'SFU wire participantId of the speaker (clients resolve display names from their members list).',
            },
            id: { type: 'string', description: 'Stable line id: `<participantId>-<seq>`.' },
            seq: {
                type: 'number',
                description: 'Monotonic per-speaker counter starting at 1 — detects drops/reordering.',
            },
            text: { type: 'string' },
            interim: {
                type: 'boolean',
                description: 'True for partial hypotheses that a later event with the same id replaces. The v1 sidecar emits finals only.',
            },
            at: { type: 'string', description: 'ISO-8601 emit time.' },
        },
        required: ['channelArn', 'participantId', 'id', 'seq', 'text', 'interim'],
        additionalProperties: false,
    },
};

/**
 * BACKFILL: post-call transcription job enqueue. Existed since the
 * 2026-08-24 transcription wave but was only documented as a queue-name
 * comment (queue-names.ts TRANSCRIPTION_JOBS). Durable MQ event.
 */
export const transcriptionJobQueued: EventDeclaration = {
    namespace: 'transcription',
    name: 'transcription:job.queued',
    transport: 'durable',
    producer: 'platform-api',
    description:
        'A completed recording with transcribe=true was queued for the transcription worker. Payload carries per-leg track URLs; the worker unwraps the event-catalog envelope.',
    tags: ['transcription', 'recording'],
    schema: {
        type: 'object',
        properties: {
            recordingId: { type: 'string' },
            callId: { type: 'string' },
            channelArn: { type: 'string' },
            tracks: { type: 'array' },
            durationMs: { type: 'number' },
            recordingProfile: { type: 'string' },
        },
        required: ['recordingId', 'channelArn', 'tracks'],
        additionalProperties: true,
    },
};

/**
 * BACKFILL: transcript ready — worker → platform-api summary consumer.
 */
export const transcriptionTranscriptReady: EventDeclaration = {
    namespace: 'transcription',
    name: 'transcription:transcript.ready',
    transport: 'durable',
    producer: 'transcription-worker',
    description:
        'transcript.json is written to recording storage; platform-api fetches it, generates the LLM summary, and flips transcriptStatus to ready.',
    tags: ['transcription', 'recording'],
    schema: {
        type: 'object',
        properties: {
            recordingId: { type: 'string' },
            callId: { type: 'string' },
            transcriptKey: { type: 'string' },
            transcriptUrl: { type: 'string' },
            durationMs: { type: 'number' },
            speakerCount: { type: 'number' },
            languages: { type: 'array' },
        },
        required: ['recordingId', 'transcriptKey'],
        additionalProperties: true,
    },
};

/**
 * Wave A (2026-08-25): summary generated + persisted. Consumed by
 * platform-api's summary-projector (projects '## Action Items' onto the
 * call-bound document as section items, then fires summary-bound
 * pipelines through the event dispatcher). Payload is deliberately
 * light — consumers re-read summaryMarkdown from the recording row.
 */
export const transcriptionSummaryReady: EventDeclaration = {
    namespace: 'transcription',
    name: 'transcription:summary.ready',
    transport: 'durable',
    producer: 'platform-api',
    description:
        'A meeting-summary markdown has been generated and persisted for a recording; projectors and summary-bound pipelines should run.',
    tags: ['transcription', 'recording', 'pipeline-trigger'],
    schema: {
        type: 'object',
        properties: {
            recordingId: { type: 'string' },
            callId: { type: 'string' },
            channelArn: { type: 'string' },
            lobbyName: { type: 'string' },
            summaryChars: { type: 'number' },
        },
        required: ['recordingId', 'callId'],
        additionalProperties: true,
    },
};

export const callCaptionDeclarations: EventDeclaration[] = [
    callCaptionLine,
    transcriptionJobQueued,
    transcriptionTranscriptReady,
    transcriptionSummaryReady,
];
