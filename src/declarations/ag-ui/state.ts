// src/declarations/ag-ui/state.ts
//
// AG-UI state and message-history snapshot/delta events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
          // Explicit — mirrors the implicit JSON Schema default. RFC 6902
          // allows implementation-specific extras on an operation object.
          additionalProperties: true,
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
