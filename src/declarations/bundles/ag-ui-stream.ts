// src/declarations/bundles/ag-ui-stream.ts
//
// "ag-ui-stream" FeatureBundle — the AG-UI v0.1.x agent streaming protocol.
//
// AG-UI is the wire protocol between an agent backend and the browser
// (@connorhoehnslalom/ui-components/agents). A deployment either speaks it
// or does not; there is no partial adoption of the run/step/text/tool-call
// core, which is why the whole taxonomy is one bundle rather than seven.
//
// Sources: src/declarations/ag-ui.ts (and the ./ag-ui/ part files).
// Transport: all 29 events are 'signal' (ephemeral SSE/WS).
//
// Required vs optional:
//   required — the lifecycle, text-streaming, tool-call and state core that
//              every AG-UI agent emits.
//   optional — REASONING_* (only reasoning-capable models emit these) and
//              the RAW / CUSTOM / META_EVENT extension escape hatches, which
//              a conforming consumer must tolerate but a producer need not
//              emit. ACTIVITY_* is optional for the same reason: it is the
//              activity-feed extension, not part of the core turn loop.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'ag-ui-stream',
  version: '1.0.0',
  transport: 'signal',
  description:
    'AG-UI v0.1.x agent streaming protocol — run/step lifecycle, text-message and tool-call '
    + 'streaming, and state snapshots/deltas between an agent backend and the browser. '
    + 'Reasoning traces, activity deltas, and the RAW/CUSTOM/META_EVENT extensions are optional.',
  events: [
    // Run + step lifecycle
    { name: 'ag-ui.RUN_STARTED',                 required: true  },
    { name: 'ag-ui.RUN_FINISHED',                required: true  },
    { name: 'ag-ui.RUN_ERROR',                   required: true  },
    { name: 'ag-ui.STEP_STARTED',                required: true  },
    { name: 'ag-ui.STEP_FINISHED',               required: true  },
    // Text message streaming
    { name: 'ag-ui.TEXT_MESSAGE_START',          required: true  },
    { name: 'ag-ui.TEXT_MESSAGE_CONTENT',        required: true  },
    { name: 'ag-ui.TEXT_MESSAGE_END',            required: true  },
    { name: 'ag-ui.TEXT_MESSAGE_CHUNK',          required: true  },
    // Tool calls
    { name: 'ag-ui.TOOL_CALL_START',             required: true  },
    { name: 'ag-ui.TOOL_CALL_ARGS',              required: true  },
    { name: 'ag-ui.TOOL_CALL_END',               required: true  },
    { name: 'ag-ui.TOOL_CALL_RESULT',            required: true  },
    { name: 'ag-ui.TOOL_CALL_CHUNK',             required: true  },
    // Shared state
    { name: 'ag-ui.STATE_SNAPSHOT',              required: true  },
    { name: 'ag-ui.STATE_DELTA',                 required: true  },
    { name: 'ag-ui.MESSAGES_SNAPSHOT',           required: true  },
    // Activity feed extension
    { name: 'ag-ui.ACTIVITY_SNAPSHOT',           required: false },
    { name: 'ag-ui.ACTIVITY_DELTA',              required: false },
    // Reasoning traces — reasoning-capable models only
    { name: 'ag-ui.REASONING_MESSAGE_START',     required: false },
    { name: 'ag-ui.REASONING_MESSAGE_CONTENT',   required: false },
    { name: 'ag-ui.REASONING_MESSAGE_END',       required: false },
    { name: 'ag-ui.REASONING_MESSAGE_CHUNK',     required: false },
    { name: 'ag-ui.REASONING_START',             required: false },
    { name: 'ag-ui.REASONING_END',               required: false },
    { name: 'ag-ui.REASONING_ENCRYPTED_VALUE',   required: false },
    // Extension escape hatches
    { name: 'ag-ui.RAW',                         required: false },
    { name: 'ag-ui.CUSTOM',                      required: false },
    { name: 'ag-ui.META_EVENT',                  required: false },
  ],
};

export const agUiStreamBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
