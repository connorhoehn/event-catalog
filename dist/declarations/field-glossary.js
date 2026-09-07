"use strict";
// src/declarations/field-glossary.ts
//
// Contract-hygiene support: a single place that says what the platform's
// recurring payload field names MEAN, plus the annotator that stamps those
// meanings onto declared JSON Schemas.
//
// WHY THIS EXISTS
// ---------------
// `tests/declaration-hygiene.test.ts` requires every declared property to
// carry a `description`. Roughly 780 properties across ~194 declarations
// were missing one, and the overwhelming majority are the SAME two dozen
// names repeated (`runId` × 58, `stepId` × 30, `channel` × 65, `type` × 112,
// `action` × 90 …). Re-typing "Identifier of the run this event belongs to"
// 58 times is how contracts rot: the 59th copy says something subtly
// different and now two consumers disagree about what `runId` is.
//
// So the glossary is data, not prose: one entry per field NAME, resolved at
// module-load time by `annotateDeclarations()`. A new declaration that
// reuses `runId` is compliant the moment it is written; a declaration that
// invents a NEW field name is not, and the hygiene test says so — which is
// exactly the pressure we want.
//
// SAFETY
// ------
// Annotation is purely additive. It only ever FILLS an absent `description`;
// a hand-written description on the declaration always wins, and nothing
// else about the schema is touched. It does change the schema's sha256
// fingerprint (descriptions are part of the canonical serialization), so
// `contracts/registry.snapshot.json` must be regenerated after edits here —
// but it cannot reject a payload that used to validate.
//
// SCOPING
// -------
// Two lookup keys are supported so an ambiguous name can be pinned down:
//   - a dotted PATH relative to the schema root, array indices elided:
//     `'usage.inputTokens'`, `'payload.notifications.title'`
//   - the bare property NAME: `'runId'`
// Path wins over name. Callers may pass a module-local glossary that layers
// over (and beats) the common one — that is how `type` means "AG-UI event
// discriminator" in ag-ui.ts and "WebSocket frame type" in gateway-signal.ts
// without either module lying about the other.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMON_FORMATS = exports.COMMON_FIELDS = void 0;
exports.annotateSchema = annotateSchema;
exports.annotateDeclarations = annotateDeclarations;
/**
 * Cross-namespace field vocabulary. Every entry here is a name whose meaning
 * is stable platform-wide; anything whose meaning shifts per namespace lives
 * in that module's local glossary instead.
 */
exports.COMMON_FIELDS = {
    // --- correlation / identity -------------------------------------------
    runId: 'Identifier of the run this event belongs to. The correlation key for every event in a single execution.',
    stepId: 'Identifier of the pipeline step this event belongs to (node id within the pipeline graph).',
    pipelineId: 'Identifier of the pipeline definition being executed.',
    pipelineVersion: 'Version of the pipeline definition this run was started against.',
    nodeId: 'Cluster node identifier.',
    clientId: 'Gateway-assigned WebSocket connection id for one client socket.',
    userId: 'Platform user id of the acting or referenced user.',
    sessionId: 'Identifier of the video/hangout session.',
    callId: 'Identifier of the call this event relates to.',
    channelArn: 'SFU channel ARN identifying the video call this event belongs to.',
    recordingId: 'Identifier of the recording.',
    messageId: 'Identifier of the message.',
    uploadId: 'Identifier of the upload.',
    correlationId: 'Client-supplied opaque id echoed back so a request can be matched to its response.',
    channel: 'Gateway channel (room) this frame is scoped to.',
    channelId: 'Gateway channel (room) this frame is scoped to.',
    id: 'Identifier of the subject of this frame.',
    participantId: 'SFU wire participant id of the speaker/participant.',
    snapshotId: 'Identifier of the stored snapshot.',
    docId: 'Identifier of the collaborative document.',
    // --- naming / display --------------------------------------------------
    name: 'Name of the subject of this event.',
    displayName: 'Human-readable display name shown in the UI.',
    lobbyName: 'Human-readable lobby/room name for the call.',
    title: 'Short human-readable headline.',
    label: 'Human-readable label rendered on the control.',
    filename: 'Original client-supplied file name.',
    mimeType: 'IANA media type of the uploaded file.',
    // --- time --------------------------------------------------------------
    at: 'ISO-8601 timestamp at which the producer emitted this event.',
    timestamp: 'ISO-8601 timestamp at which the producer emitted this event.',
    emittedAt: 'ISO-8601 timestamp at which the originating producer emitted the underlying event.',
    joinedAt: 'ISO-8601 timestamp at which the participant joined.',
    lastSeen: 'ISO-8601 timestamp at which this client was last observed.',
    lastHeartbeat: 'ISO-8601 timestamp of the most recent heartbeat from this client.',
    lastEventAt: 'ISO-8601 timestamp of the most recently applied event.',
    durationMs: 'Wall-clock duration in milliseconds.',
    latencyMs: 'Wall-clock latency of the underlying model call in milliseconds.',
    nextBackoffMs: 'Milliseconds the executor will wait before the next retry attempt.',
    // --- lifecycle / outcome ----------------------------------------------
    status: 'Current lifecycle status of the subject.',
    reason: 'Why the reported outcome happened.',
    error: 'Failure detail — what went wrong.',
    code: 'Machine-readable error code.',
    eventType: 'Application-level event type carried inside this envelope frame (e.g. `search.started`).',
    success: 'Whether the requested operation succeeded.',
    ok: 'Whether the operation succeeded.',
    enabled: 'Whether the flag/capability is currently on.',
    read: 'Whether the notification has been read by the recipient.',
    idle: 'Whether the client is currently idle.',
    attempt: '1-based retry counter for this attempt.',
    attemptNumber: '1-based index of this execution attempt for the step.',
    willRetry: 'Whether a further retry attempt is already scheduled.',
    seq: 'Monotonic per-producer sequence counter — lets consumers detect drops and reordering.',
    sequenceNumber: 'Monotonic sequence number of this snapshot within the run.',
    // --- model / cost accounting ------------------------------------------
    model: 'Provider model id used for the call.',
    prompt: 'Prompt text sent to the model.',
    response: 'Full response text returned by the model.',
    token: 'A single streamed output token.',
    tokensIn: 'Input (prompt) tokens consumed by the call.',
    tokensOut: 'Output (completion) tokens produced by the call.',
    inputTokens: 'Input (prompt) tokens consumed by the call.',
    outputTokens: 'Output (completion) tokens produced by the call.',
    cacheReadTokens: 'Input tokens served from the provider prompt cache.',
    cacheCreationTokens: 'Input tokens written into the provider prompt cache.',
    costUsd: 'Estimated cost of the call in US dollars.',
    usage: 'Token accounting for the underlying model call.',
    // --- free-form escape hatches -----------------------------------------
    metadata: 'Free-form producer-supplied metadata; opaque to the transport and never interpreted by the gateway.',
    data: 'Frame body — the per-action payload of this frame.',
    payload: 'Frame body — the per-frame payload.',
    output: 'Value produced by the step. Shape is node-type specific and deliberately unconstrained.',
    context: 'Execution context of the run at the moment of the snapshot.',
    detail: 'Free-form application detail attached to the activity entry.',
    value: 'Value carried by this entry.',
    content: 'Content body of the entry.',
    body: 'Body text of the notification.',
    message: 'Human-readable message.',
    // --- collections -------------------------------------------------------
    events: 'Ordered list of events, oldest first.',
    messages: 'Ordered list of messages, oldest first.',
    channels: 'Gateway channels this client is currently subscribed to.',
    cursors: 'Cursor positions for every participant currently in the channel.',
    reactions: 'Reactions currently recorded on the channel.',
    notifications: 'Notifications included in this batch.',
    updates: 'Batched updates carried by this frame.',
    languages: 'BCP-47 language tags detected in the transcript.',
    tracks: 'Per-leg recorded track descriptors for the job.',
    // --- media / calls -----------------------------------------------------
    audioOn: 'Whether the participant is currently publishing audio.',
    videoOn: 'Whether the participant is currently publishing video.',
    role: 'Role of the actor within the conversation or session.',
    emoji: 'Single emoji character carried by the reaction.',
    size: 'Size of the file in bytes.',
    downloadUrl: 'URL the client can fetch the finished artifact from.',
    presignedUrl: 'Short-lived presigned URL the client uploads to.',
    href: 'Destination URL the notification action navigates to.',
};
/**
 * Cross-namespace lexical formats. Same lookup rules as {@link COMMON_FIELDS}:
 * dotted path beats bare name, a module-local glossary beats this one.
 */
exports.COMMON_FORMATS = {
    // --- ISO-8601 instants --------------------------------------------------
    at: 'date-time',
    timestamp: 'date-time',
    startedAt: 'date-time',
    openedAt: 'date-time',
    expiresAt: 'date-time',
    joinedAt: 'date-time',
    lastEventAt: 'date-time',
    lastSeen: 'date-time',
    lastHeartbeatAt: 'date-time',
    // --- URLs ---------------------------------------------------------------
    transcriptUrl: 'uri',
    downloadUrl: 'uri',
    presignedUrl: 'uri',
    href: 'uri',
};
/** True when a sub-schema's `type` admits a string (`'string'` or `['string','null']`). */
function admitsString(sub) {
    const t = sub.type;
    if (typeof t === 'string')
        return t === 'string';
    if (Array.isArray(t))
        return t.includes('string');
    return false;
}
/**
 * Recursively stamp glossary descriptions (and lexical formats) onto a JSON
 * Schema, in place.
 *
 * Only fills a `description` or a `format` that is absent — never overwrites.
 * A `format` is additionally guarded on the sub-schema admitting a string, so
 * a name that is ISO-8601 in one event and epoch-millis in another is only
 * stamped where it is actually a string. Descends `properties`, `items`, and
 * object-valued `additionalProperties`; array hops do not add a path segment,
 * so `payload.notifications[].title` resolves as `payload.notifications.title`.
 */
function annotateSchema(schema, glossary, path = '', formats = {}) {
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema))
        return;
    const s = schema;
    const props = s.properties;
    if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
        for (const [key, sub] of Object.entries(props)) {
            if (sub === null || typeof sub !== 'object' || Array.isArray(sub))
                continue;
            const child = sub;
            const childPath = path ? `${path}.${key}` : key;
            if (typeof child.description !== 'string' || child.description.length === 0) {
                const described = glossary[childPath] ?? glossary[key];
                if (described !== undefined)
                    child.description = described;
            }
            if (child.format === undefined && admitsString(child)) {
                const format = formats[childPath] ?? formats[key];
                if (format !== undefined)
                    child.format = format;
            }
            annotateSchema(child, glossary, childPath, formats);
        }
    }
    // items — a single schema or a positional tuple. Neither adds a path hop.
    const items = s.items;
    if (Array.isArray(items)) {
        for (const entry of items)
            annotateSchema(entry, glossary, path, formats);
    }
    else if (items !== null && typeof items === 'object') {
        annotateSchema(items, glossary, path, formats);
    }
    const addl = s.additionalProperties;
    if (addl !== null && typeof addl === 'object' && !Array.isArray(addl)) {
        annotateSchema(addl, glossary, path, formats);
    }
}
/**
 * Annotate every declaration in `decls` and return the same array.
 *
 * Mutates the declarations' schema objects in place — declarations are
 * module-level singletons exported both individually and inside aggregate
 * arrays, so in-place is the only way both views stay identical. Idempotent:
 * a second call is a no-op because every description is already set.
 *
 * Call it once, at the bottom of the module that defines the declarations,
 * so consumers importing either the array or an individual constant see the
 * annotated schema.
 */
function annotateDeclarations(decls, glossary = {}, formats = {}) {
    const merged = { ...exports.COMMON_FIELDS, ...glossary };
    const mergedFormats = { ...exports.COMMON_FORMATS, ...formats };
    for (const decl of decls)
        annotateSchema(decl.schema, merged, '', mergedFormats);
    return decls;
}
//# sourceMappingURL=field-glossary.js.map