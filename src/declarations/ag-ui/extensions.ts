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
  description:
    'Protocol metadata event (e.g. heartbeats, version negotiation). GROUND TRUTH '
    + '(realtime-modules:src/agent-streaming/AgentStream.ts:448 `meta`): '
    + '{ type, metaType, payload, timestamp }. The discriminator is `metaType`, not the upstream '
    + 'AG-UI spec\'s `name`, which no producer has ever sent.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'META_EVENT' },
      metaType: {
        type: 'string',
        description:
          'Kind of protocol metadata this frame carries (e.g. "trace", "heartbeat"). The routing key a consumer switches on.',
      },
      payload: {
        description:
          'Metadata body for this metaType. Shape is defined by the emitting agent and deliberately unconstrained.',
      },
      timestamp: {
        type: 'number',
        description:
          'Epoch milliseconds at which AgentStream emitted the frame (its injectable `now()`, defaulting to Date.now()). Not an ISO string.',
      },
      name: {
        type: 'string',
        description:
          'NEVER EMITTED — the upstream AG-UI spec\'s meta discriminator. AgentStream sends `metaType` '
          + 'instead. Declared-but-optional only because removing a property is breaking; do not re-add '
          + 'it to `required`.',
      },
    },
    additionalProperties: true,
  },
};
