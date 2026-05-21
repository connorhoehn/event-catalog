// AUTO-GENERATED — do not edit manually. Run: npm run generate-types
// Generated at: 2026-05-21T15:58:04.957Z

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
  /** Subscription confirmation sent when a client subscribes to reactions in a channel. */
  'ws.reaction.subscribed': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_subscribed';
    data?: {
      channel?: string;
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
  /** Confirmation sent to the reaction sender after their reaction is broadcast. */
  'ws.reaction.sent': {
    type: 'reaction';
    timestamp?: string;
    action: 'reaction_sent';
    data?: Record<string, unknown>;
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
  /** Generic error frame sent to a client when any gateway service encounters a client-visible error. */
  'ws.error': {
    type: 'error';
    timestamp?: string;
    service?: string;
    code?: string;
    message?: string;
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
}

/**
 * Utility type — get the payload type for a specific event by name.
 *
 * @example
 *   type StartedPayload = EventPayload<'pipeline:run:started'>;
 */
export type EventPayload<K extends keyof EventPayloadMap> = EventPayloadMap[K];
