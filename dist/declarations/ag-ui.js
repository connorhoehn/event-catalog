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
//
// FILE LAYOUT (2026-09-07 decomposition — declarations unchanged, fingerprints
// identical): the seven categories now live one file each under `./ag-ui/`:
//   lifecycle.ts   RUN_* and STEP_*
//   text.ts        TEXT_MESSAGE_*
//   tool-calls.ts  TOOL_CALL_*
//   state.ts       STATE_SNAPSHOT / STATE_DELTA / MESSAGES_SNAPSHOT
//   activity.ts    ACTIVITY_SNAPSHOT / ACTIVITY_DELTA
//   reasoning.ts   REASONING_* (message stream, phase markers, encrypted value)
//   extensions.ts  RAW / CUSTOM / META_EVENT
// This module stays the single public entry point: it re-exports every
// declaration under its original name, owns the aggregate array in its
// original order, and — critically — owns the ONE `annotateDeclarations()`
// call and the local field glossary it applies. That glossary deliberately
// OVERRIDES the platform-wide wording for `type`, `delta`, `name`, `value`
// and friends, so keeping it beside the single call is what guarantees the
// split cannot silently change which override lands on which event. Never call
// `annotateDeclarations` from a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agUiDeclarations = exports.agUiMetaEvent = exports.agUiCustom = exports.agUiRaw = exports.agUiReasoningEncryptedValue = exports.agUiReasoningEnd = exports.agUiReasoningStart = exports.agUiReasoningMessageChunk = exports.agUiReasoningMessageEnd = exports.agUiReasoningMessageContent = exports.agUiReasoningMessageStart = exports.agUiActivityDelta = exports.agUiActivitySnapshot = exports.agUiMessagesSnapshot = exports.agUiStateDelta = exports.agUiStateSnapshot = exports.agUiToolCallChunk = exports.agUiToolCallResult = exports.agUiToolCallEnd = exports.agUiToolCallArgs = exports.agUiToolCallStart = exports.agUiTextMessageChunk = exports.agUiTextMessageEnd = exports.agUiTextMessageContent = exports.agUiTextMessageStart = exports.agUiStepFinished = exports.agUiStepStarted = exports.agUiRunError = exports.agUiRunFinished = exports.agUiRunStarted = void 0;
const field_glossary_1 = require("./field-glossary");
const lifecycle_1 = require("./ag-ui/lifecycle");
const text_1 = require("./ag-ui/text");
const tool_calls_1 = require("./ag-ui/tool-calls");
const state_1 = require("./ag-ui/state");
const activity_1 = require("./ag-ui/activity");
const reasoning_1 = require("./ag-ui/reasoning");
const extensions_1 = require("./ag-ui/extensions");
// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------
var lifecycle_2 = require("./ag-ui/lifecycle");
Object.defineProperty(exports, "agUiRunStarted", { enumerable: true, get: function () { return lifecycle_2.agUiRunStarted; } });
Object.defineProperty(exports, "agUiRunFinished", { enumerable: true, get: function () { return lifecycle_2.agUiRunFinished; } });
Object.defineProperty(exports, "agUiRunError", { enumerable: true, get: function () { return lifecycle_2.agUiRunError; } });
Object.defineProperty(exports, "agUiStepStarted", { enumerable: true, get: function () { return lifecycle_2.agUiStepStarted; } });
Object.defineProperty(exports, "agUiStepFinished", { enumerable: true, get: function () { return lifecycle_2.agUiStepFinished; } });
var text_2 = require("./ag-ui/text");
Object.defineProperty(exports, "agUiTextMessageStart", { enumerable: true, get: function () { return text_2.agUiTextMessageStart; } });
Object.defineProperty(exports, "agUiTextMessageContent", { enumerable: true, get: function () { return text_2.agUiTextMessageContent; } });
Object.defineProperty(exports, "agUiTextMessageEnd", { enumerable: true, get: function () { return text_2.agUiTextMessageEnd; } });
Object.defineProperty(exports, "agUiTextMessageChunk", { enumerable: true, get: function () { return text_2.agUiTextMessageChunk; } });
var tool_calls_2 = require("./ag-ui/tool-calls");
Object.defineProperty(exports, "agUiToolCallStart", { enumerable: true, get: function () { return tool_calls_2.agUiToolCallStart; } });
Object.defineProperty(exports, "agUiToolCallArgs", { enumerable: true, get: function () { return tool_calls_2.agUiToolCallArgs; } });
Object.defineProperty(exports, "agUiToolCallEnd", { enumerable: true, get: function () { return tool_calls_2.agUiToolCallEnd; } });
Object.defineProperty(exports, "agUiToolCallResult", { enumerable: true, get: function () { return tool_calls_2.agUiToolCallResult; } });
Object.defineProperty(exports, "agUiToolCallChunk", { enumerable: true, get: function () { return tool_calls_2.agUiToolCallChunk; } });
var state_2 = require("./ag-ui/state");
Object.defineProperty(exports, "agUiStateSnapshot", { enumerable: true, get: function () { return state_2.agUiStateSnapshot; } });
Object.defineProperty(exports, "agUiStateDelta", { enumerable: true, get: function () { return state_2.agUiStateDelta; } });
Object.defineProperty(exports, "agUiMessagesSnapshot", { enumerable: true, get: function () { return state_2.agUiMessagesSnapshot; } });
var activity_2 = require("./ag-ui/activity");
Object.defineProperty(exports, "agUiActivitySnapshot", { enumerable: true, get: function () { return activity_2.agUiActivitySnapshot; } });
Object.defineProperty(exports, "agUiActivityDelta", { enumerable: true, get: function () { return activity_2.agUiActivityDelta; } });
var reasoning_2 = require("./ag-ui/reasoning");
Object.defineProperty(exports, "agUiReasoningMessageStart", { enumerable: true, get: function () { return reasoning_2.agUiReasoningMessageStart; } });
Object.defineProperty(exports, "agUiReasoningMessageContent", { enumerable: true, get: function () { return reasoning_2.agUiReasoningMessageContent; } });
Object.defineProperty(exports, "agUiReasoningMessageEnd", { enumerable: true, get: function () { return reasoning_2.agUiReasoningMessageEnd; } });
Object.defineProperty(exports, "agUiReasoningMessageChunk", { enumerable: true, get: function () { return reasoning_2.agUiReasoningMessageChunk; } });
Object.defineProperty(exports, "agUiReasoningStart", { enumerable: true, get: function () { return reasoning_2.agUiReasoningStart; } });
Object.defineProperty(exports, "agUiReasoningEnd", { enumerable: true, get: function () { return reasoning_2.agUiReasoningEnd; } });
Object.defineProperty(exports, "agUiReasoningEncryptedValue", { enumerable: true, get: function () { return reasoning_2.agUiReasoningEncryptedValue; } });
var extensions_2 = require("./ag-ui/extensions");
Object.defineProperty(exports, "agUiRaw", { enumerable: true, get: function () { return extensions_2.agUiRaw; } });
Object.defineProperty(exports, "agUiCustom", { enumerable: true, get: function () { return extensions_2.agUiCustom; } });
Object.defineProperty(exports, "agUiMetaEvent", { enumerable: true, get: function () { return extensions_2.agUiMetaEvent; } });
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
// Exports
// ---------------------------------------------------------------------------
/** All 29 AG-UI v0.1.x event declarations. */
exports.agUiDeclarations = [
    // Lifecycle
    lifecycle_1.agUiRunStarted,
    lifecycle_1.agUiRunFinished,
    lifecycle_1.agUiRunError,
    lifecycle_1.agUiStepStarted,
    lifecycle_1.agUiStepFinished,
    // Text streaming
    text_1.agUiTextMessageStart,
    text_1.agUiTextMessageContent,
    text_1.agUiTextMessageEnd,
    text_1.agUiTextMessageChunk,
    // Tool calls
    tool_calls_1.agUiToolCallStart,
    tool_calls_1.agUiToolCallArgs,
    tool_calls_1.agUiToolCallEnd,
    tool_calls_1.agUiToolCallResult,
    tool_calls_1.agUiToolCallChunk,
    // State
    state_1.agUiStateSnapshot,
    state_1.agUiStateDelta,
    state_1.agUiMessagesSnapshot,
    // Activity
    activity_1.agUiActivitySnapshot,
    activity_1.agUiActivityDelta,
    // Reasoning
    reasoning_1.agUiReasoningMessageStart,
    reasoning_1.agUiReasoningMessageContent,
    reasoning_1.agUiReasoningMessageEnd,
    reasoning_1.agUiReasoningMessageChunk,
    reasoning_1.agUiReasoningStart,
    reasoning_1.agUiReasoningEnd,
    reasoning_1.agUiReasoningEncryptedValue,
    // Extensions
    extensions_1.agUiRaw,
    extensions_1.agUiCustom,
    extensions_1.agUiMetaEvent,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.agUiDeclarations, FIELDS);
//# sourceMappingURL=ag-ui.js.map