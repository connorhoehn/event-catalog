import type { EventDeclaration } from '../types';
/**
 * One transcribed utterance window from one speaker. High volume during
 * active speech (one event every ~2-4s per speaker). Subscribers MUST be
 * cheap — in-memory ring-buffer mutation only; the relay dispatches
 * fire-and-forget.
 */
export declare const callCaptionLine: EventDeclaration;
/**
 * BACKFILL: post-call transcription job enqueue. Existed since the
 * 2026-08-24 transcription wave but was only documented as a queue-name
 * comment (queue-names.ts TRANSCRIPTION_JOBS). Durable MQ event.
 */
export declare const transcriptionJobQueued: EventDeclaration;
/**
 * BACKFILL: transcript ready — worker → platform-api summary consumer.
 */
export declare const transcriptionTranscriptReady: EventDeclaration;
/**
 * Wave A (2026-08-25): summary generated + persisted. Consumed by
 * platform-api's summary-projector (projects '## Action Items' onto the
 * call-bound document as section items, then fires summary-bound
 * pipelines through the event dispatcher). Payload is deliberately
 * light — consumers re-read summaryMarkdown from the recording row.
 */
export declare const transcriptionSummaryReady: EventDeclaration;
export declare const callCaptionDeclarations: EventDeclaration[];
//# sourceMappingURL=call-captions.d.ts.map