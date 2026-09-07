// src/declarations/ag-ui/activity.ts
//
// AG-UI activity-feed events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

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
