// src/declarations/bundles/agentic-pipeline.ts
//
// "agentic-pipeline" FeatureBundle — pipeline lifecycle and step events.
//
// Transport is 'signal': all pipeline lifecycle events use the in-process signal
// bus. Approval events (pipeline.approval.*) have transport 'both' and are
// intentionally excluded here to keep this bundle transport-coherent.
// Canonical names use the colon-separated form (pipeline:* namespace);
// dot-form aliases exist for backward compat but are deprecated.
//
// Sources: pipeline-p1.ts, pipeline-p2.ts.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'agentic-pipeline',
  version: '1.0.0',
  transport: 'signal',
  description: 'Pipeline lifecycle and step events — run, step, join, and breakpoint events for agentic pipelines. Approval events (pipeline.approval.*) use transport both and are tracked separately.',
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
    // TODO: pipeline:run:trigger not yet declared in the catalog
    // (design doc calls this "trigger"; pipeline:run:started is the closest)
    // { name: 'pipeline:run:trigger',         required: false },
  ],
};

export const agenticPipelineBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
