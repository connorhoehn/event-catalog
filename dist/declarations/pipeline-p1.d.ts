import type { EventDeclaration } from '../types/index';
export declare const pipelineRunCancelled: EventDeclaration;
export declare const pipelineRunPaused: EventDeclaration;
export declare const pipelineRunResumed: EventDeclaration;
export declare const pipelineStepStarted: EventDeclaration;
export declare const pipelineStepCompleted: EventDeclaration;
export declare const pipelineStepFailed: EventDeclaration;
export declare const pipelineStepSkipped: EventDeclaration;
export declare const pipelineStepCancelled: EventDeclaration;
export declare const pipelineStepHeartbeat: EventDeclaration;
export declare const pipelineStepAttemptStarted: EventDeclaration;
export declare const pipelineStepAttemptFailed: EventDeclaration;
export declare const pipelineLlmPrompt: EventDeclaration;
export declare const pipelineLlmToken: EventDeclaration;
export declare const pipelineLlmResponse: EventDeclaration;
export declare const pipelineLlmStreamOpened: EventDeclaration;
export declare const pipelineContextPatched: EventDeclaration;
export declare const pipelineContextPatchedUnvalidated: EventDeclaration;
export declare const pipelineContextPatchReverted: EventDeclaration;
/**
 * All P1 colon-form pipeline signal declarations exported by this module.
 * Consumers may iterate this list to bulk-register, or import individual
 * constants for selective use.
 */
export declare const pipelineP1Declarations: EventDeclaration[];
//# sourceMappingURL=pipeline-p1.d.ts.map