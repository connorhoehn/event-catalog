import type { EventDeclaration } from '../types/index';
export declare const pipelineRunStarted: EventDeclaration;
export declare const pipelineRunCompleted: EventDeclaration;
export declare const pipelineRunFailed: EventDeclaration;
export declare const pipelineRunOrphaned: EventDeclaration;
export declare const pipelineRunReassigned: EventDeclaration;
export declare const pipelineRunResumedFromStep: EventDeclaration;
export declare const pipelineRunStuck: EventDeclaration;
export declare const pipelineStepBreakpoint: EventDeclaration;
export declare const pipelineJoinWaiting: EventDeclaration;
export declare const pipelineJoinFired: EventDeclaration;
/**
 * All P1/P2 colon-form pipeline signal declarations introduced by EC-10.
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use. Pair with `pipelineP1Declarations` from
 * EC-2 to register the full DC `PipelineEventMap` minus EC-1's approval
 * + checkpoint trio.
 */
export declare const pipelineP2Declarations: EventDeclaration[];
//# sourceMappingURL=pipeline-p2.d.ts.map