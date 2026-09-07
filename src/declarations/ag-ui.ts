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


import type { EventDeclaration } from '../types/index';
import { annotateDeclarations, type FieldGlossary } from './field-glossary';

import {
  agUiRunStarted,
  agUiRunFinished,
  agUiRunError,
  agUiStepStarted,
  agUiStepFinished,
} from './ag-ui/lifecycle';
import {
  agUiTextMessageStart,
  agUiTextMessageContent,
  agUiTextMessageEnd,
  agUiTextMessageChunk,
} from './ag-ui/text';
import {
  agUiToolCallStart,
  agUiToolCallArgs,
  agUiToolCallEnd,
  agUiToolCallResult,
  agUiToolCallChunk,
} from './ag-ui/tool-calls';
import {
  agUiStateSnapshot,
  agUiStateDelta,
  agUiMessagesSnapshot,
} from './ag-ui/state';
import {
  agUiActivitySnapshot,
  agUiActivityDelta,
} from './ag-ui/activity';
import {
  agUiReasoningMessageStart,
  agUiReasoningMessageContent,
  agUiReasoningMessageEnd,
  agUiReasoningMessageChunk,
  agUiReasoningStart,
  agUiReasoningEnd,
  agUiReasoningEncryptedValue,
} from './ag-ui/reasoning';
import {
  agUiRaw,
  agUiCustom,
  agUiMetaEvent,
} from './ag-ui/extensions';

// ---------------------------------------------------------------------------
// Public surface — every declaration, under the name it has always had.
// ---------------------------------------------------------------------------

export {
  agUiRunStarted,
  agUiRunFinished,
  agUiRunError,
  agUiStepStarted,
  agUiStepFinished,
} from './ag-ui/lifecycle';
export {
  agUiTextMessageStart,
  agUiTextMessageContent,
  agUiTextMessageEnd,
  agUiTextMessageChunk,
} from './ag-ui/text';
export {
  agUiToolCallStart,
  agUiToolCallArgs,
  agUiToolCallEnd,
  agUiToolCallResult,
  agUiToolCallChunk,
} from './ag-ui/tool-calls';
export {
  agUiStateSnapshot,
  agUiStateDelta,
  agUiMessagesSnapshot,
} from './ag-ui/state';
export {
  agUiActivitySnapshot,
  agUiActivityDelta,
} from './ag-ui/activity';
export {
  agUiReasoningMessageStart,
  agUiReasoningMessageContent,
  agUiReasoningMessageEnd,
  agUiReasoningMessageChunk,
  agUiReasoningStart,
  agUiReasoningEnd,
  agUiReasoningEncryptedValue,
} from './ag-ui/reasoning';
export {
  agUiRaw,
  agUiCustom,
  agUiMetaEvent,
} from './ag-ui/extensions';

/**
 * AG-UI protocol field meanings. `type`, `delta` and friends mean something
 * different here than on the gateway's WS frames, so this module overrides
 * them rather than inheriting the common glossary's wording.
 */
const FIELDS: FieldGlossary = {
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

// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
annotateDeclarations(agUiDeclarations, FIELDS);
