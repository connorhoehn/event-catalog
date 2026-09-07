// src/declarations/ag-ui/reasoning.ts
//
// AG-UI reasoning-trace events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
  description:
    'Carries an encrypted reasoning payload (provider-specific format). GROUND TRUTH '
    + '(realtime-modules:src/agent-streaming/AgentStream.ts:420 `reasoningEncryptedValue`): '
    + '{ type, subtype, entityId, encryptedValue, timestamp }. The ciphertext rides on '
    + '`encryptedValue`, not on the upstream AG-UI spec\'s `value`, which no producer has ever sent.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'REASONING_ENCRYPTED_VALUE' },
      subtype: {
        type: 'string',
        description:
          'Provider-specific kind of encrypted reasoning artifact, so a consumer can route it without decrypting.',
      },
      entityId: {
        type: 'string',
        description:
          'Identifier of the reasoning entity this ciphertext belongs to, used to correlate it with the surrounding trace.',
      },
      encryptedValue: {
        type: 'string',
        description: 'Opaque encrypted bytes, in whatever encoding the provider uses.',
      },
      timestamp: {
        type: 'number',
        description:
          'Epoch milliseconds at which AgentStream emitted the frame (its injectable `now()`, defaulting to Date.now()). Not an ISO string.',
      },
      value: {
        type: 'string',
        description:
          'NEVER EMITTED — the upstream AG-UI spec\'s ciphertext field. AgentStream sends '
          + '`encryptedValue` instead. Declared-but-optional only because removing a property is '
          + 'breaking; do not re-add it to `required`.',
      },
    },
    additionalProperties: true,
  },
};
