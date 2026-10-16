// AUTO-GENERATED — do not edit manually. Run: npm run generate-types
// Generated at: 2026-10-16T13:27:37.869Z

// prettier-ignore-file
/* eslint-disable */

/**
 * Map from every declared event name to its payload type.
 *
 * Usage:
 * ```ts
 * import type { EventPayloadMap, EventPayload } from '@connorhoehn/event-catalog';
 *
 * function publish<K extends keyof EventPayloadMap>(name: K, payload: EventPayload<K>) {
 *   // payload is fully typed
 * }
 * ```
 */
export interface EventPayloadMap {
  /** A pipeline approval node has been entered and is awaiting one or more approvers. Emitted on the in-process bus by distributed-core; forwarded onto the durable bus by platform-api (M4.4 v2) so workers and audit consumers receive it across restarts. */
  'pipeline.approval.requested': {
    runId: string;
    stepId: string;
    approvers?: ({
      type: 'user' | 'role';
      value: string;
      userId?: string;
      [key: string]: unknown;
    })[];
    at?: string;
    approverIds?: string[];
    requestedAt?: number;
    [key: string]: unknown;
  };
  /** An approver has recorded a decision against a pending pipeline approval. `decision` is the recorded outcome; `comment` carries an optional reviewer note. Dual-emitted on signal + durable so audit and worker consumers both see the decision. */
  'pipeline.approval.recorded': {
    runId: string;
    stepId: string;
    userId?: string;
    at?: string;
    reason?: string;
    approver?: string;
    decision: 'approve' | 'reject';
    comment?: string;
    decidedAt?: number;
    [key: string]: unknown;
  };
  /** An approval gate has reached a final decision (all required approvers have acted). `decision` is the aggregate outcome; `by` is the deciding approver ID for single-approver gates or the last to vote for multi-approver gates. */
  'pipeline.approval.resolved': {
    runId: string;
    stepId: string;
    approvalId: string;
    decision: 'approved' | 'rejected';
    by: string;
    reason?: string;
    resolvedAt: number;
    [key: string]: unknown;
  };
  /** A periodic snapshot of a running pipeline's execution context + frontier, emitted on the signal bus by distributed-core for audit and replay. Signal-only — durable replay relies on step-completion events, not the checkpoint stream. */
  'pipeline.run.checkpoint': {
    runId: string;
    context: Record<string, unknown>;
    currentStepIds: string[];
    sequenceNumber: number;
    at: string;
    [key: string]: unknown;
  };
  /** PipelineExecutor cancelled an in-flight run. */
  'pipeline:run:cancelled': {
    runId: string;
    at: string;
    [key: string]: unknown;
  };
  /** Run paused (Phase 5 pause/resume — reserved; no producer yet). */
  'pipeline:run:paused': {
    runId: string;
    at: string;
    atStepIds: string[];
    [key: string]: unknown;
  };
  /** Run resumed (Phase 5 pause/resume — reserved; no producer yet). */
  'pipeline:run:resumed': {
    runId: string;
    at: string;
    [key: string]: unknown;
  };
  /** A pipeline step entered execution. */
  'pipeline:step:started': {
    runId: string;
    at: string;
    stepId: string;
    nodeType: string;
    [key: string]: unknown;
  };
  /** A pipeline step finished successfully. */
  'pipeline:step:completed': {
    runId: string;
    at: string;
    stepId: string;
    durationMs: number;
    output?: unknown;
    artifactIds?: string[];
    [key: string]: unknown;
  };
  /** A pipeline step failed (after retry exhaustion). */
  'pipeline:step:failed': {
    runId: string;
    at: string;
    stepId: string;
    error: string;
    [key: string]: unknown;
  };
  /** A step was skipped (condition false, cancellation, etc.). */
  'pipeline:step:skipped': {
    runId: string;
    at: string;
    stepId: string;
    reason: string;
    [key: string]: unknown;
  };
  /** A step was cancelled mid-execution. */
  'pipeline:step:cancelled': {
    runId: string;
    at: string;
    stepId: string;
    [key: string]: unknown;
  };
  /** Periodic non-LLM step heartbeat (hub#1285). Consumed by StuckRunDetector. */
  'pipeline:step:heartbeat': {
    runId: string;
    at: string;
    stepId: string;
    [key: string]: unknown;
  };
  /** A per-step retry attempt started (hub#1687). Distinct schema: `startedAt` instead of `at`. */
  'pipeline:step:attempt:started': {
    runId: string;
    stepId: string;
    attemptNumber: number;
    startedAt: string;
    [key: string]: unknown;
  };
  /** A per-step retry attempt failed (hub#1687). `willRetry` indicates whether a further attempt is scheduled. */
  'pipeline:step:attempt:failed': {
    runId: string;
    stepId: string;
    attemptNumber: number;
    error: string;
    nextBackoffMs: number;
    willRetry: boolean;
    [key: string]: unknown;
  };
  /** LLM step prompt about to be sent to the provider. */
  'pipeline:llm:prompt': {
    runId: string;
    at: string;
    stepId: string;
    model: string;
    prompt: string;
    [key: string]: unknown;
  };
  /** Streamed LLM output token. High-volume; rate-limit before forwarding to clients. */
  'pipeline:llm:token': {
    runId: string;
    at: string;
    stepId: string;
    token: string;
    [key: string]: unknown;
  };
  /** LLM step received its full response, including token accounting. */
  'pipeline:llm:response': {
    runId: string;
    at: string;
    stepId: string;
    response: string;
    tokensIn: number;
    tokensOut: number;
    [key: string]: unknown;
  };
  /** LLM stream `for await` entry (DC-14). Pairs with first :token event for first-token-latency. Uses `openedAt` field (not `at`). */
  'pipeline:llm:stream:opened': {
    runId: string;
    stepId: string;
    model: string;
    openedAt: string;
    [key: string]: unknown;
  };
  /** A paused-run context patch was applied AND validated (or applied where no validator is registered for the node type). */
  'pipeline:step:context.patched': {
    runId: string;
    at: string;
    stepId: string;
    patchId: string;
    mode: string;
    [key: string]: unknown;
  };
  /** Variant of `context.patched` for the warning case where the paused step's node type has no ContextValidator registered. */
  'pipeline:step:context.patched-unvalidated': {
    runId: string;
    at: string;
    stepId: string;
    patchId: string;
    mode: string;
    [key: string]: unknown;
  };
  /** A previously-applied paused-run context patch was reverted (only legal while still paused at the same node). */
  'pipeline:step:context.patch-reverted': {
    runId: string;
    at: string;
    stepId: string;
    patchId: string;
    [key: string]: unknown;
  };
  /** PipelineExecutor started a new run. `triggeredBy` describes the trigger (manual, schedule, webhook, etc.). */
  'pipeline:run:started': {
    runId: string;
    at: string;
    pipelineId: string;
    triggeredBy: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** PipelineExecutor completed a run successfully. */
  'pipeline:run:completed': {
    runId: string;
    at: string;
    durationMs: number;
    artifactIds?: string[];
    [key: string]: unknown;
  };
  /** PipelineExecutor terminated a run with an error. `error` is a structured `PipelineRunError` object (not a plain string). */
  'pipeline:run:failed': {
    runId: string;
    at: string;
    error: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** A run lost its previous owner (node left the cluster, lease expired, etc.). Emitted by ResourceRouter before reassignment. */
  'pipeline:run:orphaned': {
    runId: string;
    at: string;
    previousOwner: string;
    [key: string]: unknown;
  };
  /** A run was reassigned from one cluster node to another. Pair with `pipeline:run:orphaned` for the full handoff trail. */
  'pipeline:run:reassigned': {
    runId: string;
    at: string;
    from: string;
    to: string;
    [key: string]: unknown;
  };
  /** A previously-failed (or completed, if explicitly opted in) run was restarted from `fromNodeId`. Fires before the dispatch loop re-enters at `fromNodeId`. */
  'pipeline:run:resumed-from-step': {
    runId: string;
    at: string;
    fromNodeId: string;
    originalFailedStepId?: string;
    [key: string]: unknown;
  };
  /** Gateway-local stub event emitted when handleResumeFromStep is invoked without a PipelineModule. Signals intent to resume a run from `fromNodeId`. For the DC-sourced completion event see `pipeline:run:resumed-from-step`. */
  'pipeline:run:resumeFromStep': {
    runId: string;
    at: string;
    fromNodeId: string;
    [key: string]: unknown;
  };
  /** PipelineExecutor is about to retry a run. `attempt` is the 1-based retry counter. Emitted before the run re-enters execution. */
  'pipeline:run:retry': {
    runId: string;
    at: string;
    attempt: number;
    [key: string]: unknown;
  };
  /** Emitted by StuckRunDetector when a `running` / `awaiting_approval` run has not received a heartbeat (step heartbeat or LLM token) for `stuckThresholdMs`. `lastHeartbeatAt` is null when no heartbeat was ever observed. */
  'pipeline:run:stuck': {
    runId: string;
    lastHeartbeatAt: string | null;
    at: string;
    [key: string]: unknown;
  };
  /** A step in a debug run has paused at its breakpoint. Pairs with hub#2226 context-patch events for edit-and-continue flows. */
  'pipeline:step:breakpoint': {
    runId: string;
    at: string;
    stepId: string;
    [key: string]: unknown;
  };
  /** A join node has received some but not all required inputs. `received` / `required` expose the per-join progress for dashboards. */
  'pipeline:join:waiting': {
    runId: string;
    at: string;
    stepId: string;
    received: number;
    required: number;
    [key: string]: unknown;
  };
  /** A join node has received all required inputs and dispatched downstream. `inputs` is the ordered list of contributing step IDs. */
  'pipeline:join:fired': {
    runId: string;
    at: string;
    stepId: string;
    inputs: string[];
    [key: string]: unknown;
  };
  /** Emitted by PipelineRaftStateMachine when a run-started command applies. Distinct from DC executor's `pipeline:run:started` (which has a different payload + producer). Payload is the full Raft slot record. */
  'pipeline:raft:run:started': {
    runId: string;
    slot: {
      runId: string;
      status: string;
      lastEvent?: string;
      lastEventAt?: string;
      lastAppliedIndex: number;
      pipelineId?: string;
      pipelineVersion?: number;
      ownerNodeId?: string;
      checkpoint?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Emitted by PipelineRaftStateMachine when a run-updated command transitions an existing run's status. Payload is the full Raft slot record after mutation. */
  'pipeline:raft:run:updated': {
    runId: string;
    slot: {
      runId: string;
      status: string;
      lastEvent?: string;
      lastEventAt?: string;
      lastAppliedIndex: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Emitted by PipelineRaftStateMachine when a run-updated command arrives for a runId with no existing slot (proposer's view of its own run-started commit lagged). A placeholder slot is synthesized rather than dropping the command. Operators should surface this as a warning. */
  'pipeline:raft:run:synthesized': {
    runId: string;
    slot: {
      runId: string;
      status: string;
      lastEvent?: string;
      lastEventAt?: string;
      lastAppliedIndex: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Emitted by PipelineRaftStateMachine when a run-checkpointed command lands. Payload is the full Raft slot record with the new checkpoint blob. */
  'pipeline:raft:run:checkpointed': {
    runId: string;
    slot: {
      runId: string;
      status: string;
      lastEvent?: string;
      lastEventAt?: string;
      lastAppliedIndex: number;
      checkpoint: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Emitted by PipelineRaftStateMachine when a run-terminated command lands (completed | failed | cancelled). Terminal status is sticky — subsequent terminations on the same runId are no-ops and DO NOT re-emit. */
  'pipeline:raft:run:terminated': {
    runId: string;
    slot: {
      runId: string;
      status: 'completed' | 'failed' | 'cancelled';
      lastEvent?: string;
      lastEventAt?: string;
      lastAppliedIndex: number;
      checkpoint?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** JudgeStepHandler entered the LLM-as-judge call after resolving inputs and passing the budget gate. */
  'pipeline:judge:started': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId: string;
    rubricId: string;
    rubricVersion: number;
    judgeModel: string;
    mode: 'absolute' | 'comparison';
    [key: string]: unknown;
  };
  /** Judge call completed successfully. Carries the full JudgmentResult (per-criterion scores + aggregated overall) plus usage/cost metrics for UI rendering and cost rollups. */
  'pipeline:judge:scored': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId: string;
    judgmentId: string;
    rubricId: string;
    judgeModel: string;
    result: Record<string, unknown>;
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      [key: string]: unknown;
    };
    costUsd: number;
    cacheHitRatio?: number;
    latencyMs: number;
    [key: string]: unknown;
  };
  /** Judge call did not produce a usable JudgmentResult — input resolution failed, model returned malformed JSON after retry, the CLI subprocess exited non-zero, or the call was aborted. Usage/cost still propagate when available so cost accounting stays honest (rule #1). */
  'pipeline:judge:failed': {
    runId: string;
    stepId: string;
    at: string;
    reason: 'input-resolution' | 'malformed' | 'aborted' | 'budget-exhausted' | 'unknown';
    error: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    latencyMs?: number;
    [key: string]: unknown;
  };
  /** JudgeBudgetGuard reported the daily budget exhausted before the LLM call. Step completes with `{skipped:"budget-exhausted"}` output — the judge is signal, not a correctness gate, so the step does not fail the run. */
  'pipeline:judge:budget-exceeded': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId: string;
    [key: string]: unknown;
  };
  /** VisionStepHandler entered the LLM-vision call after resolving the image ref and prompt template. */
  'pipeline:image:vision:started': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId: string;
    imageId: string;
    visionModel: string;
    hasSchema: boolean;
    [key: string]: unknown;
  };
  /** Per-token text delta emitted as the CLI streams the model response. UI subscribers accumulate deltas locally into a live preview; ignore when off-screen. */
  'pipeline:image:vision:token': {
    runId: string;
    stepId: string;
    at?: string;
    pipelineId: string;
    imageId: string;
    seq: number;
    delta: string;
    [key: string]: unknown;
  };
  /** Vision call completed successfully. Carries the full VisionResult plus usage/cost telemetry for UI rendering and audit drill-in. */
  'pipeline:image:vision:analyzed': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId: string;
    visionId: string;
    imageId: string;
    visionModel: string;
    result: Record<string, unknown>;
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      imageTokens?: number;
      [key: string]: unknown;
    };
    costUsd: number;
    latencyMs: number;
    [key: string]: unknown;
  };
  /** Vision call did not produce a usable VisionResult — image fetch failed, model returned malformed JSON after retry, the CLI subprocess exited non-zero, or the call was aborted. Usage/cost still propagate when available so telemetry stays honest. */
  'pipeline:image:vision:failed': {
    runId: string;
    stepId: string;
    at: string;
    pipelineId?: string;
    imageId?: string;
    reason: 'image-fetch' | 'input-resolution' | 'malformed' | 'aborted' | 'refusal' | 'unknown';
    error: string;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    latencyMs?: number;
    [key: string]: unknown;
  };
  /** A transcribed utterance from one call participant, produced by the live-ASR sidecar and relayed to captions:<channelArn> WS subscribers. `id` is stable per line so interim→final updates replace in place. */
  'call:caption:line': {
    channelArn: string;
    participantId: string;
    id: string;
    seq: number;
    text: string;
    interim: boolean;
    at?: string;
  };
  /** A completed recording with transcribe=true was queued for the transcription worker. Payload carries per-leg track URLs; the worker unwraps the event-catalog envelope. */
  'transcription:job.queued': {
    recordingId: string;
    callId?: string;
    channelArn: string;
    tracks: unknown[];
    durationMs?: number;
    recordingProfile?: string;
    [key: string]: unknown;
  };
  /** transcript.json is written to recording storage; platform-api fetches it, generates the LLM summary, and flips transcriptStatus to ready. */
  'transcription:transcript.ready': {
    recordingId: string;
    callId?: string;
    transcriptKey: string;
    transcriptUrl?: string;
    durationMs?: number;
    speakerCount?: number;
    languages?: unknown[];
    [key: string]: unknown;
  };
  /** A meeting-summary markdown has been generated and persisted for a recording; projectors and summary-bound pipelines should run. */
  'transcription:summary.ready': {
    recordingId: string;
    callId: string;
    channelArn?: string;
    lobbyName?: string;
    summaryChars?: number;
    [key: string]: unknown;
  };
  /** A tool call inside an agent step started or ended. Streamed live to the run view; payloads stay off the event and live in the persisted AgentStepOutput. */
  'pipeline:step:agent:tool': {
    runId: string;
    stepId: string;
    callIndex: number;
    name: string;
    phase: 'start' | 'end';
    ok?: boolean;
    at: string;
    [key: string]: unknown;
  };
  /** A scatter source node dispatched its arms. Fires exactly once per fan-out, on the source step, carrying the number of arms; the arms themselves report through the ordinary pipeline:step:* events under synthesized stepIds of the form `<nodeId>:<armIndex>`. This is the only event that states the fan-out width. */
  'pipeline:step:fanout': {
    runId: string;
    stepId: string;
    count: number;
    at: string;
    [key: string]: unknown;
  };
  /** A pipeline step materialised an image artifact into the blob store. Emitted by every platform-api image handler (source, crop, resize, adjust, sharpen, watermark, upscale, generate, variation, edit-prompt, format-convert, geometric-transform, save) and by the vision handler factory, BEFORE the step's terminal pipeline:step:completed, so the run view can render the thumbnail inline while the step is still running. */
  'pipeline:step:image:produced': {
    runId: string;
    stepId: string;
    imageId: string;
    width: number;
    height: number;
    mimeType: string;
    bbox?: {
      x: number;
      y: number;
      width: number;
      height: number;
      [key: string]: unknown;
    };
    at: string;
    [key: string]: unknown;
  };
  /** Confirmation sent to a client when they successfully join a chat channel. */
  'ws.chat.joined': {
    type: 'chat';
    timestamp?: string;
    action: 'joined';
    channel: string;
    [key: string]: unknown;
  };
  /** Confirmation sent to a client when they leave a chat channel. */
  'ws.chat.left': {
    type: 'chat';
    timestamp?: string;
    action: 'left';
    channel: string;
    [key: string]: unknown;
  };
  /** Broadcast to all channel subscribers when a new chat message is posted. */
  'ws.chat.message': {
    type: 'chat';
    timestamp?: string;
    action: 'message';
    channel: string;
    message: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Confirmation sent to the message sender after their message is stored and broadcast. */
  'ws.chat.sent': {
    type: 'chat';
    timestamp?: string;
    action: 'sent';
    channel: string;
    messageId: string;
    [key: string]: unknown;
  };
  /** Recent message history delivered to a client on channel join or explicit history request. */
  'ws.chat.history': {
    type: 'chat';
    timestamp?: string;
    action: 'history';
    channel: string;
    messages: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Subscription confirmation sent with current cursors for the channel. */
  'ws.cursor.subscribed': {
    type: 'cursor';
    timestamp?: string;
    action: 'subscribed';
    channel: string;
    cursors?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Unsubscription confirmation from cursor channel. */
  'ws.cursor.unsubscribed': {
    type: 'cursor';
    timestamp?: string;
    action: 'unsubscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Broadcast to channel subscribers when a client updates their cursor position. */
  'ws.cursor.update': {
    type: 'cursor';
    timestamp?: string;
    action: 'update';
    channel: string;
    cursor: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Broadcast when a client disconnects and their cursor should be removed from the canvas. */
  'ws.cursor.remove': {
    type: 'cursor';
    timestamp?: string;
    action: 'remove';
    channel: string;
    clientId: string;
    [key: string]: unknown;
  };
  /** Current cursor list for a channel, sent in response to a get request. */
  'ws.cursor.cursors': {
    type: 'cursor';
    timestamp?: string;
    action: 'cursors';
    channel: string;
    cursors?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Supported cursor tracking modes sent to a client on request. */
  'ws.cursor.modes': {
    type: 'cursor';
    timestamp?: string;
    action: 'modes';
    modes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Broadcast to channel subscribers when a client clears (removes) their cursor from the canvas. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO clear action (cursor removal flows through the remove/update verbs) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service. */
  'ws.cursor.clear': {
    type: 'cursor';
    timestamp?: string;
    action: 'clear';
    channel: string;
    clientId: string;
    [key: string]: unknown;
  };
  /** Batched cursor positions for multiple clients delivered in a single frame to reduce message volume. NOTE (2026-06-12 dist re-audit): the realtime-modules dist CursorService the gateway currently runs has NO batch action (it broadcasts per-client cursor:update frames and returns the full list via cursor:subscribed/cursors) — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service. */
  'ws.cursor.batch': {
    type: 'cursor';
    timestamp?: string;
    action: 'batch';
    channel: string;
    cursors: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Subscription confirmation for an activity channel. */
  'ws.activity.subscribed': {
    type: 'activity';
    timestamp?: string;
    action: 'subscribed';
    channelId: string;
    [key: string]: unknown;
  };
  /** Unsubscription confirmation for an activity channel. */
  'ws.activity.unsubscribed': {
    type: 'activity';
    timestamp?: string;
    action: 'unsubscribed';
    channelId: string;
    [key: string]: unknown;
  };
  /** Confirmation sent back to the client that published an activity event. */
  'ws.activity.published': {
    type: 'activity';
    timestamp?: string;
    action: 'published';
    eventType: string;
    [key: string]: unknown;
  };
  /** Recent activity history delivered to a client on request. */
  'ws.activity.history': {
    type: 'activity';
    timestamp?: string;
    action: 'history';
    channelId: string;
    events: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Broadcast to all subscribers of activity:broadcast when an activity event is published. */
  'ws.activity.event': {
    type: 'activity:event';
    timestamp?: string;
    payload: {
      eventType: string;
      detail?: Record<string, unknown>;
      timestamp?: string;
      userId?: string | null;
      displayName?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Subscription confirmation sent when a client joins a CRDT channel. */
  'ws.crdt.subscribed': {
    type: 'crdt';
    timestamp?: string;
    action: 'subscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Unsubscription confirmation sent when a client leaves a CRDT channel. */
  'ws.crdt.unsubscribed': {
    type: 'crdt';
    timestamp?: string;
    action: 'unsubscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Full Y.Doc state (base64 encoded) pushed to a client on channel subscribe or explicit snapshot request. */
  'ws.crdt.snapshot': {
    type: 'crdt:snapshot';
    timestamp?: string;
    channel: string;
    snapshot: string;
    [key: string]: unknown;
  };
  /** Y.js update broadcast to all CRDT channel subscribers, excluding the sender. */
  'ws.crdt.update': {
    type: 'crdt:update';
    timestamp?: string;
    channel: string;
    update: string;
    [key: string]: unknown;
  };
  /** Durable commit receipt for one client update identifier. Initial snapshot sync is not this receipt. */
  'ws.crdt.persisted': {
    type: 'crdt:persisted';
    timestamp?: string;
    channel: string;
    updateId: string;
    [key: string]: unknown;
  };
  /** An update failed authorization or durable persistence; the client retains its pending bytes for an explicit retry or reconnect. */
  'ws.crdt.persistence-error': {
    type: 'crdt:persistence-error';
    timestamp?: string;
    channel: string;
    updateId: string;
    [key: string]: unknown;
  };
  /** Server-coordinated initial canvas seed and metadata are durably stored, or an identical source revision was already seeded. */
  'ws.crdt.seeded': {
    type: 'crdt:seeded';
    timestamp?: string;
    channel: string;
    sourceRevision: string;
    alreadySeeded: boolean;
    requestId?: string;
    [key: string]: unknown;
  };
  /** Broadcast to all CRDT channel subscribers when a snapshot restore replaces the document state. */
  'ws.crdt.doc-replaced': {
    type: 'crdt:doc-replaced';
    timestamp?: string;
    channel: string;
    snapshot?: string;
    [key: string]: unknown;
  };
  /** Client-initiated Y.js state vector sent to the gateway to request missing updates from peers. NOTE (2026-06-12 dist re-audit): not emitted/handled by the realtime-modules dist CRDTService the gateway currently runs (sync flows via crdt:subscribed + the pushed crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat. */
  'ws.crdt.sync-request': {
    type: 'crdt:sync-request';
    timestamp?: string;
    channel: string;
    stateVector: string;
    [key: string]: unknown;
  };
  /** Gateway response to a sync-request containing the Y.js updates needed to bring the client up to date. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs — historical/in-tree-gateway surface, retained for back-compat. */
  'ws.crdt.sync-response': {
    type: 'crdt:sync-response';
    timestamp?: string;
    channel: string;
    update: string;
    [key: string]: unknown;
  };
  /** Broadcast when a Y.Doc state snapshot is durably stored by the gateway. Carries the snapshot ID and byte size so clients can decide whether to fetch the new baseline. NOTE (2026-06-12 dist re-audit): not emitted by the realtime-modules dist CRDTService the gateway currently runs (snapshots are persisted silently; clients re-fetch via getSnapshot → crdt:snapshot) — historical/in-tree-gateway surface, retained for back-compat. */
  'ws.crdt.snapshot-stored': {
    type: 'crdt:snapshot-stored';
    timestamp?: string;
    docId: string;
    snapshotId: string;
    size: number;
    [key: string]: unknown;
  };
  /** Batched Y.js awareness updates (cursor positions, user metadata) forwarded to CRDT channel subscribers in a single frame to reduce overhead. NOTE (2026-06-12 dist re-audit): the realtime-modules dist the gateway currently runs emits awareness as type:"crdt:awareness" with { channel, updates:[{ clientId, update }] } (declared as ws.crdt.awareness in client-frames.ts), NOT this "crdt:awareness-batch" / { clientId, awareness } shape — this declaration is a historical/in-tree-gateway surface, retained for back-compat. */
  'ws.crdt.awareness-batch': {
    type: 'crdt:awareness-batch';
    timestamp?: string;
    docId: string;
    updates: ({
      clientId: number;
      awareness?: Record<string, unknown>;
      [key: string]: unknown;
    })[];
    [key: string]: unknown;
  };
  /** Confirmation sent to a client when their presence status is successfully set. */
  'ws.presence.set': {
    type: 'presence';
    timestamp?: string;
    action: 'set';
    presence?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Broadcast to presence channel subscribers when a client's presence status changes. */
  'ws.presence.update': {
    type: 'presence';
    timestamp?: string;
    action: 'update';
    presence?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Subscription confirmation with current presence snapshot for the channel. */
  'ws.presence.subscribed': {
    type: 'presence';
    timestamp?: string;
    action: 'subscribed';
    channel: string;
    presence?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  /** Unsubscription confirmation from a presence channel. */
  'ws.presence.unsubscribed': {
    type: 'presence';
    timestamp?: string;
    action: 'unsubscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Presence data returned in response to a get-presence request. */
  'ws.presence.data': {
    type: 'presence';
    timestamp?: string;
    action: 'presence';
    data?: unknown;
    [key: string]: unknown;
  };
  /** Broadcast to presence channel subscribers when a client disconnects or times out. */
  'ws.presence.offline': {
    type: 'presence';
    timestamp?: string;
    action: 'offline';
    clientId: string;
    [key: string]: unknown;
  };
  /** Subscription confirmation sent when a client subscribes to reactions in a channel. GROUND TRUTH (gateway dist ReactionService.handleSubscribeToReactions → sendSuccess): { type:"reaction", action:"reaction_subscribed", success:true, data:{ channel, message, availableReactions } } — availableReactions is the emoji-name list. */
  'ws.reaction.subscribed': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_subscribed';
    success?: true;
    data: {
      channel: string;
      message?: string;
      availableReactions?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to all reaction channel subscribers when an emoji reaction is sent. */
  'ws.reaction.received': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_received';
    data: {
      id?: string;
      clientId?: string;
      channel: string;
      emoji: string;
      effect?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to all reaction channel subscribers when a previously sent reaction is removed. GROUND TRUTH (realtime-modules:dist/reactions/ReactionService.js:330, src at src/reactions/ReactionService.ts:403): { type:"reaction", action:"reaction_removed", data:{ channel, targetId, emoji, userId, timestamp } }. The removal is keyed by the durable (targetId, emoji, userId) triple, not by a reaction id — realtime-modules:src/client/useReactions.ts:163 filters on exactly that triple because ids differ between the live broadcast and the stored replay. */
  'ws.reaction.removed': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_removed';
    data: {
      id?: string;
      clientId?: string;
      channel: string;
      emoji?: string;
      targetId?: string;
      userId?: string;
      timestamp?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Current reaction list for a channel, sent in response to a list request. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-list action — historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service. */
  'ws.reaction.list': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_list';
    data: {
      channel: string;
      reactions?: Record<string, unknown>[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Durable reaction replay delivered to one client when it subscribes to a channel. GROUND TRUTH (realtime-modules:src/reactions/ReactionService.ts:473 `_replayStoredReactions` via sendSuccess): { type:"reaction", action:"reaction_history", success:true, data:{ channel, reactions } }. Each row is rehydrated into full Reaction shape by `_fromStored` (:452), whose `id` is DERIVED from the durable key so replaying twice cannot look like two reactions. realtime-modules:src/client/useReactions.ts:143 REPLACES its reaction list with this payload — it is the channel state, not additional events. This is the frame the previously declared ws.reaction.list (action "reaction_list") was mistaken for; no producer uses that action. */
  'ws.reaction.history': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_history';
    success?: true;
    data: {
      channel: string;
      reactions?: ({
        id: string;
        clientId: string;
        channel: string;
        emoji: string;
        effect?: string;
        position?: unknown;
        metadata?: unknown;
        timestamp?: string;
        targetId?: string;
        userId?: string;
        displayName?: string;
        [key: string]: unknown;
      })[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Confirmation sent to the reaction sender after their reaction is broadcast. GROUND TRUTH (gateway dist ReactionService.handleSendReaction → sendSuccess): { type:"reaction", action:"reaction_sent", success:true, data:{ reactionId, emoji, channel, timestamp } }. */
  'ws.reaction.sent': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_sent';
    success?: true;
    data: {
      reactionId: string;
      emoji: string;
      channel: string;
      timestamp?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Call invitation broadcast to target users (or all users when no targets specified). */
  'ws.call.invite': {
    type: 'call';
    timestamp?: string;
    action: 'invite';
    data?: {
      callId?: string;
      lobbyName?: string;
      targetUserIds?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Call accepted signal delivered to the call initiator. */
  'ws.call.accepted': {
    type: 'call';
    timestamp?: string;
    action: 'accepted';
    data?: {
      callId?: string;
      lobbyName?: string;
      targetUserIds?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Call declined signal delivered to the call initiator. */
  'ws.call.declined': {
    type: 'call';
    timestamp?: string;
    action: 'declined';
    data?: {
      callId?: string;
      lobbyName?: string;
      targetUserIds?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Call cancelled signal broadcast to all parties. */
  'ws.call.cancelled': {
    type: 'call';
    timestamp?: string;
    action: 'cancelled';
    data?: {
      callId?: string;
      lobbyName?: string;
      targetUserIds?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Call ended signal broadcast to all parties. */
  'ws.call.ended': {
    type: 'call';
    timestamp?: string;
    action: 'ended';
    data?: {
      callId?: string;
      lobbyName?: string;
      targetUserIds?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to call participants when a participant enables their video feed. */
  'ws.call.video-on': {
    type: 'call';
    timestamp?: string;
    action: 'video-on';
    data: {
      callId: string;
      participantId: string;
      userId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to call participants when a participant disables their video feed. */
  'ws.call.video-off': {
    type: 'call';
    timestamp?: string;
    action: 'video-off';
    data: {
      callId: string;
      participantId: string;
      userId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to all call participants when server-side recording of the session starts. */
  'ws.call.recording-started': {
    type: 'call';
    timestamp?: string;
    action: 'recording-started';
    data: {
      sessionId: string;
      recordingId: string;
      format: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to all call participants when recording ends and a download URL for the recording is available. */
  'ws.call.recording-completed': {
    type: 'call';
    timestamp?: string;
    action: 'recording-completed';
    data: {
      sessionId: string;
      recordingId: string;
      downloadUrl: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Live meta of a document call (title, review documents, presenter, per-person ring state). Sent to the asker after a meta query and to every participant after set-documents / present / set-title / invite / accept / ring expiry. */
  'ws.call.call-meta': {
    type: 'call';
    timestamp?: string;
    action: 'call-meta';
    data: {
      callId: string;
      documentId: string;
      title: string;
      documentIds: string[];
      documentTitles?: Record<string, unknown>;
      hostUserId: string;
      media: 'video' | 'audio';
      startedAt: number;
      presenting: unknown;
      invites: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** A document-call ring to one person expired unanswered (60 s). Sent to the inviter (their row reads "Didn't answer") and to that person (their ring closes); the call itself goes on. */
  'ws.call.invite-expired': {
    type: 'call';
    timestamp?: string;
    action: 'invite-expired';
    data: {
      callId: string;
      userId: string;
      inviteAt?: number;
    };
    [key: string]: unknown;
  };
  /** A participant's camera / mic / screen-share state and display name, relayed to the rest of the call. */
  'ws.call.participant-state': {
    type: 'call';
    timestamp?: string;
    action: 'participant-state';
    data?: {
      callId?: string;
      callerId?: string;
      userId?: string;
      participantId?: string;
      displayName?: string;
      cameraOn?: boolean;
      audioOn?: boolean;
      screenSharing?: boolean;
      status?: 'in-call' | 'left' | 'on-hold' | 'reconnecting';
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** A participant is in the call, on hold, reconnecting (socket dropped, inside the rejoin grace) or has left. */
  'ws.call.user-status': {
    type: 'call';
    timestamp?: string;
    action: 'user-status';
    data: {
      callId: string;
      userId?: string | null;
      status: 'in-call' | 'left' | 'on-hold' | 'reconnecting';
      reason?: string;
      rejoinGraceMs?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** The host muted this participant. Sent to every connection of the target only; their client mutes and its participant-state tells the others. */
  'ws.call.mute-participant': {
    type: 'call';
    timestamp?: string;
    action: 'mute-participant';
    data: {
      callId: string;
      userId: string;
      by: string;
    };
    [key: string]: unknown;
  };
  /** The host removed this participant from the call. Sent to every connection of the target only; the rest of the call gets user-status left with reason "removed" and call-meta. Only a new invite lets them back in. */
  'ws.call.remove-participant': {
    type: 'call';
    timestamp?: string;
    action: 'remove-participant';
    data: {
      callId: string;
      userId: string;
      by: string;
    };
    [key: string]: unknown;
  };
  /** The whole meeting state, sent to the subscribing connection only in reply to client.meeting.subscribe. `you` says who the server thinks you are and whether you are an organizer. Overwrite local state with it. */
  'ws.meeting.meeting.snapshot': {
    type: 'meeting';
    timestamp: string;
    action: 'meeting.snapshot';
    meetingId: string;
    data: {
      meetingId: string;
      createdBy: string | null;
      version: number;
      hands: ({
        userId: string;
        displayName: string;
        raisedAt: string;
        [key: string]: unknown;
      })[];
      breakout: {
        phase: 'none' | 'draft' | 'open';
        mode: 'assigned' | 'self-select';
        rooms: ({
          id: string;
          name: string;
          state: 'open' | 'closed';
          members: string[];
          [key: string]: unknown;
        })[];
        returned: string[];
        endsAt: string | null;
        closing?: boolean;
        announcement: unknown | null;
        settings: {
          allowReturnToMain: boolean;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
      updatedAt: string;
      you: {
        userId: string | null;
        organizer: boolean;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** The raised-hand queue changed (raise, lower, lower all, or a user's last connection leaving). Broadcast to every subscriber; carries the whole queue. */
  'ws.meeting.hands.changed': {
    type: 'meeting';
    timestamp: string;
    action: 'hands.changed';
    meetingId: string;
    data: {
      version: number;
      hands: ({
        userId: string;
        displayName: string;
        raisedAt: string;
        [key: string]: unknown;
      })[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** The breakout session changed (any breakout verb, the timer or closing grace running out, or a write from another replica). Broadcast to every subscriber; carries the whole breakout state. */
  'ws.meeting.breakout.changed': {
    type: 'meeting';
    timestamp: string;
    action: 'breakout.changed';
    meetingId: string;
    data: {
      version: number;
      breakout: {
        phase: 'none' | 'draft' | 'open';
        mode: 'assigned' | 'self-select';
        rooms: ({
          id: string;
          name: string;
          state: 'open' | 'closed';
          members: string[];
          [key: string]: unknown;
        })[];
        returned: string[];
        endsAt: string | null;
        closing?: boolean;
        announcement: unknown | null;
        settings: {
          allowReturnToMain: boolean;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** An organizer broadcast an announcement to every room (client.meeting.breakout.broadcast). Broadcast to every subscriber right after the ws.meeting.breakout.changed that stores it. */
  'ws.meeting.breakout.announcement': {
    type: 'meeting';
    timestamp: string;
    action: 'breakout.announcement';
    meetingId: string;
    data: {
      message: string;
      fromUserId: string;
      fromDisplayName: string;
      at: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Acknowledges client.meeting.unsubscribe, to the sending connection only. Clear local meeting state. */
  'ws.meeting.meeting.unsubscribed': {
    type: 'meeting';
    timestamp: string;
    action: 'meeting.unsubscribed';
    meetingId: string;
    data: Record<string, never>;
    [key: string]: unknown;
  };
  /** A meeting verb was refused. Sent to the sending connection only; nothing changed. INVALID_ACTION unknown verb; INVALID_PAYLOAD bad meetingId or field; UNAUTHENTICATED no signed-in user; FORBIDDEN channel guard refused, organizer-only verb, wrong room or return to main not allowed; NOT_SUBSCRIBED subscribe first; NOT_FOUND unknown meeting or room; CONFLICT state does not allow it (or the write lost a race). */
  'ws.meeting.error': {
    type: 'meeting';
    timestamp: string;
    action: 'error';
    meetingId: string | null;
    error: {
      code: 'INVALID_ACTION' | 'INVALID_PAYLOAD' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_SUBSCRIBED' | 'NOT_FOUND' | 'CONFLICT';
      message: string;
      requestAction: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Acknowledgement sent when the gateway receives a file upload request from a client. */
  'ws.upload.requested': {
    type: 'upload';
    timestamp?: string;
    action: 'requested';
    data: {
      clientId: string;
      channel: string;
      filename: string;
      size?: number;
      mimeType?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Presigned S3 upload URL issued to the client so they can PUT the file directly. */
  'ws.upload.url-issued': {
    type: 'upload';
    timestamp?: string;
    action: 'url-issued';
    data: {
      uploadId: string;
      presignedUrl: string;
      expiresAt: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast to the channel when a file upload completes and a download URL is available. */
  'ws.upload.completed': {
    type: 'upload';
    timestamp?: string;
    action: 'completed';
    data: {
      uploadId: string;
      downloadUrl: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Sent to the uploading client when the file upload fails at any stage. */
  'ws.upload.failed': {
    type: 'upload';
    timestamp?: string;
    action: 'failed';
    data: {
      uploadId: string;
      error: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Sent to the channel after a security scan completes on the uploaded file, reporting clean or infected status. */
  'ws.upload.scanned': {
    type: 'upload';
    timestamp?: string;
    action: 'scanned';
    data: {
      uploadId: string;
      status: 'clean' | 'infected';
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Sent to the uploading client when a security scan detects a threat. The file is quarantined and the download URL is revoked. */
  'ws.upload.scan-quarantined': {
    type: 'upload';
    timestamp?: string;
    action: 'scan-quarantined';
    data: {
      uploadId: string;
      reason: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Sent to the uploading client when a presigned download URL is explicitly revoked. Clients should discard any cached URL. */
  'ws.upload.url-revoked': {
    type: 'upload';
    timestamp?: string;
    action: 'url-revoked';
    data: {
      uploadId: string;
      reason: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Subscription confirmation sent when a client subscribes to a pipeline channel. */
  'ws.pipeline.subscribed': {
    type: 'pipeline';
    timestamp?: string;
    action: 'subscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Unsubscription confirmation from a pipeline channel. */
  'ws.pipeline.unsubscribed': {
    type: 'pipeline';
    timestamp?: string;
    action: 'unsubscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Acknowledgement frame for client-initiated pipeline commands (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint). */
  'ws.pipeline.ack': {
    type: 'pipeline:ack';
    timestamp?: string;
    action: string;
    runId?: string;
    correlationId?: unknown;
    [key: string]: unknown;
  };
  /** Current pipeline run state sent in response to a getRun request. */
  'ws.pipeline.snapshot': {
    type: 'pipeline:snapshot';
    timestamp?: string;
    runId: string;
    run?: unknown | null;
    correlationId?: unknown;
    [key: string]: unknown;
  };
  /** BusEvent history for a pipeline run sent in response to a getHistory request. */
  'ws.pipeline.history': {
    type: 'pipeline:history';
    timestamp?: string;
    runId: string;
    fromVersion?: number;
    events: Record<string, unknown>[];
    correlationId?: unknown;
    [key: string]: unknown;
  };
  /** Pipeline BusEvent fan-out frame delivered to channel subscribers (pipeline:run:{runId}, pipeline:all, pipeline:approvals). */
  'ws.pipeline.event': {
    type: 'pipeline:event';
    timestamp?: string;
    eventType: string;
    payload?: Record<string, unknown>;
    channel: string;
    seq?: number;
    sourceNodeId?: string;
    emittedAt?: number;
    [key: string]: unknown;
  };
  /** Generic error frame sent to a client when any gateway service encounters a client-visible error. GROUND TRUTH (gateway dist): chat/reaction/cursor/crdt nest under error:{ code, message, service, clientId, timestamp }; presence/activity send a flat top-level message. `service` names the originating service in both shapes. */
  'ws.error': {
    type: 'error';
    timestamp?: string;
    service?: string;
    code?: string;
    message?: string;
    error?: {
      code: string;
      message: string;
      service?: string;
      clientId?: string;
      timestamp?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Session welcome frame, sent once immediately after the WebSocket upgrade completes and before the client may send anything (src/server.ts:2507). It is load-bearing protocol, not a courtesy: the gateway queues every other outbound frame until this one has gone out (core/pre-session-queue.ts), and the client cannot reconnect without the `sessionToken` or feature-gate without `enabledServices`. `restored` tells the client whether its prior subscriptions came back with it — false both for a genuinely new connection and for a presented token the gateway could not restore, including the fallback path where a subscription restore failed and the connection was re-minted under a fresh clientId (server.ts:2399). */
  'ws.session.connected': {
    type: 'session';
    timestamp?: string;
    status: 'connected';
    clientId: string;
    sessionToken: string;
    restored: boolean;
    nodeId: string;
    enabledServices: string[];
    [key: string]: unknown;
  };
  /** Acknowledges that a client's generic-multiplexer subscribe took effect (realtime-fanout/subscribe-service.ts:191). Its ABSENCE is meaningful and is the reason this needed declaring: the handler returns early without an ack on either authz denial (the interceptor has already sent AUTHZ_CHANNEL_DENIED) or an unknown client, so a client that treats "no ack" as "probably fine" will believe it is subscribed to a channel the gateway refused it. Wait for this frame before assuming delivery. */
  'ws.subscribe.subscribed': {
    type: 'subscribe';
    action: 'subscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** Acknowledges that a client's generic-multiplexer unsubscribe was applied (realtime-fanout/subscribe-service.ts:206). Unlike the subscribe ack this one is unconditional: leaving a channel has no authz gate and the router no-ops for a channel the client was not on, so the frame is idempotent and always sent. */
  'ws.subscribe.unsubscribed': {
    type: 'subscribe';
    action: 'unsubscribed';
    channel: string;
    [key: string]: unknown;
  };
  /** A user-initiated activity-feed entry. Durable for analytics, replay and pipeline triggering (platform-api drains it into the user-activity table); signal for the live activity feed. Anonymous entries (userId null) are dropped by the DDB writer but still fire pipeline triggers. */
  'activity.recorded': {
    eventType: string;
    detail: Record<string, unknown>;
    timestamp: string;
    userId: string | null;
    displayName: string;
    [key: string]: unknown;
  };
  /** An in-call emoji reaction, captured durably for playback, retro and transcript injection. Identity is stamped server-side at send time and is never trusted from the client frame. Drained by platform-api into the call-reactions table, keyed `<at>#<reactionId>`. */
  'call:reaction.recorded': {
    reactionId: string;
    channel: string;
    lobbyName: string;
    userId: string | null;
    displayName?: string;
    emoji: string;
    effect?: string;
    at: string;
    [key: string]: unknown;
  };
  /** A WebRTC transport session has been established for a participant on a channel. Emitted once per participant per session join (api/channels/index.js:412). */
  'sfu.session.created': {
    channelArn: string;
    sessionId: string;
    participantId: string;
  };
  /** A WebRTC transport session has closed — the transport observer fired "close". Carries the whole session lifetime (api/channels/index.js:434). */
  'sfu.session.ended': {
    channelArn: string;
    sessionId: string;
    participantId: string;
    durationMs: number;
  };
  /** A producer (one audio or video track) was added on a channel — the first track of a live stream going online. Emitted from api/channels/transports.js:137 and api/channels/index.js:641. */
  'sfu.stream.started': {
    channelArn: string;
    participantId?: string;
    kind: 'audio' | 'video';
    producerId: string;
  };
  /** A producer track was removed — the transport observer fired "close" on the live transport. Emitted from api/channels/transports.js:142 and api/channels/index.js:644. */
  'sfu.stream.ended': {
    channelArn: string;
    participantId?: string;
    kind: 'audio' | 'video';
    producerId: string;
  };
  /** Stream health metrics fell below their thresholds — bitrate drop, low fps, or an over-long keyframe gap. `reasons` enumerates every predicate that tripped (services/streamHealthMonitor.js:99). */
  'sfu.stream.health.degraded': {
    channelArn: string;
    reasons: string[];
    bitrateBps: number;
    fps: number | null;
    keyframeGapSec: number | null;
  };
  /** Stream health returned to nominal after a previous degraded state (services/streamHealthMonitor.js:111). */
  'sfu.stream.health.recovered': {
    channelArn: string;
    bitrateBps: number;
    fps: number | null;
  };
  /** A new thumbnail snapshot was written to storage for a live channel (thumbnails/ThumbnailManager.js:266). */
  'sfu.stream.thumbnail.updated': {
    channelArn: string;
    path: string;
    sizeBytes: number;
  };
  /** A recording session opened on a live stream. Emitted from both the single-file path (recording/RecordingManager.js:943) and the per-peer path (:2426); only the latter carries `legCount`. */
  'sfu.recording.started': {
    channelArn: string;
    recordingId: string;
    startedAt: string;
    destination: string;
    legCount?: number;
  };
  /** A recording session finalized. Carries the segment manifest, the per-participant track manifest, total encoded size, duration, and the recording profile the run began under. Drained by platform-api's lvsWebhooks route into video-call-recordings (recording/RecordingManager.js:1756). TWO declared properties are never actually emitted — `composedUrl` and `tracks[].userId`; both are read by platform-api and both come back undefined. See their entries in the field glossary in ../sfu.ts. The mirror defect also exists and is NOT fixable from here: routes/lvsWebhooks.ts reads `startedAt`, `endedAt` and `totalBytes` off this payload, none of which is declared or sent — and since this schema is additionalProperties:false, they could not arrive even if LVS started sending them. */
  'sfu.recording.completed': {
    channelArn: string;
    recordingId: string;
    segments: ({
      key: string;
      url: string;
      size: number;
    })[];
    totalSize: number;
    durationMs: number;
    destination: string;
    thumbnailUrl?: string;
    composedUrl?: string;
    tracks?: ({
      participantId: string;
      userId?: string;
      key?: string | null;
      url?: string | null;
      size?: number;
      kind: string;
      [key: string]: unknown;
    })[];
    recordingProfile: string;
    profileVersion: number;
    composePerPeer: boolean;
    transcribe: boolean;
  };
  /** A new IVS-style channel was created via POST /api/channels (api/channels/index.js:1375). */
  'sfu.channel.created': {
    channelArn: string;
    name: string;
    type: string;
  };
  /** A configuration field on an existing channel was mutated. `field` names which one (api/channels/index.js:1877, :1907). */
  'sfu.channel.updated': {
    channelArn: string;
    field: string;
  };
  /** A channel was hard-deleted via DELETE /api/channels/:arn. The wire `data` is empty; the envelope's channelArn identifies the removed channel (api/channels/index.js:2014). */
  'sfu.channel.deleted': {
    channelArn: string;
  };
  /** A mediasoup Producer was created on the cluster. Emitted from the create-producer API path (api/channels/index.js:617), which stamps identity and initial state, and from the transport produce path (api/channels/transports.js:110), which does not. */
  'sfu.producer.added': {
    channelArn: string;
    producerId: string;
    kind: 'audio' | 'video';
    participantId?: string;
    displayName?: string;
    userId?: string;
    isPiped: boolean;
    state?: {
      muted: boolean;
      [key: string]: unknown;
    };
  };
  /** A mediasoup Producer was closed — the underlying transport observer fired "close". Emitted from api/channels/index.js:624 and api/channels/transports.js:115. */
  'sfu.producer.removed': {
    channelArn: string;
    producerId: string;
    kind: 'audio' | 'video';
    participantId?: string;
  };
  /** Recording started or stopped for a channel. Pushed onto the per-channel stream-events bus so stage-WS subscribers can drop their GET /:arn/recording poll. Emitted from recording/RecordingManager.js via _emitStateChange (:501) on start (:948), per-peer start (:2433), stop (:1837) and zero-track prune (:1644). */
  'sfu.recording.state.changed': {
    channelArn: string;
    isRecording: boolean;
    recordingId?: string;
    startedAt?: string;
    pruned?: boolean;
    reason?: string;
  };
  /** A producer's runtime state was mutated through PATCH /api/channels/:arn/producers/:producerId/state — force-mute and self-mute both land here. Emitted only when the patch actually changed a field; an idempotent no-op patch takes the else branch and emits nothing (api/channels/producerState.js:214). The wire type is the short form `producer.state-changed`. */
  'sfu.producer.state-changed': {
    channelArn: string;
    producerId: string;
    participantId: string;
    kind: string | null;
    state: {
      muted: boolean;
      [key: string]: unknown;
    };
  };
  /** A participant was forcibly disconnected from a channel. Two emit sites, distinguished by `source`: the ops endpoint DELETE /api/admin/channels/:arn/sessions/:transportId (api/admin/disconnect-session.js:100) and the cluster denylist watcher, which fires only once it has actually closed at least one local transport (workers/denyListWatcher.js:100). Clients that receive this event carrying their OWN participantId should treat it as terminal. */
  'sfu.participant.disconnected': {
    channelArn: string;
    participantId: string;
    reason: string;
    source: 'admin-disconnect' | 'denylist';
    transportId?: string;
  };
  /** Server-arbitrated cross-tab ownership was assigned for a member on a channel. The first stage-WS tab to claim the per-member Redis lock becomes the owner; sibling tabs of the same member become silent observers and learn of the assignment from this frame (ws/stageWsServer.js:476). Emitted only for Wave-5+ tokens — a legacy JWT with no `mid` claim never triggers it, which keeps the per-channel eventId sequence stable for older replay-buffer consumers. */
  'sfu.member.owner.changed': {
    channelArn: string;
    memberId: string;
    userId?: string;
    ownerClientId: string | null;
    participantId: string | null;
  };
  /** A custom, application-defined chat event was published into a channel's live event stream via POST /api/channels/:arn/chat/events — the IVS Chat `SendEvent` equivalent (api/channels/chat-events.js:184). Rides the stream-events hub, not the chat-bus, so unlike the sfu.chat.* frames it carries channelArn and is fanned out to stage-WS subscribers and other pods rather than to IVS chat clients. */
  'sfu.chat.event': {
    channelArn: string;
    eventName: string;
    attributes: Record<string, unknown>;
    publishedAt: string;
  };
  /** A participant is confirmed gone from a channel. Bridged from RoomManager's in-process `participantLeft` EventEmitter onto the stream-events hub at app.js:548 (added 2026-08-22), which is what makes it cross-service: before that bridge a clean leave (WHIP DELETE, admin disconnect, leaveRoom) never left the process and peers' tiles lingered for the full client-side orphan grace. NOT a raw mirror of the emitter — the bridge filters, so this is the DEPARTURE signal rather than the removal signal. Sub-identities ending in `:screen` are dropped entirely (a sharer stopping a screen share is not a departure; subscribers tear that down from `producer.removed`), and a real id is debounced for 1.5s and emitted only if the participant is STILL absent from the room when the timer fires — so camera-off, which unpublishes and immediately republishes audio-only, produces nothing. Consumers treat it as terminal for the participant: lvs-client tears down every subscriber for the id and its `:screen` sibling (packages/lvs-client/src/client.js:1013), and stage-WS suppresses a client's echo of its own departure (ws/stageWsServer.js:207). */
  'sfu.participant.left': {
    channelArn: string;
    participantId: string;
  };
  /** A finalized multi-leg recording was accepted for background composition, before the ffmpeg job starts. Emitted from the tail of finalizeRecording (recording/RecordingManager.js:1662) so a client can show a "Composing…" badge immediately; it is often the FIRST signal the recordings list gets that the row exists at all. Only the per-peer path reaches it — a single-file recording has no legs to compose. */
  'sfu.recording.compose.queued': {
    channelArn: string;
    recordingId: string;
    legCount: number;
    durationMs: number;
    recordingStartedAt: string;
  };
  /** The background compose job for a recording began. Emitted on the first line of runComposeJob (recording/RecordingManager.js:3754), before input triage and before ffmpeg is spawned, so it is unconditional for every attempt including the resume sweeper's. */
  'sfu.recording.compose.started': {
    channelArn: string;
    recordingId: string;
    jobId?: string;
  };
  /** The running compose job crossed a 10% progress bucket. Derived from ffmpeg's `time=` stderr line and deliberately throttled to one event per bucket (recording/RecordingManager.js:3965), which keeps bus traffic linear in recording count rather than in frame count. A short compose may emit this zero times; it never reports 100 — completion is what `sfu.recording.compose.completed` is for. */
  'sfu.recording.compose.progress': {
    channelArn: string;
    recordingId: string;
    jobId?: string;
    progressPct: number;
  };
  /** The compose job failed and produced no usable output. Two emit sites carry DIFFERENT diagnostic fields: the windowed pre-pass failure (recording/RecordingManager.js:3897) sets `stage`, and the ffmpeg non-zero-exit / missing-output path (:4011) sets `exitCode`. A consumer must branch on which one is present rather than assume either; `reason` is the only human-readable field common to both. */
  'sfu.recording.compose.failed': {
    channelArn: string;
    recordingId: string;
    jobId?: string;
    wallMs: number;
    reason: string;
    stage?: string;
    exitCode?: number;
  };
  /** The compose job finished and its composed render was uploaded and persisted (recording/RecordingManager.js:4093). This — not the `sfu.recording.completed` webhook — is the event that says a composed playback file exists, because compose runs after that webhook has already fired. `composeStatus` distinguishes a clean render from one ffmpeg exited zero on but that came out materially shorter than planned. */
  'sfu.recording.compose.completed': {
    channelArn: string;
    recordingId: string;
    jobId?: string;
    wallMs: number;
    composeStatus: 'ok' | 'degraded';
    composedSegment: {
      key: string;
      url: string;
      size: number;
      legCount: number;
      composedAt: string;
    };
    outputProbedDurationMs: number | null;
  };
  /** A chat message was sent by a participant, in IVS Chat wire-protocol shape. Persisted to the per-channel history list before fan-out; republished cross-pod on chat-bus so other pods can broadcast it to their local sockets (chat/ChatHub.js:206). */
  'sfu.chat.message': {
    Type: 'MESSAGE';
    Id: string;
    RequestId?: string;
    Sender: {
      UserId: string;
      Attributes: Record<string, unknown>;
      [key: string]: unknown;
    };
    Content: string;
    Attributes: Record<string, unknown>;
    SendTime: string;
    [key: string]: unknown;
  };
  /** A previously sent chat message was deleted by a moderator, in IVS Chat wire-protocol shape (chat/ChatHub.js:226). */
  'sfu.chat.message_deleted': {
    Type: 'MESSAGE_DELETED';
    Id: string;
    Reason: string;
    DeleteTime: string;
    [key: string]: unknown;
  };
  /** A user was forcibly disconnected from a chat channel by a moderator, in IVS Chat wire-protocol shape. Subscribing pods close any local sockets held by the named user (producer chat/ChatHub.js:238; the cross-pod consumer is chat/ChatHub.js:137). */
  'sfu.chat.user_disconnected': {
    Type: 'USER_DISCONNECTED';
    UserId: string;
    Reason: string;
    DisconnectTime: string;
    [key: string]: unknown;
  };
  /** A user was banned from chat on a channel — internal cross-pod propagation, NOT part of the IVS Chat wire protocol, so the keys are lowercase and no client ever sees it (api/channels/chatBans.js:42). */
  'sfu.chat.user.banned': {
    type: 'user.banned';
    userId: string;
    reason: string;
    durationSeconds: number | null;
  };
  /** A previously banned user was unbanned — internal cross-pod propagation, lowercase keys, no client visibility (api/channels/chatBans.js:90). */
  'sfu.chat.user.unbanned': {
    type: 'user.unbanned';
    userId: string;
  };
  /** Client request to join a chat channel and start receiving its messages. Sent by GatewaySocketProvider on connect when the chat feature is declared. GROUND TRUTH (hub#1497): the gateway ChatService verb is "join" — the previously declared "subscribe" was never accepted. channel is required; on success the gateway replies chat/joined and auto-pushes recent channel history. */
  'client.chat.join': {
    service: 'chat';
    action: 'join';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to leave a chat channel and stop receiving its messages. Sent by useChat cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ChatService.handleLeaveChannel requires channel ("Channel name is required") and replies with a chat/left action frame; in distributed mode it also drops the message-router channel subscription. */
  'client.chat.leave': {
    service: 'chat';
    action: 'leave';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to post a text chat message to a channel (useChat.sendMessage). The gateway ChatService requires a prior join on the channel ("You must join the channel before sending messages"). metadata is optional and size-validated server-side. */
  'client.chat.send': {
    service: 'chat';
    action: 'send';
    channel: string;
    message: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client signal that the person is typing in a channel (useChat.setTyping). `typing: true` while composing, re-sent at most every few seconds; `typing: false` when they stop or send. The gateway ChatService relays it to the channel as {type:"chat", action:"typing", channel, userId, displayName, typing} to everyone but the sender; never persisted, never in history. Requires a prior join. */
  'client.chat.typing': {
    service: 'chat';
    action: 'typing';
    channel: string;
    typing: boolean;
    [key: string]: unknown;
  };
  /** Client request for a chat channel's membership (useChatMembers). The gateway ChatService replies to the sender with {type:"chat", action:"members", channel, open, members:[{userId, role, addedBy, addedAt, historyFrom}]}. `open` is true when the channel has no membership rows (everyone the gateway admits is in it); a dm channel reports the ids in its name. */
  'client.chat.members': {
    service: 'chat';
    action: 'members';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to add people to a chat channel (useChatMembers.addMembers). The requester must be a member, or the channel open — then they become its owner and the channel closes. `history` decides each added person's history floor: none (from now), days (the last N days), all. The ChatService writes the rows, posts a stored message from the requester with metadata.kind "membership" (event "added"), and broadcasts {type:"chat", action:"membersUpdated", channel, open, members} to the channel. Errors carry code not-a-member | forbidden | bad-request. */
  'client.chat.addMembers': {
    service: 'chat';
    action: 'addMembers';
    channel: string;
    userIds: string[];
    history: {
      mode: 'none' | 'days' | 'all';
      days?: number;
    };
    names?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to remove a person from a chat channel (useChatMembers.removeMember). An owner may remove anyone; anyone may remove themselves. The ChatService marks the row removed, posts a membership message (event "removed"), and broadcasts membersUpdated. A removed person can no longer join, send or read the channel. */
  'client.chat.removeMember': {
    service: 'chat';
    action: 'removeMember';
    channel: string;
    userId: string;
    name?: string;
    [key: string]: unknown;
  };
  /** Client request to edit one of the sender's own chat messages (useChat.editMessage). The gateway ChatService updates the stored record in place (message text, optional metadata merge, editedAt) and broadcasts {type:"chat", action:"messageUpdated", channel, message:<the updated record>, timestamp} to every subscriber. Only the author may edit; errors carry code forbidden | not-found | gone (already deleted) | bad-request (empty text). */
  'client.chat.edit': {
    service: 'chat';
    action: 'edit';
    channel: string;
    messageId: string;
    message: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to delete one of the sender's own chat messages (useChat.deleteMessage). A soft delete: the record keeps its id, channel, author and timestamp; its text becomes empty, its metadata {deleted:true}, and deletedAt is set. The ChatService broadcasts {type:"chat", action:"messageDeleted", channel, messageId, deletedAt, timestamp}. Only the author may delete; errors carry code forbidden | not-found. */
  'client.chat.delete': {
    service: 'chat';
    action: 'delete';
    channel: string;
    messageId: string;
    [key: string]: unknown;
  };
  /** Client request for recent chat message history for a channel (useChat.loadHistory). limit is optional — the gateway ChatService falls back to its configured default history limit when omitted (hub#1497 re-audit: limit was wrongly declared required). */
  'client.chat.history': {
    service: 'chat';
    action: 'history';
    channel: string;
    limit?: number;
    [key: string]: unknown;
  };
  /** Client request to receive presence events for a channel. Sent by usePresence on mount and by GatewaySocketProvider on connect when the presence feature is declared. GROUND TRUTH (hub#1497): the gateway PresenceService rejects the frame without channel ("Channel is required") — channel is REQUIRED, not optional as previously declared. */
  'client.presence.subscribe': {
    service: 'presence';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to stop receiving presence events for a channel (usePresence cleanup). */
  'client.presence.unsubscribe': {
    service: 'presence';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to set its presence entry (usePresence setStatus / updateMetadata). GROUND TRUTH (hub#1497): the gateway PresenceService requires status ("Status is required") and reads only { status, metadata, channels } — the channel field is sent by the hook but IGNORED by the service (presence pinning uses the channels array). Previously declared with channel required + status optional; both were wrong. */
  'client.presence.set': {
    service: 'presence';
    action: 'set';
    channel?: string;
    status: string;
    metadata?: Record<string, unknown>;
    channels?: string[];
    [key: string]: unknown;
  };
  /** Client request to read presence data for a single client (targetClientId) or a whole channel (channel). GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleGetPresence requires AT LEAST ONE of targetClientId or channel ("Either targetClientId or channel is required" — an either-or constraint JSON-schema-encodable only via anyOf, which the type generator does not support, so both fields are declared optional here). targetClientId wins when both are present; unknown targetClientId yields "Client not found". Replies with a presence/presence action frame carrying the data. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client. */
  'client.presence.get': {
    service: 'presence';
    action: 'get';
    channel?: string;
    targetClientId?: string;
    [key: string]: unknown;
  };
  /** Client keep-alive that refreshes lastSeen/lastHeartbeat on its existing presence entry so the stale-presence sweep does not reap it. GROUND TRUTH (v0.3.57 backfill): gateway PresenceService.handleHeartbeat reads NO payload fields beyond service/action (data is ignored) and sends no reply; it is a silent no-op when the client has no presence entry (set first). PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 — declared as the gateway-verified verb for any WS client. */
  'client.presence.heartbeat': {
    service: 'presence';
    action: 'heartbeat';
    channel?: string;
    [key: string]: unknown;
  };
  /** Client request to receive emoji reactions for a channel. Sent by useReactions on mount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleSubscribeToReactions requires channel ("Channel name is required", length-validated 1..maxChannelNameLength) and runs the consumer authz hook; on success it replies with a reaction/reaction_subscribed success frame whose data includes the availableReactions emoji list. */
  'client.reaction.subscribe': {
    service: 'reaction';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to stop receiving emoji reactions for a channel. Sent by useReactions cleanup on channel change/unmount as of realtime-modules 0.14.0. GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleUnsubscribeFromReactions requires channel ("Channel name is required") and replies with a reaction/reaction_unsubscribed success frame. */
  'client.reaction.unsubscribe': {
    service: 'reaction';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to send an emoji reaction to a channel (useReactions.react). GROUND TRUTH (hub#1497): the gateway ReactionService verb is "send" — the previously declared "react" was never accepted. emoji must be in the gateway's available-reactions catalog; position is optional overlay placement; metadata passes through. NOTE: targetId is sent by useReactions for entity-scoped reactions but the current gateway ReactionService does NOT forward it to subscribers. */
  'client.reaction.send': {
    service: 'reaction';
    action: 'send';
    channel: string;
    emoji: string;
    position?: Record<string, unknown>;
    targetId?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request for the gateway's available-reactions catalog (emoji → effect map). GROUND TRUTH (v0.3.57 backfill): gateway ReactionService.handleGetAvailableReactions reads NO payload fields beyond service/action (channel is ignored) and replies with a reaction/available_reactions success frame carrying the full reactions catalog. PRODUCER NOTE: no realtime-modules hook sends this frame as of 0.14.0 (subscribers get the emoji list in the reaction_subscribed reply instead) — declared as the gateway-verified verb for any WS client. */
  'client.reaction.getAvailable': {
    service: 'reaction';
    action: 'getAvailable';
    channel?: string;
    [key: string]: unknown;
  };
  /** Client request to subscribe to the activity feed for a channel (useActivity mount). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. No history is auto-pushed on subscribe; clients request it explicitly via client.activity.getHistory. */
  'client.activity.subscribe': {
    service: 'activity';
    action: 'subscribe';
    channel?: string;
    channelId: string;
    [key: string]: unknown;
  };
  /** Client request to unsubscribe from the activity feed for a channel (useActivity cleanup). GROUND TRUTH (hub#1497): the gateway ActivityService requires channelId — the previously declared channel field was never read. */
  'client.activity.unsubscribe': {
    service: 'activity';
    action: 'unsubscribe';
    channel?: string;
    channelId: string;
    [key: string]: unknown;
  };
  /** Client request for prior activity events for a channel (useActivity.loadHistory). GROUND TRUTH (hub#1497): the gateway verb is "getHistory" — the previously declared "history" action was rejected ("Unknown activity action"). Keys on channelId; limit is optional (server clamps to 1..maxHistoryItems, default 50). */
  'client.activity.getHistory': {
    service: 'activity';
    action: 'getHistory';
    channel?: string;
    channelId: string;
    limit?: number;
    [key: string]: unknown;
  };
  /** Client request to subscribe to a CRDT document channel (useCRDT/useYjsDoc). Gateway replies with crdt:subscribed and pushes the latest crdt:snapshot when one exists. */
  'client.crdt.subscribe': {
    service: 'crdt';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client request to unsubscribe from a CRDT document channel (useCRDT/useYjsDoc cleanup). */
  'client.crdt.unsubscribe': {
    service: 'crdt';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Client broadcast of a local Y.js document update, base64-encoded (GatewayProvider update handler / useCRDT.applyLocalEdit). */
  'client.crdt.update': {
    service: 'crdt';
    action: 'update';
    channel: string;
    update: string;
    updateId?: string;
    [key: string]: unknown;
  };
  /** Idempotent schema-version-2 binary canvas bootstrap under source-revision authority. Does not replace existing documents. */
  'client.crdt.seed-document': {
    service: 'crdt';
    action: 'seedDocument';
    channel: string;
    snapshot: string;
    sourceRevision: string;
    title?: string;
    type?: string;
    requestId?: string;
    [key: string]: unknown;
  };
  /** Client broadcast of local Y.js awareness state, base64-encoded and debounced (GatewayProvider). `mode` and `idle` are lifted out of awareness local state as top-level fields so the gateway DocumentPresenceService can update without decoding the Y.js binary. */
  'client.crdt.awareness': {
    service: 'crdt';
    action: 'awareness';
    channel: string;
    update: string;
    mode?: 'editor' | 'reviewer' | 'reader';
    idle?: boolean;
    [key: string]: unknown;
  };
  /** Client request for a presigned upload URL (useFileUpload.upload step 1). `id` is a client-generated upload identifier echoed back on all subsequent fileupload:* frames. */
  'client.fileupload.request-upload': {
    service: 'fileupload';
    action: 'request-upload';
    channel: string;
    id: string;
    filename: string;
    size: number;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client notification that the presigned-URL PUT finished (useFileUpload.upload step 4). Gateway replies with fileupload:complete / fileupload:scanning depending on scan policy. */
  'client.fileupload.complete': {
    service: 'fileupload';
    action: 'complete';
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Client request to cancel an in-flight upload (useFileUpload.cancel). Gateway acknowledges with fileupload:cancelled. */
  'client.fileupload.cancel': {
    service: 'fileupload';
    action: 'cancel';
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Client request to start a video hangout/call session on a channel (useVideoHangout.start). Gateway replies with videohangout:created. */
  'client.videohangout.start': {
    service: 'videohangout';
    action: 'start';
    channel: string;
    type?: 'hangout' | 'call';
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Client request to join an existing hangout session (useVideoHangout.join). Gateway replies with videohangout:joined. */
  'client.videohangout.join': {
    service: 'videohangout';
    action: 'join';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client notification that it is leaving the hangout session (useVideoHangout.leave). */
  'client.videohangout.leave': {
    service: 'videohangout';
    action: 'leave';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client (host) request to end the hangout session for all participants (useVideoHangout.end). */
  'client.videohangout.end': {
    service: 'videohangout';
    action: 'end';
    channel: string;
    sessionId: string;
    [key: string]: unknown;
  };
  /** Client notification that it toggled its video feed on/off (useVideoHangout.toggleVideo). Gateway fans out videohangout:media. */
  'client.videohangout.toggle-video': {
    service: 'videohangout';
    action: 'toggle-video';
    channel: string;
    sessionId: string;
    videoOn: boolean;
    [key: string]: unknown;
  };
  /** Client notification that it toggled its audio feed on/off (useVideoHangout.toggleAudio). Gateway fans out videohangout:media. */
  'client.videohangout.toggle-audio': {
    service: 'videohangout';
    action: 'toggle-audio';
    channel: string;
    sessionId: string;
    audioOn: boolean;
    [key: string]: unknown;
  };
  /** Generic channel subscribe frame from the useWebSocket channel multiplexer (also re-sent on reconnect when autoResubscribe is enabled). Wire service is literally "subscribe". */
  'client.subscribe.subscribe': {
    service: 'subscribe';
    action: 'subscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Generic channel unsubscribe frame from the useWebSocket channel multiplexer. Wire service is literally "subscribe". */
  'client.subscribe.unsubscribe': {
    service: 'subscribe';
    action: 'unsubscribe';
    channel: string;
    [key: string]: unknown;
  };
  /** Ask for a document call's live meta. The gateway replies to the sender only with ws.call.call-meta. */
  'client.call.meta': {
    service: 'call';
    action: 'meta';
    channel?: string;
    callId: string;
    [key: string]: unknown;
  };
  /** Replace a document call's review documents (host document stays first). Any participant. Broadcasts ws.call.call-meta. */
  'client.call.set-documents': {
    service: 'call';
    action: 'set-documents';
    channel?: string;
    callId: string;
    documentIds: string[];
    documentTitles?: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Present a review document, or stop with documentId null. Only the current presenter or the host may replace a presenter. Broadcasts ws.call.call-meta. */
  'client.call.present': {
    service: 'call';
    action: 'present';
    channel?: string;
    callId: string;
    documentId?: string | null;
    [key: string]: unknown;
  };
  /** Rename a document call. Host only. Broadcasts ws.call.call-meta. */
  'client.call.set-title': {
    service: 'call';
    action: 'set-title';
    channel?: string;
    callId: string;
    title: string;
    [key: string]: unknown;
  };
  /** Host asks a participant to mute. The gateway sends ws.call.mute-participant to that person's connections only. */
  'client.call.mute-participant': {
    service: 'call';
    action: 'mute-participant';
    channel?: string;
    callId: string;
    userId: string;
    [key: string]: unknown;
  };
  /** Host removes a participant. The gateway sends ws.call.remove-participant to them, user-status left (reason removed) and call-meta to everyone else. */
  'client.call.remove-participant': {
    service: 'call';
    action: 'remove-participant';
    channel?: string;
    callId: string;
    userId: string;
    [key: string]: unknown;
  };
  /** Host hands the host role to another participant. The gateway broadcasts ws.call.call-meta with the new hostUserId. */
  'client.call.transfer-host': {
    service: 'call';
    action: 'transfer-host';
    channel?: string;
    callId: string;
    userId: string;
    [key: string]: unknown;
  };
  /** Join a meeting's coordination channel. The gateway replies to the sender only with ws.meeting.meeting.snapshot (or ws.meeting.error FORBIDDEN when the channel guard refuses). The first subscriber becomes the default organizer. Sent again after every reconnect. */
  'client.meeting.subscribe': {
    service: 'meeting';
    action: 'subscribe';
    channel?: string;
    meetingId: string;
    [key: string]: unknown;
  };
  /** Leave a meeting's coordination channel. The gateway replies with ws.meeting.meeting.unsubscribed; when this was the user's last connection in the meeting their raised hand goes down (ws.meeting.hands.changed). */
  'client.meeting.unsubscribe': {
    service: 'meeting';
    action: 'unsubscribe';
    channel?: string;
    meetingId: string;
    [key: string]: unknown;
  };
  /** Raise your own hand. Any subscribed, signed-in participant. A hand already raised is a no-op; otherwise broadcasts ws.meeting.hands.changed. */
  'client.meeting.hand.raise': {
    service: 'meeting';
    action: 'hand.raise';
    channel?: string;
    meetingId: string;
    displayName?: string;
    [key: string]: unknown;
  };
  /** Lower your own hand (no userId), or someone else's — organizer only when userId names another user (ws.meeting.error FORBIDDEN otherwise). A hand not raised is a no-op; otherwise broadcasts ws.meeting.hands.changed. */
  'client.meeting.hand.lower': {
    service: 'meeting';
    action: 'hand.lower';
    channel?: string;
    meetingId: string;
    userId?: string;
    [key: string]: unknown;
  };
  /** Organizer only. Lower every raised hand. Broadcasts ws.meeting.hands.changed unless no hand was up. */
  'client.meeting.hand.lowerAll': {
    service: 'meeting';
    action: 'hand.lowerAll';
    channel?: string;
    meetingId: string;
    [key: string]: unknown;
  };
  /** Organizer only. Replace the breakout plan: rooms (all closed), mode and settings; clears the timer, returned list and announcement. Refused with CONFLICT while rooms are open. At most maxRooms rooms (host config, default 50). An empty list ends the session (phase none). Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.configure': {
    service: 'meeting';
    action: 'breakout.configure';
    channel?: string;
    meetingId: string;
    rooms: ({
      id?: string;
      name?: string;
      members?: string[];
      [key: string]: unknown;
    })[];
    mode?: 'assigned' | 'self-select';
    allowReturnToMain?: boolean;
    [key: string]: unknown;
  };
  /** Organizer only. Add one closed room in any phase (open it with client.meeting.breakout.open and its id). CONFLICT at maxRooms (default 50) or on a duplicate id. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.addRoom': {
    service: 'meeting';
    action: 'breakout.addRoom';
    channel?: string;
    meetingId: string;
    id?: string;
    name?: string | null;
    [key: string]: unknown;
  };
  /** Organizer only. Rename a room in any phase. NOT_FOUND for an unknown room; the same name is a no-op. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.rename': {
    service: 'meeting';
    action: 'breakout.rename';
    channel?: string;
    meetingId: string;
    roomId: string;
    name: string;
    [key: string]: unknown;
  };
  /** Organizer only. Place or unplace people: each entry moves that user to the room (out of any other) or, with null, out of every room. An unknown room id is INVALID_PAYLOAD. Assigned users drop off the returned list. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.assign': {
    service: 'meeting';
    action: 'breakout.assign';
    channel?: string;
    meetingId: string;
    assignments: Record<string, unknown>;
    [key: string]: unknown;
  };
  /** Organizer only. Replace every room's members by dealing the listed users round-robin across the rooms in order; clears the returned list. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.autoAssign': {
    service: 'meeting';
    action: 'breakout.autoAssign';
    channel?: string;
    meetingId: string;
    userIds?: string[];
    [key: string]: unknown;
  };
  /** Organizer only. Open the listed rooms, or all of them. Cancels a closing countdown. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.open': {
    service: 'meeting';
    action: 'breakout.open';
    channel?: string;
    meetingId: string;
    roomIds?: string[];
    [key: string]: unknown;
  };
  /** Organizer only. Close the listed rooms at once, or all of them. Closing all while rooms are open starts the host's closing grace (breakout.closing true, endsAt the end of the grace) unless immediate is set or a grace is already running. CONFLICT when there are no rooms. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.close': {
    service: 'meeting';
    action: 'breakout.close';
    channel?: string;
    meetingId: string;
    roomIds?: string[];
    immediate?: boolean;
    [key: string]: unknown;
  };
  /** Organizer only. Start a timer that closes every room when it runs out, or clear it with null. A duration needs open rooms (CONFLICT otherwise) and must be above 0 and at most maxTimerMs (host config, default 4 h = 14400000; INVALID_PAYLOAD otherwise). Cancels a closing countdown. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.timer': {
    service: 'meeting';
    action: 'breakout.timer';
    channel?: string;
    meetingId: string;
    durationMs?: number | null;
    [key: string]: unknown;
  };
  /** Organizer only. Send an announcement to every room and the main meeting. Stored as breakout.announcement and broadcast as ws.meeting.breakout.changed then ws.meeting.breakout.announcement. */
  'client.meeting.breakout.broadcast': {
    service: 'meeting';
    action: 'breakout.broadcast';
    channel?: string;
    meetingId: string;
    message: string;
    displayName?: string;
    [key: string]: unknown;
  };
  /** Move yourself into an open room. Any participant in self-select mode; in assigned mode only your own room (FORBIDDEN otherwise) — organizers may visit any room. NOT_FOUND for an unknown room, CONFLICT when it is closed or the rooms are closing. Rejoining your assigned room after returning to main takes you off the returned list. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.join': {
    service: 'meeting';
    action: 'breakout.join';
    channel?: string;
    meetingId: string;
    roomId: string;
    [key: string]: unknown;
  };
  /** Return from your room to the main meeting. FORBIDDEN when settings.allowReturnToMain is false (organizers exempt). In self-select mode you leave the room; in assigned mode you stay assigned and join the returned list. Not in a room is a no-op. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.leave': {
    service: 'meeting';
    action: 'breakout.leave';
    channel?: string;
    meetingId: string;
    [key: string]: unknown;
  };
  /** Organizer only. End the breakout session: every room closes and everyone returns to the main meeting (rooms are kept as a draft). While rooms are open this starts the host's closing grace unless immediate is set or a grace is already running. No session is a no-op. Broadcasts ws.meeting.breakout.changed. */
  'client.meeting.breakout.end': {
    service: 'meeting';
    action: 'breakout.end';
    channel?: string;
    meetingId: string;
    immediate?: boolean;
    [key: string]: unknown;
  };
  /** Broadcast when a client joins a presence channel, carrying the joining client's PresenceEntry. NOTE: the gateway presence service currently emits type:"presence" action frames (ws.presence.update / ws.presence.offline); presence:joined is the usePresence hook contract — naming tension documented per Wave A2, not renamed. */
  'ws.presence.joined': {
    type: 'presence:joined';
    timestamp?: string;
    channel: string;
    client: {
      clientId: string;
      status: string;
      metadata?: Record<string, unknown>;
      channels?: string[];
      nodeId?: string;
      timestamp?: string;
      lastSeen?: string;
      lastHeartbeat?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Broadcast when a client leaves a presence channel. NOTE: the gateway presence service currently emits type:"presence" action frames; presence:left is the usePresence hook contract — naming tension documented per Wave A2, not renamed. */
  'ws.presence.left': {
    type: 'presence:left';
    timestamp?: string;
    channel: string;
    clientId: string;
    [key: string]: unknown;
  };
  /** The HTTP PUT target for an accepted upload, returned privately to the requesting client. Supersedes the type:"upload" ws.upload.requested handshake, which the fileupload producer does not build. */
  'ws.fileupload.url': {
    type: 'fileupload:url';
    timestamp?: string;
    channel: string;
    id: string;
    transferId: string;
    uploadUrl: string;
    [key: string]: unknown;
  };
  /** A file transfer completed and is available for download. Broadcast to the channel. Supersedes the type:"upload" ws.upload.completed frame, which the fileupload producer does not build. */
  'ws.fileupload.complete': {
    type: 'fileupload:complete';
    timestamp?: string;
    channel: string;
    id: string;
    transferId: string;
    actor?: string;
    uploader?: string;
    downloadUrl: string;
    filename: string;
    size: number;
    contentType?: string;
    width?: number;
    height?: number;
    preview?: string;
    [key: string]: unknown;
  };
  /** A file transfer failed. Delivered privately to the requesting client. Supersedes the type:"upload" ws.upload.failed frame, which the fileupload producer does not build. */
  'ws.fileupload.failed': {
    type: 'fileupload:failed';
    timestamp?: string;
    channel: string;
    id: string;
    error: string;
    [key: string]: unknown;
  };
  /** A file transfer has started and is announced to the channel. Supersedes the type:"upload" ws.upload.requested frame, which the fileupload producer does not build. */
  'ws.fileupload.started': {
    type: 'fileupload:started';
    timestamp?: string;
    channel: string;
    transferId: string;
    id: string;
    actor?: string;
    uploader?: string;
    filename: string;
    size: number;
    contentType?: string;
    preview?: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  };
  /** Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway's own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed. */
  'ws.fileupload.progress': {
    type: 'fileupload:progress';
    timestamp?: string;
    channel: string;
    id: string;
    transferId?: string;
    actor?: string;
    transferred?: number;
    size?: number;
    progress?: number;
    [key: string]: unknown;
  };
  /** Antivirus scan is IN PROGRESS for an uploaded file — distinct from the existing ws.upload.scanned declaration, which reports the scan OUTCOME (clean/infected). The scanning-vs-scanned naming tension is documented per Wave A2, not renamed. */
  'ws.fileupload.scanning': {
    type: 'fileupload:scanning';
    timestamp?: string;
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Acknowledgement that a client-requested upload cancellation completed (useFileUpload.cancel round-trip). Part of the fileupload:* hook contract — see ws.fileupload.progress for the upload-vs-fileupload naming note. */
  'ws.fileupload.cancelled': {
    type: 'fileupload:cancelled';
    timestamp?: string;
    channel: string;
    id: string;
    [key: string]: unknown;
  };
  /** Participant joined or updated in a hangout session, carrying the full HangoutParticipant. NOTE: the gateway currently signals hangout/call invites via type:"call" frames (ws.call.*); videohangout:* is the useVideoHangout hook contract — naming tension documented per Wave A2, not renamed. */
  'ws.videohangout.participant': {
    type: 'videohangout:participant';
    timestamp?: string;
    channel: string;
    participant: {
      clientId: string;
      displayName?: string;
      role: 'host' | 'participant' | 'viewer';
      videoOn?: boolean;
      audioOn?: boolean;
      joinedAt?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Media-state change for a hangout participant (video/audio toggled). Part of the videohangout:* hook contract — see ws.videohangout.participant for the videohangout-vs-ws.call.* naming note. */
  'ws.videohangout.media': {
    type: 'videohangout:media';
    timestamp?: string;
    channel: string;
    clientId: string;
    videoOn: boolean;
    audioOn: boolean;
    [key: string]: unknown;
  };
  /** New USER-scoped notification pushed to the client inbox — delivered regardless of which channel is open (useNotifications). NOTE: gateway-side emission is deferred (M3+ per the hook header); declared now so the client contract is in the catalog. */
  'ws.notification.new': {
    type: 'notification:new';
    timestamp?: string;
    service?: 'notification';
    payload: {
      id: string;
      type: string;
      title: string;
      body?: string;
      timestamp: string;
      read?: boolean;
      channel?: string;
      payload?: Record<string, unknown>;
      action?: {
        label: string;
        href?: string;
        onClickEvent?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Server push that a notification was marked read, so other tabs/devices converge (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract. */
  'ws.notification.read': {
    type: 'notification:read';
    timestamp?: string;
    service?: 'notification';
    payload: {
      id: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Bulk notification list update (e.g. inbox sync on reconnect) carrying an array of Notification objects (useNotifications). Gateway-side emission deferred (M3+); declared as the client contract. */
  'ws.notification.bulk-update': {
    type: 'notification:bulk-update';
    timestamp?: string;
    service?: 'notification';
    payload: {
      notifications: ({
        id: string;
        type: string;
        title: string;
        body?: string;
        timestamp: string;
        read?: boolean;
        channel?: string;
        payload?: Record<string, unknown>;
        action?: {
          label: string;
          href?: string;
          onClickEvent?: string;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      })[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Control-plane push that a CRD-derived capability changed state, so useCapability consumers update without a remount. Payload mirrors CapabilityUpdatedPayload in useCapability.ts. */
  'ws.capability.updated': {
    type: 'capability:updated';
    timestamp?: string;
    payload: {
      name: string;
      enabled: boolean;
      channel?: string;
      version?: string;
      metadata?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Gateway push that an app-level feature flag changed (kill-switch / A-B variant), so useFeatureFlag consumers update reactively. Payload mirrors FeatureFlagUpdatedPayload in useFeatureFlag.ts. */
  'ws.feature-flag.updated': {
    type: 'feature-flag:updated';
    timestamp?: string;
    payload: {
      name: string;
      enabled: boolean;
      variant?: string;
      metadata?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Confirmation sent to a client when their reaction unsubscribe is accepted. GROUND TRUTH (gateway dist ReactionService.handleUnsubscribeFromReactions → sendSuccess): wire frame is { type:"reaction", action:"reaction_unsubscribed", success:true, data:{ channel, message } }. No ws.* declaration existed for this verified send-back before — added per divergence note (b). */
  'ws.reaction.unsubscribed': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_unsubscribed';
    success?: true;
    data: {
      channel: string;
      message?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** The gateway's available-reactions catalog (emoji → effect map), sent in reply to a getAvailable request. GROUND TRUTH (gateway dist ReactionService.handleGetAvailableReactions → sendSuccess): wire frame is { type:"reaction", action:"available_reactions", success:true, data:{ reactions } } where reactions maps each emoji to its { effect } config. No ws.* declaration existed before — added per divergence note (b). */
  'ws.reaction.available': {
    type: 'reaction';
    timestamp?: string;
    action: 'available_reactions';
    success?: true;
    data: {
      reactions: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  /** Coalesced Y.js awareness updates broadcast to all CRDT channel subscribers. GROUND TRUTH (gateway dist server/AwarenessCoalescer._broadcast): wire frame is { type:"crdt:awareness", channel, updates:[{ clientId, update }] } where each update is a base64-encoded Y.js awareness delta. This is the frame the running dist emits — distinct from the historical ws.crdt.awareness-batch (type "crdt:awareness-batch", per-entry { clientId, awareness }) which the current dist does NOT emit. Added per divergence note (b). */
  'ws.crdt.awareness': {
    type: 'crdt:awareness';
    timestamp?: string;
    channel: string;
    updates: ({
      clientId: string;
      update: string;
      [key: string]: unknown;
    })[];
    [key: string]: unknown;
  };
  /** Emitted when an agent run begins. Carries the thread and run IDs. */
  'ag-ui.RUN_STARTED': {
    type: 'RUN_STARTED';
    threadId: string;
    runId: string;
    [key: string]: unknown;
  };
  /** Emitted when an agent run completes successfully. GROUND TRUTH: neither producer repeats the run identity that RUN_STARTED already established. realtime-modules:src/agent-streaming/AgentStream.ts:117 `runFinished` sends { type, outcome?, result?, timestamp } — and its only in-repo caller (agentStreamMiddleware.ts:210) passes no args at all, so a bare { type, timestamp } is the common frame. platform-api:src/routes/pipelineLLMStream.ts:169 sends { type, runId }. Nothing sends `threadId`. */
  'ag-ui.RUN_FINISHED': {
    type: 'RUN_FINISHED';
    threadId?: string;
    runId?: string;
    outcome?: string;
    result?: unknown;
    timestamp?: number;
    [key: string]: unknown;
  };
  /** Emitted when an agent run terminates due to an error. */
  'ag-ui.RUN_ERROR': {
    type: 'RUN_ERROR';
    message: string;
    code?: string;
    [key: string]: unknown;
  };
  /** Emitted when a named step begins within a run. */
  'ag-ui.STEP_STARTED': {
    type: 'STEP_STARTED';
    stepName: string;
    [key: string]: unknown;
  };
  /** Emitted when a named step completes. */
  'ag-ui.STEP_FINISHED': {
    type: 'STEP_FINISHED';
    stepName: string;
    [key: string]: unknown;
  };
  /** Opens a new streamed text message. Role identifies the speaker (assistant/user/system). */
  'ag-ui.TEXT_MESSAGE_START': {
    type: 'TEXT_MESSAGE_START';
    messageId: string;
    role: 'assistant' | 'user' | 'system';
    [key: string]: unknown;
  };
  /** Carries a text delta for an in-progress message stream. */
  'ag-ui.TEXT_MESSAGE_CONTENT': {
    type: 'TEXT_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
    [key: string]: unknown;
  };
  /** Closes a streamed text message. */
  'ag-ui.TEXT_MESSAGE_END': {
    type: 'TEXT_MESSAGE_END';
    messageId: string;
    [key: string]: unknown;
  };
  /** Single-frame variant: complete text message in one event (no START/END pair). */
  'ag-ui.TEXT_MESSAGE_CHUNK': {
    type: 'TEXT_MESSAGE_CHUNK';
    messageId: string;
    role: string;
    delta: string;
    [key: string]: unknown;
  };
  /** Agent begins a tool invocation. toolCallId is unique per call within a run. */
  'ag-ui.TOOL_CALL_START': {
    type: 'TOOL_CALL_START';
    toolCallId: string;
    toolCallName: string;
    parentMessageId?: string;
    [key: string]: unknown;
  };
  /** Carries a JSON delta fragment of the tool call arguments. */
  'ag-ui.TOOL_CALL_ARGS': {
    type: 'TOOL_CALL_ARGS';
    toolCallId: string;
    delta: string;
    [key: string]: unknown;
  };
  /** Agent finishes streaming arguments for a tool call. */
  'ag-ui.TOOL_CALL_END': {
    type: 'TOOL_CALL_END';
    toolCallId: string;
    [key: string]: unknown;
  };
  /** Carries the result of a completed tool call. GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:273 `toolCallResult`): { type, messageId, toolCallId, content, role?, timestamp }. The tool NAME is established once on TOOL_CALL_START and is not repeated here — correlate on `toolCallId`. */
  'ag-ui.TOOL_CALL_RESULT': {
    type: 'TOOL_CALL_RESULT';
    messageId: string;
    toolCallId: string;
    toolCallName?: string;
    role?: string;
    content: unknown;
    timestamp?: number;
    [key: string]: unknown;
  };
  /** Single-frame variant: complete tool call in one event. */
  'ag-ui.TOOL_CALL_CHUNK': {
    type: 'TOOL_CALL_CHUNK';
    toolCallId: string;
    toolCallName?: string;
    delta?: string;
    parentMessageId?: string;
    [key: string]: unknown;
  };
  /** Full state replacement. Replaces any prior state on the client. */
  'ag-ui.STATE_SNAPSHOT': {
    type: 'STATE_SNAPSHOT';
    snapshot: unknown;
    [key: string]: unknown;
  };
  /** Incremental state update encoded as a JSON Patch (RFC 6902) delta. */
  'ag-ui.STATE_DELTA': {
    type: 'STATE_DELTA';
    delta: ({
      op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
      path: string;
      value?: unknown;
      from?: string;
      [key: string]: unknown;
    })[];
    [key: string]: unknown;
  };
  /** Full replacement of the message history in one event. */
  'ag-ui.MESSAGES_SNAPSHOT': {
    type: 'MESSAGES_SNAPSHOT';
    messages: unknown[];
    [key: string]: unknown;
  };
  /** Full replacement of ONE activity-feed entry (a tool call, a reasoning trace, a sub-step). GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:321 `activitySnapshot`): { type, messageId, activityType, content, replace?, timestamp }. The entry is addressed by `messageId`; this is NOT the upstream AG-UI spec's whole-feed `snapshot` array, which no producer has ever sent. */
  'ag-ui.ACTIVITY_SNAPSHOT': {
    type: 'ACTIVITY_SNAPSHOT';
    messageId?: unknown;
    activityType?: string;
    content?: unknown;
    replace?: boolean;
    timestamp?: number;
    snapshot?: unknown[];
    [key: string]: unknown;
  };
  /** Incremental update to ONE activity-feed entry. GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:337 `activityDelta`): { type, messageId, activityType, patch, timestamp }. The update rides on `patch`, not on the upstream AG-UI spec's `delta` array, which no producer has ever sent. */
  'ag-ui.ACTIVITY_DELTA': {
    type: 'ACTIVITY_DELTA';
    messageId?: unknown;
    activityType?: string;
    patch?: unknown;
    timestamp?: number;
    delta?: unknown[];
    [key: string]: unknown;
  };
  /** Opens a reasoning trace message stream. */
  'ag-ui.REASONING_MESSAGE_START': {
    type: 'REASONING_MESSAGE_START';
    messageId: string;
    [key: string]: unknown;
  };
  /** Carries a text delta within a reasoning trace stream. */
  'ag-ui.REASONING_MESSAGE_CONTENT': {
    type: 'REASONING_MESSAGE_CONTENT';
    messageId: string;
    delta: string;
    [key: string]: unknown;
  };
  /** Closes a reasoning trace message stream. */
  'ag-ui.REASONING_MESSAGE_END': {
    type: 'REASONING_MESSAGE_END';
    messageId: string;
    [key: string]: unknown;
  };
  /** Single-frame reasoning trace message. */
  'ag-ui.REASONING_MESSAGE_CHUNK': {
    type: 'REASONING_MESSAGE_CHUNK';
    messageId: string;
    delta: string;
    [key: string]: unknown;
  };
  /** Signals that the agent has entered a reasoning phase. */
  'ag-ui.REASONING_START': {
    type: 'REASONING_START';
    [key: string]: unknown;
  };
  /** Signals that the agent has exited the reasoning phase. */
  'ag-ui.REASONING_END': {
    type: 'REASONING_END';
    [key: string]: unknown;
  };
  /** Carries an encrypted reasoning payload (provider-specific format). GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:420 `reasoningEncryptedValue`): { type, subtype, entityId, encryptedValue, timestamp }. The ciphertext rides on `encryptedValue`, not on the upstream AG-UI spec's `value`, which no producer has ever sent. */
  'ag-ui.REASONING_ENCRYPTED_VALUE': {
    type: 'REASONING_ENCRYPTED_VALUE';
    subtype?: string;
    entityId?: string;
    encryptedValue?: string;
    timestamp?: number;
    value?: string;
    [key: string]: unknown;
  };
  /** Escape hatch for unstructured provider-native payloads. */
  'ag-ui.RAW': {
    type: 'RAW';
    event: unknown;
    [key: string]: unknown;
  };
  /** Application-specific custom event with arbitrary structured payload. */
  'ag-ui.CUSTOM': {
    type: 'CUSTOM';
    name: string;
    value?: unknown;
    [key: string]: unknown;
  };
  /** Protocol metadata event (e.g. heartbeats, version negotiation). GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:448 `meta`): { type, metaType, payload, timestamp }. The discriminator is `metaType`, not the upstream AG-UI spec's `name`, which no producer has ever sent. */
  'ag-ui.META_EVENT': {
    type: 'META_EVENT';
    metaType?: string;
    payload?: unknown;
    timestamp?: number;
    name?: string;
    [key: string]: unknown;
  };
  /** Presence roster for the newsroom researcher assistant page. Consumed by usePresence("newsroom-researcher") in ResearcherPage. */
  'orgiq.newsroom-researcher.presence': {
    type: 'presence';
    channel: string;
    timestamp?: string;
    action?: 'set' | 'update' | 'subscribed' | 'unsubscribed' | 'offline';
    userId?: string;
    [key: string]: unknown;
  };
  /** Activity feed events for the newsroom researcher channel. Consumed by useActivity("newsroom-researcher") in ResearcherPage. */
  'orgiq.newsroom-researcher.activity': {
    type: 'activity';
    channel: string;
    timestamp?: string;
    action?: 'subscribed' | 'unsubscribed' | 'event' | 'history' | 'published';
    eventType?: string;
    userId?: string;
    [key: string]: unknown;
  };
  /** Presence roster for the newsroom briefs generation page. Consumed by usePresence("newsroom-briefs") in BriefsPage. */
  'orgiq.newsroom-briefs.presence': {
    type: 'presence';
    channel: string;
    timestamp?: string;
    action?: 'set' | 'update' | 'subscribed' | 'unsubscribed' | 'offline';
    userId?: string;
    [key: string]: unknown;
  };
  /** Presence roster for the global semantic search page. Consumed by usePresence("search") in SearchPage. */
  'orgiq.search.presence': {
    type: 'presence';
    channel: string;
    timestamp?: string;
    action?: 'set' | 'update' | 'subscribed' | 'unsubscribed' | 'offline';
    userId?: string;
    [key: string]: unknown;
  };
  /** Presence roster for the direct agent invocation page. Consumed by usePresence("invoke") in InvokePage. */
  'orgiq.invoke.presence': {
    type: 'presence';
    channel: string;
    timestamp?: string;
    action?: 'set' | 'update' | 'subscribed' | 'unsubscribed' | 'offline';
    userId?: string;
    [key: string]: unknown;
  };
  /** Emoji reactions on newsroom articles. Consumed by useReactions("newsroom-articles") in ArticleDetailPage; targetId carries the article ID. */
  'orgiq.newsroom-articles.reactions': {
    type: 'reaction';
    channel: string;
    timestamp?: string;
    action?: 'subscribed' | 'received' | 'removed' | 'list' | 'sent';
    emoji?: string;
    targetId?: string;
    userId?: string;
    [key: string]: unknown;
  };
}

/**
 * Utility type — get the payload type for a specific event by name.
 *
 * @example
 *   type StartedPayload = EventPayload<'pipeline:run:started'>;
 */
export type EventPayload<K extends keyof EventPayloadMap> = EventPayloadMap[K];
