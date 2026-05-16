// src/declarations/ag-ui.ts
//
// AG-UI v0.1.x protocol event taxonomy — 29 event types across 7 categories.
//
// AG-UI is the streaming protocol used by @connorhoehnslalom/ui-components/agents
// to communicate agent lifecycle, text streaming, tool calls, state snapshots,
// activity updates, reasoning traces, and extensions between an agent backend
// and the browser frontend. All events are signal transport (ephemeral SSE/WS).
//
// Source of truth for field shapes: ui-components src/types/agents.ts
// (AgUiEvent discriminated union). Event names follow the AG-UI v0.1.x spec.
//
// Reference: ui-components commit 7399dc1, src/components/agents/README.md.

import type { EventDeclaration } from '../types/index';

const PRODUCER = 'ag-ui-agent';
const NAMESPACE = 'ag-ui';
const TAGS = ['ag-ui', 'agent', 'streaming'];

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export const agUiRunStarted: EventDeclaration = {
  name: 'ag-ui.RUN_STARTED',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Emitted when an agent run begins. Carries the thread and run IDs.',
  schema: {
    type: 'object',
    required: ['type', 'threadId', 'runId'],
    properties: {
      type: { type: 'string', const: 'RUN_STARTED' },
      threadId: { type: 'string' },
      runId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiRunFinished: EventDeclaration = {
  name: 'ag-ui.RUN_FINISHED',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Emitted when an agent run completes successfully.',
  schema: {
    type: 'object',
    required: ['type', 'threadId', 'runId'],
    properties: {
      type: { type: 'string', const: 'RUN_FINISHED' },
      threadId: { type: 'string' },
      runId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiRunError: EventDeclaration = {
  name: 'ag-ui.RUN_ERROR',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Emitted when an agent run terminates due to an error.',
  schema: {
    type: 'object',
    required: ['type', 'message'],
    properties: {
      type: { type: 'string', const: 'RUN_ERROR' },
      message: { type: 'string' },
      code: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiStepStarted: EventDeclaration = {
  name: 'ag-ui.STEP_STARTED',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Emitted when a named step begins within a run.',
  schema: {
    type: 'object',
    required: ['type', 'stepName'],
    properties: {
      type: { type: 'string', const: 'STEP_STARTED' },
      stepName: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiStepFinished: EventDeclaration = {
  name: 'ag-ui.STEP_FINISHED',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Emitted when a named step completes.',
  schema: {
    type: 'object',
    required: ['type', 'stepName'],
    properties: {
      type: { type: 'string', const: 'STEP_FINISHED' },
      stepName: { type: 'string' },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Text streaming events
// ---------------------------------------------------------------------------

export const agUiTextMessageStart: EventDeclaration = {
  name: 'ag-ui.TEXT_MESSAGE_START',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Opens a new streamed text message. Role identifies the speaker (assistant/user/system).',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'role'],
    properties: {
      type: { type: 'string', const: 'TEXT_MESSAGE_START' },
      messageId: { type: 'string' },
      role: { type: 'string', enum: ['assistant', 'user', 'system'] },
    },
    additionalProperties: true,
  },
};

export const agUiTextMessageContent: EventDeclaration = {
  name: 'ag-ui.TEXT_MESSAGE_CONTENT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Carries a text delta for an in-progress message stream.',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'delta'],
    properties: {
      type: { type: 'string', const: 'TEXT_MESSAGE_CONTENT' },
      messageId: { type: 'string' },
      delta: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiTextMessageEnd: EventDeclaration = {
  name: 'ag-ui.TEXT_MESSAGE_END',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Closes a streamed text message.',
  schema: {
    type: 'object',
    required: ['type', 'messageId'],
    properties: {
      type: { type: 'string', const: 'TEXT_MESSAGE_END' },
      messageId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiTextMessageChunk: EventDeclaration = {
  name: 'ag-ui.TEXT_MESSAGE_CHUNK',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Single-frame variant: complete text message in one event (no START/END pair).',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'role', 'delta'],
    properties: {
      type: { type: 'string', const: 'TEXT_MESSAGE_CHUNK' },
      messageId: { type: 'string' },
      role: { type: 'string' },
      delta: { type: 'string' },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Tool call events
// ---------------------------------------------------------------------------

export const agUiToolCallStart: EventDeclaration = {
  name: 'ag-ui.TOOL_CALL_START',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Agent begins a tool invocation. toolCallId is unique per call within a run.',
  schema: {
    type: 'object',
    required: ['type', 'toolCallId', 'toolCallName'],
    properties: {
      type: { type: 'string', const: 'TOOL_CALL_START' },
      toolCallId: { type: 'string' },
      toolCallName: { type: 'string' },
      parentMessageId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiToolCallArgs: EventDeclaration = {
  name: 'ag-ui.TOOL_CALL_ARGS',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Carries a JSON delta fragment of the tool call arguments.',
  schema: {
    type: 'object',
    required: ['type', 'toolCallId', 'delta'],
    properties: {
      type: { type: 'string', const: 'TOOL_CALL_ARGS' },
      toolCallId: { type: 'string' },
      delta: { type: 'string', description: 'Partial JSON of arguments being streamed.' },
    },
    additionalProperties: true,
  },
};

export const agUiToolCallEnd: EventDeclaration = {
  name: 'ag-ui.TOOL_CALL_END',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Agent finishes streaming arguments for a tool call.',
  schema: {
    type: 'object',
    required: ['type', 'toolCallId'],
    properties: {
      type: { type: 'string', const: 'TOOL_CALL_END' },
      toolCallId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiToolCallResult: EventDeclaration = {
  name: 'ag-ui.TOOL_CALL_RESULT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Carries the result of a completed tool call.',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'toolCallId', 'toolCallName', 'content'],
    properties: {
      type: { type: 'string', const: 'TOOL_CALL_RESULT' },
      messageId: { type: 'string' },
      toolCallId: { type: 'string' },
      toolCallName: { type: 'string' },
      content: {},
    },
    additionalProperties: true,
  },
};

export const agUiToolCallChunk: EventDeclaration = {
  name: 'ag-ui.TOOL_CALL_CHUNK',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Single-frame variant: complete tool call in one event.',
  schema: {
    type: 'object',
    required: ['type', 'toolCallId'],
    properties: {
      type: { type: 'string', const: 'TOOL_CALL_CHUNK' },
      toolCallId: { type: 'string' },
      toolCallName: { type: 'string' },
      delta: { type: 'string' },
      parentMessageId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// State events
// ---------------------------------------------------------------------------

export const agUiStateSnapshot: EventDeclaration = {
  name: 'ag-ui.STATE_SNAPSHOT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Full state replacement. Replaces any prior state on the client.',
  schema: {
    type: 'object',
    required: ['type', 'snapshot'],
    properties: {
      type: { type: 'string', const: 'STATE_SNAPSHOT' },
      snapshot: {},
    },
    additionalProperties: true,
  },
};

export const agUiStateDelta: EventDeclaration = {
  name: 'ag-ui.STATE_DELTA',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Incremental state update encoded as a JSON Patch (RFC 6902) delta.',
  schema: {
    type: 'object',
    required: ['type', 'delta'],
    properties: {
      type: { type: 'string', const: 'STATE_DELTA' },
      delta: {
        type: 'array',
        description: 'JSON Patch operations.',
        items: {
          type: 'object',
          required: ['op', 'path'],
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'replace', 'move', 'copy', 'test'] },
            path: { type: 'string' },
            value: {},
            from: { type: 'string' },
          },
        },
      },
    },
    additionalProperties: true,
  },
};

export const agUiMessagesSnapshot: EventDeclaration = {
  name: 'ag-ui.MESSAGES_SNAPSHOT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Full replacement of the message history in one event.',
  schema: {
    type: 'object',
    required: ['type', 'messages'],
    properties: {
      type: { type: 'string', const: 'MESSAGES_SNAPSHOT' },
      messages: { type: 'array', items: {} },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

export const agUiActivitySnapshot: EventDeclaration = {
  name: 'ag-ui.ACTIVITY_SNAPSHOT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Full replacement of the activity feed (tool calls, reasoning, sub-steps).',
  schema: {
    type: 'object',
    required: ['type', 'snapshot'],
    properties: {
      type: { type: 'string', const: 'ACTIVITY_SNAPSHOT' },
      snapshot: { type: 'array', items: {} },
    },
    additionalProperties: true,
  },
};

export const agUiActivityDelta: EventDeclaration = {
  name: 'ag-ui.ACTIVITY_DELTA',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Incremental update to the activity feed (append or update one item).',
  schema: {
    type: 'object',
    required: ['type', 'delta'],
    properties: {
      type: { type: 'string', const: 'ACTIVITY_DELTA' },
      delta: { type: 'array', items: {} },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Reasoning events
// ---------------------------------------------------------------------------

export const agUiReasoningMessageStart: EventDeclaration = {
  name: 'ag-ui.REASONING_MESSAGE_START',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Opens a reasoning trace message stream.',
  schema: {
    type: 'object',
    required: ['type', 'messageId'],
    properties: {
      type: { type: 'string', const: 'REASONING_MESSAGE_START' },
      messageId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningMessageContent: EventDeclaration = {
  name: 'ag-ui.REASONING_MESSAGE_CONTENT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Carries a text delta within a reasoning trace stream.',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'delta'],
    properties: {
      type: { type: 'string', const: 'REASONING_MESSAGE_CONTENT' },
      messageId: { type: 'string' },
      delta: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningMessageEnd: EventDeclaration = {
  name: 'ag-ui.REASONING_MESSAGE_END',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Closes a reasoning trace message stream.',
  schema: {
    type: 'object',
    required: ['type', 'messageId'],
    properties: {
      type: { type: 'string', const: 'REASONING_MESSAGE_END' },
      messageId: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningMessageChunk: EventDeclaration = {
  name: 'ag-ui.REASONING_MESSAGE_CHUNK',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Single-frame reasoning trace message.',
  schema: {
    type: 'object',
    required: ['type', 'messageId', 'delta'],
    properties: {
      type: { type: 'string', const: 'REASONING_MESSAGE_CHUNK' },
      messageId: { type: 'string' },
      delta: { type: 'string' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningStart: EventDeclaration = {
  name: 'ag-ui.REASONING_START',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Signals that the agent has entered a reasoning phase.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'REASONING_START' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningEnd: EventDeclaration = {
  name: 'ag-ui.REASONING_END',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Signals that the agent has exited the reasoning phase.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'REASONING_END' },
    },
    additionalProperties: true,
  },
};

export const agUiReasoningEncryptedValue: EventDeclaration = {
  name: 'ag-ui.REASONING_ENCRYPTED_VALUE',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Carries an encrypted reasoning payload (provider-specific format).',
  schema: {
    type: 'object',
    required: ['type', 'value'],
    properties: {
      type: { type: 'string', const: 'REASONING_ENCRYPTED_VALUE' },
      value: { type: 'string', description: 'Opaque encrypted bytes.' },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Extension events
// ---------------------------------------------------------------------------

export const agUiRaw: EventDeclaration = {
  name: 'ag-ui.RAW',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Escape hatch for unstructured provider-native payloads.',
  schema: {
    type: 'object',
    required: ['type', 'event'],
    properties: {
      type: { type: 'string', const: 'RAW' },
      event: {},
    },
    additionalProperties: true,
  },
};

export const agUiCustom: EventDeclaration = {
  name: 'ag-ui.CUSTOM',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Application-specific custom event with arbitrary structured payload.',
  schema: {
    type: 'object',
    required: ['type', 'name'],
    properties: {
      type: { type: 'string', const: 'CUSTOM' },
      name: { type: 'string' },
      value: {},
    },
    additionalProperties: true,
  },
};

export const agUiMetaEvent: EventDeclaration = {
  name: 'ag-ui.META_EVENT',
  namespace: NAMESPACE,
  transport: 'signal',
  producer: PRODUCER,
  tags: TAGS,
  description: 'Protocol metadata event (e.g. heartbeats, version negotiation).',
  schema: {
    type: 'object',
    required: ['type', 'name'],
    properties: {
      type: { type: 'string', const: 'META_EVENT' },
      name: { type: 'string' },
    },
    additionalProperties: true,
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All 29 AG-UI v0.1.x event declarations. */
export const agUiDeclarations: readonly EventDeclaration[] = [
  // Lifecycle
  agUiRunStarted,
  agUiRunFinished,
  agUiRunError,
  agUiStepStarted,
  agUiStepFinished,
  // Text streaming
  agUiTextMessageStart,
  agUiTextMessageContent,
  agUiTextMessageEnd,
  agUiTextMessageChunk,
  // Tool calls
  agUiToolCallStart,
  agUiToolCallArgs,
  agUiToolCallEnd,
  agUiToolCallResult,
  agUiToolCallChunk,
  // State
  agUiStateSnapshot,
  agUiStateDelta,
  agUiMessagesSnapshot,
  // Activity
  agUiActivitySnapshot,
  agUiActivityDelta,
  // Reasoning
  agUiReasoningMessageStart,
  agUiReasoningMessageContent,
  agUiReasoningMessageEnd,
  agUiReasoningMessageChunk,
  agUiReasoningStart,
  agUiReasoningEnd,
  agUiReasoningEncryptedValue,
  // Extensions
  agUiRaw,
  agUiCustom,
  agUiMetaEvent,
];
