// AUTO-GENERATED — do not edit manually. Run: npm run generate-types
// Generated at: 2026-06-12T22:29:58.385Z

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
    approverIds: string[];
    requestedAt: number;
    [key: string]: unknown;
  };
  /** An approver has recorded a decision against a pending pipeline approval. `decision` is the recorded outcome; `comment` carries an optional reviewer note. Dual-emitted on signal + durable so audit and worker consumers both see the decision. */
  'pipeline.approval.recorded': {
    runId: string;
    stepId: string;
    approver: string;
    decision: 'approve' | 'reject';
    comment?: string;
    decidedAt: number;
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
  /** Broadcast to all reaction channel subscribers when a previously sent reaction is removed. NOTE (2026-06-12 dist re-audit): the realtime-modules dist ReactionService the gateway currently runs has NO reaction-remove action — this frame is a historical/in-tree-gateway surface, retained for back-compat but not emitted by the current service. */
  'ws.reaction.removed': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_removed';
    data: {
      id: string;
      clientId?: string;
      channel: string;
      emoji?: string;
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
  /** Server-side upload progress (0-100) for an in-flight file upload. Part of the fileupload:* hook contract (useFileUpload); the gateway's own upload lifecycle is declared as ws.upload.* with type:"upload" frames — naming tension documented per Wave A2, not renamed. */
  'ws.fileupload.progress': {
    type: 'fileupload:progress';
    timestamp?: string;
    channel: string;
    id: string;
    progress: number;
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
  /** Emitted when an agent run completes successfully. */
  'ag-ui.RUN_FINISHED': {
    type: 'RUN_FINISHED';
    threadId: string;
    runId: string;
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
  /** Carries the result of a completed tool call. */
  'ag-ui.TOOL_CALL_RESULT': {
    type: 'TOOL_CALL_RESULT';
    messageId: string;
    toolCallId: string;
    toolCallName: string;
    content: unknown;
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
    })[];
    [key: string]: unknown;
  };
  /** Full replacement of the message history in one event. */
  'ag-ui.MESSAGES_SNAPSHOT': {
    type: 'MESSAGES_SNAPSHOT';
    messages: unknown[];
    [key: string]: unknown;
  };
  /** Full replacement of the activity feed (tool calls, reasoning, sub-steps). */
  'ag-ui.ACTIVITY_SNAPSHOT': {
    type: 'ACTIVITY_SNAPSHOT';
    snapshot: unknown[];
    [key: string]: unknown;
  };
  /** Incremental update to the activity feed (append or update one item). */
  'ag-ui.ACTIVITY_DELTA': {
    type: 'ACTIVITY_DELTA';
    delta: unknown[];
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
  /** Carries an encrypted reasoning payload (provider-specific format). */
  'ag-ui.REASONING_ENCRYPTED_VALUE': {
    type: 'REASONING_ENCRYPTED_VALUE';
    value: string;
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
  /** Protocol metadata event (e.g. heartbeats, version negotiation). */
  'ag-ui.META_EVENT': {
    type: 'META_EVENT';
    name: string;
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
