// src/declarations/bundles/agentic-pipeline-signal.ts
//
// "agentic-pipeline-signal" FeatureBundle — pipeline WS lifecycle events.
//
// Transport is 'signal': all events use the in-process signal bus and are
// delivered over WebSocket frames. This bundle covers the real-time
// observability surface (run, step, join, breakpoint events).
//
// Approval and audit events have transport 'both' / 'durable' and live in
// the companion `agentic-pipeline-durable` bundle so apps that only need
// signaling can subscribe to this bundle alone.
//
// Supersedes: agentic-pipeline@1.0.0 (deprecated v0.3.45)
// Sources: pipeline-p1.ts, pipeline-p2.ts.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'agentic-pipeline-signal',
  version: '1.0.0',
  transport: 'signal',
  description:
    'Pipeline WS lifecycle events — run, step, join, and breakpoint events for agentic '
    + 'pipelines. Signal-only; approval and audit events live in agentic-pipeline-durable. '
    + 'Supersedes the deprecated agentic-pipeline@1.0.0 bundle.',
  events: [
    // Run lifecycle (pipeline-p2.ts)
    { name: 'pipeline:run:started',           required: true  },
    { name: 'pipeline:run:completed',         required: true  },
    { name: 'pipeline:run:failed',            required: true  },
    { name: 'pipeline:run:cancelled',         required: true  },
    { name: 'pipeline:run:paused',            required: true  },
    { name: 'pipeline:run:resumed',           required: true  },
    { name: 'pipeline:run:retry',             required: true  },
    { name: 'pipeline:run:stuck',             required: true  },
    { name: 'pipeline:run:orphaned',          required: false },
    { name: 'pipeline:run:reassigned',        required: false },
    // Step lifecycle (pipeline-p1.ts)
    { name: 'pipeline:step:started',          required: true  },
    { name: 'pipeline:step:completed',        required: true  },
    { name: 'pipeline:step:failed',           required: true  },
    { name: 'pipeline:step:skipped',          required: false },
    { name: 'pipeline:step:cancelled',        required: false },
    { name: 'pipeline:step:breakpoint',       required: false },
    { name: 'pipeline:step:heartbeat',        required: false },
    // Join gates (pipeline-p2.ts)
    { name: 'pipeline:join:waiting',          required: false },
    { name: 'pipeline:join:fired',            required: false },
  ],
};

export const agenticPipelineSignalBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
