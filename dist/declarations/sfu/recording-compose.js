"use strict";
// src/declarations/sfu/recording-compose.ts
//
// The `recording.compose.*` job lifecycle — five SIGNAL events added
// 2026-09-07, previously travelling undeclared.
//
// SAME BUS AS ./control-plane.ts, DIFFERENT SUBJECT
// -------------------------------------------------
// These ride `streamEventsHub.emit` exactly as the control-plane events do
// (see that file's header for why that bus crosses the process boundary),
// but they describe the background ffmpeg compose JOB rather than channel
// state, so they get their own file. Every one goes out through the shared
// helper `_emitRecordingEvent` (recording/RecordingManager.js:518), which
// prefixes the short type with `recording.` — hence the wire types are
// `recording.compose.queued` … `recording.compose.completed`, and the `sfu.`
// prefix here is the usual catalog-side qualification.
//
// Besides the cluster fan-out these have a SECOND named consumer: the
// recordings dashboard's SSE stream `GET /api/recordings/events`
// (api/channels/index.js:1594) subscribes to the hub and forwards exactly
// those messages whose `type` starts with `recording.` — this family plus
// the already-declared `sfu.recording.state.changed`.
//
// WHY THEY ARE NOT WEBHOOK EVENTS, AND WHY THAT MATTERS
// -----------------------------------------------------
// Compose runs AFTER the durable `sfu.recording.completed` webhook has
// already fired, so no webhook ever reports its outcome — platform-api
// records exactly this in CallRecordingRepository.ts ("the webhook fires
// before compose runs and never fires again") and reconciles compose status
// by polling instead. Declaring this family is what makes the compose
// outcome an observable contract rather than a poll.
//
// A CONSUMER WARNING, recorded because it is load-bearing: platform-api's
// webhook receiver dispatches on `eventType.toLowerCase().includes('recording')`
// then `.includes('completed')` (routes/lvsWebhooks.ts:~410). A
// `recording.compose.completed` payload reaching THAT endpoint would satisfy
// both substring tests and be mistaken for a finished recording. It cannot
// happen today — this family never touches webhookDispatcher — but the two
// names are one routing change apart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sfuRecordingComposeCompleted = exports.sfuRecordingComposeFailed = exports.sfuRecordingComposeProgress = exports.sfuRecordingComposeStarted = exports.sfuRecordingComposeQueued = void 0;
const _shared_1 = require("./_shared");
const COMPOSE_TAGS = [..._shared_1.BASE_TAGS, 'control-plane', 'recording', 'compose'];
/**
 * `jobId`, shared by four of the five events below.
 *
 * Deliberately NOT in any `required` array. Both production entry points set
 * it — `enqueueComposeJob` mints a uuid at RecordingManager.js:4141 and the
 * resume sweeper passes a `resume-…` id at :4339 — but `runComposeJob`
 * accepts the parameter with no default, and the manager itself guards on it
 * (`if (jobId)` before the progress write at :3960, `jobId || randomBytes(4)`
 * when naming the temp file at :3752). A field the producer defends against
 * being absent is not a required field.
 */
// A factory, not a shared constant: `annotateDeclarations` mutates schema
// objects in place, so four declarations must not share one object identity.
const jobId = () => ({
    type: 'string',
    description: 'Identifier of this compose attempt. Absent only when runComposeJob is invoked directly without one — '
        + 'both production enqueue paths always mint it.',
});
/** A finalized recording was queued for background composition. */
exports.sfuRecordingComposeQueued = {
    namespace: 'sfu',
    name: 'sfu.recording.compose.queued',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'A finalized multi-leg recording was accepted for background composition, before the ffmpeg job starts. '
        + 'Emitted from the tail of finalizeRecording (recording/RecordingManager.js:1662) so a client can show a '
        + '"Composing…" badge immediately; it is often the FIRST signal the recordings list gets that the row '
        + 'exists at all. Only the per-peer path reaches it — a single-file recording has no legs to compose.',
    tags: COMPOSE_TAGS,
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            legCount: {
                type: 'integer',
                minimum: 1,
                description: 'Number of per-participant legs the recording captured, and therefore the number of compose '
                    + 'candidates. The emit is gated on this being at least 1.',
            },
            durationMs: { type: 'integer', minimum: 0 },
            recordingStartedAt: { type: 'string' },
        },
        required: ['channelArn', 'recordingId', 'legCount', 'durationMs', 'recordingStartedAt'],
        additionalProperties: false,
    },
};
/** The background compose job began. */
exports.sfuRecordingComposeStarted = {
    namespace: 'sfu',
    name: 'sfu.recording.compose.started',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The background compose job for a recording began. Emitted on the first line of runComposeJob '
        + '(recording/RecordingManager.js:3754), before input triage and before ffmpeg is spawned, so it is '
        + 'unconditional for every attempt including the resume sweeper\'s.',
    tags: COMPOSE_TAGS,
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            jobId: jobId(),
        },
        required: ['channelArn', 'recordingId'],
        additionalProperties: false,
    },
};
/** The compose job crossed a 10% progress bucket. */
exports.sfuRecordingComposeProgress = {
    namespace: 'sfu',
    name: 'sfu.recording.compose.progress',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The running compose job crossed a 10% progress bucket. Derived from ffmpeg\'s `time=` stderr line and '
        + 'deliberately throttled to one event per bucket (recording/RecordingManager.js:3965), which keeps bus '
        + 'traffic linear in recording count rather than in frame count. A short compose may emit this zero '
        + 'times; it never reports 100 — completion is what `sfu.recording.compose.completed` is for.',
    tags: COMPOSE_TAGS,
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            jobId: jobId(),
            progressPct: {
                type: 'integer',
                minimum: 0,
                maximum: 99,
                description: 'Elapsed output time as a whole percentage of the planned duration, hard-capped at 99 by the '
                    + 'producer so a progress bar never claims completion the compose has not reached.',
            },
        },
        required: ['channelArn', 'recordingId', 'progressPct'],
        additionalProperties: false,
    },
};
/** The compose job failed. */
exports.sfuRecordingComposeFailed = {
    namespace: 'sfu',
    name: 'sfu.recording.compose.failed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The compose job failed and produced no usable output. Two emit sites carry DIFFERENT diagnostic fields: '
        + 'the windowed pre-pass failure (recording/RecordingManager.js:3897) sets `stage`, and the ffmpeg '
        + 'non-zero-exit / missing-output path (:4011) sets `exitCode`. A consumer must branch on which one is '
        + 'present rather than assume either; `reason` is the only human-readable field common to both.',
    tags: COMPOSE_TAGS,
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            jobId: jobId(),
            wallMs: { type: 'integer', minimum: 0 },
            reason: { type: 'string' },
            stage: {
                type: 'string',
                description: 'Which stage of the windowed pre-pass threw. Present ONLY on the pre-pass failure path; '
                    + 'defaults to `prepass` when the thrown error names none.',
            },
            exitCode: {
                type: 'integer',
                description: 'ffmpeg process exit code, or -1 when the process could not be spawned at all. Present ONLY '
                    + 'on the ffmpeg failure path.',
            },
        },
        required: ['channelArn', 'recordingId', 'wallMs', 'reason'],
        additionalProperties: false,
    },
};
/** The compose job produced a composed render. */
exports.sfuRecordingComposeCompleted = {
    namespace: 'sfu',
    name: 'sfu.recording.compose.completed',
    transport: 'signal',
    producer: _shared_1.PRODUCER,
    description: 'The compose job finished and its composed render was uploaded and persisted '
        + '(recording/RecordingManager.js:4093). This — not the `sfu.recording.completed` webhook — is the event '
        + 'that says a composed playback file exists, because compose runs after that webhook has already fired. '
        + '`composeStatus` distinguishes a clean render from one ffmpeg exited zero on but that came out '
        + 'materially shorter than planned.',
    tags: COMPOSE_TAGS,
    channel: 'stream-events',
    schema: {
        type: 'object',
        properties: {
            channelArn: { type: 'string' },
            recordingId: { type: 'string' },
            jobId: jobId(),
            wallMs: { type: 'integer', minimum: 0 },
            composeStatus: {
                type: 'string',
                enum: ['ok', 'degraded'],
                description: '`ok` when the muxed output matched the planned duration; `degraded` when ffmpeg exited clean '
                    + 'but the probed output is under 90% of it — a truncated tail. Never `failed`: a failure '
                    + 'emits sfu.recording.compose.failed instead.',
            },
            composedSegment: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Storage key of the composed render, relative to the recording bucket.' },
                    url: {
                        type: 'string',
                        description: 'Fetchable URL of the composed render. A `file://` path to the pod-local copy when no '
                            + 'storage backend is wired or the upload failed — check the scheme before handing it to a client.',
                    },
                    size: { type: 'integer', minimum: 0, description: 'Encoded size of the composed render in bytes.' },
                    legCount: {
                        type: 'integer',
                        minimum: 0,
                        description: 'Number of participant legs actually muxed in — legs skipped at triage are not counted.',
                    },
                    composedAt: { type: 'string', description: 'ISO-8601 timestamp at which the composed render was written.' },
                },
                required: ['key', 'url', 'size', 'legCount', 'composedAt'],
                additionalProperties: false,
                description: 'Descriptor of the composed single-file render this job produced.',
            },
            outputProbedDurationMs: {
                type: ['number', 'null'],
                description: 'Duration of the composed output as measured by ffprobe, in milliseconds. Null when probing '
                    + 'failed or no ffprobe binary is available — in which case `composeStatus` is graded `ok` on trust.',
            },
        },
        required: [
            'channelArn', 'recordingId', 'wallMs',
            'composeStatus', 'composedSegment', 'outputProbedDurationMs',
        ],
        additionalProperties: false,
    },
};
//# sourceMappingURL=recording-compose.js.map