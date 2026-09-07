// src/declarations/ag-ui/lifecycle.ts
//
// AG-UI run and step lifecycle events.
//
// Split out of the former single-file `ag-ui.ts`; declarations unchanged.

import type { EventDeclaration } from '../../types/index';
import { PRODUCER, NAMESPACE, TAGS } from './_shared';

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export const agUiRunStarted: EventDeclaration = {
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

export const agUiRunFinished: EventDeclaration = {
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

export const agUiRunError: EventDeclaration = {
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

export const agUiStepStarted: EventDeclaration = {
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

export const agUiStepFinished: EventDeclaration = {
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
