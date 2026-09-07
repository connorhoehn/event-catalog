// src/declarations/ag-ui/activity.ts
//
// AG-UI activity-feed events.
//
// Split out of the former single-file `ag-ui.ts`.
//
// RECONCILED 2026-09-07 (declared-vs-emitted audit). Both declarations were
// transcribed from the upstream AG-UI v0.1.x spec, which models the activity
// feed as a whole-feed `snapshot` array plus a `delta` array. The only
// producer the platform has — `AgentStream` in realtime-modules — has never
// built that shape: it addresses ONE feed entry at a time, keyed by
// `messageId`, and carries the body in `content` / `patch`. Both events
// therefore required a field no producer assigns, so the real frame failed
// validation and could never have been published. The schemas below describe
// the frame AgentStream actually constructs; `snapshot` and `delta` stay
// declared-but-optional because removing a property is breaking under this
// repo's own compat gate.

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
  description:
    'Full replacement of ONE activity-feed entry (a tool call, a reasoning trace, a sub-step). '
    + 'GROUND TRUTH (realtime-modules:src/agent-streaming/AgentStream.ts:321 `activitySnapshot`): '
    + '{ type, messageId, activityType, content, replace?, timestamp }. The entry is addressed by '
    + '`messageId`; this is NOT the upstream AG-UI spec\'s whole-feed `snapshot` array, which no '
    + 'producer has ever sent.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'ACTIVITY_SNAPSHOT' },
      messageId: {},
      activityType: {
        type: 'string',
        description:
          'Kind of activity this feed entry represents (e.g. "search", "tool"), chosen by the emitting agent.',
      },
      content: {
        description:
          'Full current body of this activity entry. Replaces whatever the consumer has rendered for the same messageId.',
      },
      replace: {
        type: 'boolean',
        description:
          'Whether the consumer should replace an existing entry rather than append a new one. Absent when the producer did not set it.',
      },
      timestamp: {
        type: 'number',
        description:
          'Epoch milliseconds at which AgentStream emitted the frame (its injectable `now()`, defaulting to Date.now()). Not an ISO string.',
      },
      snapshot: {
        type: 'array',
        items: {},
        description:
          'NEVER EMITTED — the upstream AG-UI whole-feed array. AgentStream sends one entry at a time '
          + '({ messageId, activityType, content }), so nothing has ever assigned this. Declared-but-optional '
          + 'only because removing a property is breaking; do not re-add it to `required`.',
      },
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
  description:
    'Incremental update to ONE activity-feed entry. GROUND TRUTH '
    + '(realtime-modules:src/agent-streaming/AgentStream.ts:337 `activityDelta`): '
    + '{ type, messageId, activityType, patch, timestamp }. The update rides on `patch`, not on the '
    + 'upstream AG-UI spec\'s `delta` array, which no producer has ever sent.',
  schema: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', const: 'ACTIVITY_DELTA' },
      messageId: {},
      activityType: {
        type: 'string',
        description:
          'Kind of activity this feed entry represents (e.g. "search", "tool"), chosen by the emitting agent.',
      },
      patch: {
        description:
          'Producer-defined incremental update to apply to the entry named by messageId. Shape is agent-specific and deliberately unconstrained.',
      },
      timestamp: {
        type: 'number',
        description:
          'Epoch milliseconds at which AgentStream emitted the frame (its injectable `now()`, defaulting to Date.now()). Not an ISO string.',
      },
      delta: {
        type: 'array',
        items: {},
        description:
          'NEVER EMITTED — the upstream AG-UI delta array. AgentStream carries its incremental update on '
          + '`patch` instead. Declared-but-optional only because removing a property is breaking; do not '
          + 're-add it to `required`.',
      },
    },
    additionalProperties: true,
  },
};
