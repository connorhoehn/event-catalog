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
/**
 * The four state-machine transition events emitted by PipelineRaftStateMachine
 * (wave20-a). Excludes `pipeline:raft:run:started` which is a slot-creation
 * event. Consumers that only care about post-create state transitions should
 * register from this list.
 *
 * Corresponds to the 4 Raft SM events listed in the wave20 task spec:
 *   - pipeline:raft:run:synthesized
 *   - pipeline:raft:run:updated
 *   - pipeline:raft:run:checkpointed
 *   - pipeline:raft:run:terminated
 */
export declare const pipelineRaftStateMachineDeclarations: EventDeclaration[];
//# sourceMappingURL=pipeline-raft.d.ts.map