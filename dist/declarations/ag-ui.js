"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiDeclarations = exports.agUiMetaEvent = exports.agUiCustom = exports.agUiRaw = exports.agUiReasoningEncryptedValue = exports.agUiReasoningEnd = exports.agUiReasoningStart = exports.agUiReasoningMessageChunk = exports.agUiReasoningMessageEnd = exports.agUiReasoningMessageContent = exports.agUiReasoningMessageStart = exports.agUiActivityDelta = exports.agUiActivitySnapshot = exports.agUiMessagesSnapshot = exports.agUiStateDelta = exports.agUiStateSnapshot = exports.agUiToolCallChunk = exports.agUiToolCallResult = exports.agUiToolCallEnd = exports.agUiToolCallArgs = exports.agUiToolCallStart = exports.agUiTextMessageChunk = exports.agUiTextMessageEnd = exports.agUiTextMessageContent = exports.agUiTextMessageStart = exports.agUiStepFinished = exports.agUiStepStarted = exports.agUiRunError = exports.agUiRunFinished = exports.agUiRunStarted = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'ag-ui-agent';
const NAMESPACE = 'ag-ui';
const TAGS = ['ag-ui', 'agent', 'streaming'];
/**
 * AG-UI protocol field meanings. `type`, `delta` and friends mean something
 * different here than on the gateway's WS frames, so this module overrides
 * them rather than inheriting the common glossary's wording.
 */
const FIELDS = {
    type: 'AG-UI event type discriminator — always the literal name of this event.',
    threadId: 'Identifier of the conversation thread this run belongs to.',
    runId: 'Identifier of the agent run this event belongs to.',
    stepName: 'Name of the step within the run.',
    messageId: 'Identifier of the message this event contributes to. Stable across the start/content/end triple.',
    role: 'Role of the message author.',
    delta: 'Incremental update since the previous event of this stream.',
    snapshot: 'Full replacement snapshot of the stream\'s state; supersedes every delta received so far.',
    toolCallId: 'Identifier correlating the start, args, and result events of a single tool call.',
    toolCallName: 'Name of the tool being invoked.',
    parentMessageId: 'Identifier of the assistant message this tool call hangs off.',
    content: 'Result content returned by the tool call.',
    message: 'Human-readable error message.',
    code: 'Machine-readable error code, when the agent supplies one.',
    event: 'The provider-native event, passed through untransformed.',
    name: 'Name of the custom/meta event, used by the frontend to route it.',
    value: 'Payload carried by the event; shape is defined by the emitting application.',
    // JSON Patch operation entries inside STATE_DELTA.delta[] — array hops do
    // not add a path segment, so the key is `delta.<field>`.
    'delta.op': 'JSON Patch (RFC 6902) operation to apply.',
    'delta.path': 'JSON Pointer to the target location in the state document.',
    'delta.value': 'Value for add/replace/test operations.',
    'delta.from': 'Source JSON Pointer for move/copy operations.',
};
// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------
exports.agUiRunStarted = {
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
exports.agUiRunFinished = {
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
exports.agUiRunError = {
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
exports.agUiStepStarted = {
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
exports.agUiStepFinished = {
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
exports.agUiTextMessageStart = {
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
exports.agUiTextMessageContent = {
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
exports.agUiTextMessageEnd = {
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
exports.agUiTextMessageChunk = {
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
exports.agUiToolCallStart = {
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
exports.agUiToolCallArgs = {
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
exports.agUiToolCallEnd = {
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
exports.agUiToolCallResult = {
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
exports.agUiToolCallChunk = {
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
exports.agUiStateSnapshot = {
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
exports.agUiStateDelta = {
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
                    // Explicit — mirrors the implicit JSON Schema default. RFC 6902
                    // allows implementation-specific extras on an operation object.
                    additionalProperties: true,
                },
            },
        },
        additionalProperties: true,
    },
};
exports.agUiMessagesSnapshot = {
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
exports.agUiActivitySnapshot = {
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
exports.agUiActivityDelta = {
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
exports.agUiReasoningMessageStart = {
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
exports.agUiReasoningMessageContent = {
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
exports.agUiReasoningMessageEnd = {
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
exports.agUiReasoningMessageChunk = {
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
exports.agUiReasoningStart = {
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
exports.agUiReasoningEnd = {
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
exports.agUiReasoningEncryptedValue = {
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
exports.agUiRaw = {
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
exports.agUiCustom = {
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
exports.agUiMetaEvent = {
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
exports.agUiDeclarations = [
    // Lifecycle
    exports.agUiRunStarted,
    exports.agUiRunFinished,
    exports.agUiRunError,
    exports.agUiStepStarted,
    exports.agUiStepFinished,
    // Text streaming
    exports.agUiTextMessageStart,
    exports.agUiTextMessageContent,
    exports.agUiTextMessageEnd,
    exports.agUiTextMessageChunk,
    // Tool calls
    exports.agUiToolCallStart,
    exports.agUiToolCallArgs,
    exports.agUiToolCallEnd,
    exports.agUiToolCallResult,
    exports.agUiToolCallChunk,
    // State
    exports.agUiStateSnapshot,
    exports.agUiStateDelta,
    exports.agUiMessagesSnapshot,
    // Activity
    exports.agUiActivitySnapshot,
    exports.agUiActivityDelta,
    // Reasoning
    exports.agUiReasoningMessageStart,
    exports.agUiReasoningMessageContent,
    exports.agUiReasoningMessageEnd,
    exports.agUiReasoningMessageChunk,
    exports.agUiReasoningStart,
    exports.agUiReasoningEnd,
    exports.agUiReasoningEncryptedValue,
    // Extensions
    exports.agUiRaw,
    exports.agUiCustom,
    exports.agUiMetaEvent,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.agUiDeclarations, FIELDS);
//# sourceMappingURL=ag-ui.js.map