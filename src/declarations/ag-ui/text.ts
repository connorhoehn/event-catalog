// src/declarations/ag-ui/text.ts
//
// AG-UI streamed text-message events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
