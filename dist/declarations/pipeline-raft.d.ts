import type { EventDeclaration } from '../types/index';
export declare const pipelineRaftRunStarted: EventDeclaration;
export declare const pipelineRaftRunUpdated: EventDeclaration;
export declare const pipelineRaftRunSynthesized: EventDeclaration;
export declare const pipelineRaftRunCheckpointed: EventDeclaration;
export declare const pipelineRaftRunTerminated: EventDeclaration;
/**
 * All pipeline:raft:run:* signal declarations (wave9-d).
 *
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use. These events are produced by platform-api's
 * PipelineRaftStateMachine — not by distributed-core's PipelineExecutor.
 */
export declare const pipelineRaftDeclarations: EventDeclaration[];
//# sourceMappingURL=pipeline-raft.d.ts.map