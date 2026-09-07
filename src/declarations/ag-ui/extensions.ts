// src/declarations/ag-ui/extensions.ts
//
// AG-UI extension events — the protocol's escape hatches.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
