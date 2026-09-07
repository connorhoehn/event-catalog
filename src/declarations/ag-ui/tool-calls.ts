// src/declarations/ag-ui/tool-calls.ts
//
// AG-UI tool-call events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
