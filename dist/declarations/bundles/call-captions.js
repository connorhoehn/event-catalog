"use strict";
// src/declarations/bundles/call-captions.ts
//
// "call-captions" FeatureBundle — live in-call captions and the
// post-call transcription pipeline.
//
// One coherent feature with two halves that a deployment adopts together:
//   * `call:caption:line`  — signal. The live whisper-sidecar stream
//     (LVS webhook-pcm tap → Redis `captions:<arn>` → gateway relay → WS).
//   * `transcription:*`    — durable. The post-call job queue that produces
//     the transcript and the summary.
//
// Turning captions on is what produces both; there is no deployment that
// wants the live lines but not the transcript, or vice versa.
//
// Source: src/declarations/call-captions.ts.
// Transport: 'both' — the member set genuinely spans the signal and
// durable buses, which is what 'both' means here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.callCaptionsBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'call-captions',
    version: '1.0.0',
    transport: 'both',
    description: 'Live in-call captions and post-call transcription — the real-time per-speaker caption '
        + 'stream (signal) plus the durable transcription job queue that yields the transcript and '
        + 'the generated summary. Summaries are optional; captions and transcripts are the core.',
    events: [
        // Live caption stream — signal
        { name: 'call:caption:line', required: true },
        // Post-call transcription queue — durable
        { name: 'transcription:job.queued', required: true },
        { name: 'transcription:transcript.ready', required: true },
        // Summarisation is a separate opt-in stage after the transcript lands
        { name: 'transcription:summary.ready', required: false },
    ],
};
exports.callCaptionsBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=call-captions.js.map