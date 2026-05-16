// src/declarations/index.ts
//
// Aggregated declarations exported by `@connorhoehn/event-catalog` for
// platform-wide cross-service events. Consumers `import { pipelineDeclarations }`
// (or individual constants) and feed them into `catalog.declare()` at boot.
//
// This module is the canonical home for events whose producer is a library
// (e.g. `distributed-core`) and therefore has no single service that can
// own its declaration. Service-owned events still live in the producing
// service's own source tree per the charter.

export {
  pipelineApprovalRequested,
  pipelineApprovalRecorded,
  pipelineRunCheckpoint,
  pipelineDeclarations,
} from './pipeline';

export {
  pipelineP1Declarations,
} from './pipeline-p1';

export {
  pipelineRunStarted,
  pipelineRunCompleted,
  pipelineRunFailed,
  pipelineRunOrphaned,
  pipelineRunReassigned,
  pipelineRunResumedFromStep,
  pipelineRunRetry,
  pipelineRunStuck,
  pipelineStepBreakpoint,
  pipelineJoinWaiting,
  pipelineJoinFired,
  pipelineP2Declarations,
} from './pipeline-p2';

export {
  pipelineRaftRunStarted,
  pipelineRaftRunUpdated,
  pipelineRaftRunSynthesized,
  pipelineRaftRunCheckpointed,
  pipelineRaftRunTerminated,
  pipelineRaftDeclarations,
  pipelineRaftStateMachineDeclarations,
} from './pipeline-raft';

export { gatewaySignalDeclarations } from './gateway-signal';

export {
  pipelineEventDeclarations,
} from './pipeline-events';

export { agUiDeclarations } from './ag-ui';

import type { EventDeclaration } from '../types/index';
import { pipelineDeclarations } from './pipeline';
import { pipelineP1Declarations } from './pipeline-p1';
import { pipelineP2Declarations } from './pipeline-p2';
import { pipelineRaftDeclarations } from './pipeline-raft';
import { gatewaySignalDeclarations } from './gateway-signal';
import { agUiDeclarations } from './ag-ui';

/**
 * The flat set of every event this repo declares on behalf of producers
 * that don't import event-catalog directly (distributed-core et al).
 * Used by `scripts/regen-registry-snapshot.ts` to build the shipped
 * `contracts/registry.snapshot.json` that producer CI compares against.
 *
 * Each event name appears exactly once. Convenience re-exports
 * (pipelineEventDeclarations, pipelineRaftStateMachineDeclarations) are
 * excluded here because their events are already covered by the canonical
 * per-phase arrays above — including them would produce silent duplicates.
 */
export const allDeclarations: readonly EventDeclaration[] = [
  ...pipelineDeclarations,
  ...pipelineP1Declarations,
  ...pipelineP2Declarations,
  ...pipelineRaftDeclarations,
  ...gatewaySignalDeclarations,
  ...agUiDeclarations,
];
