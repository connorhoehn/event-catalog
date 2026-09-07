import type { EventDeclaration } from '../../types/index';
/** Subscription confirmation for a pipeline channel. */
export declare const wsPipelineSubscribed: EventDeclaration;
/** Unsubscription confirmation for a pipeline channel. */
export declare const wsPipelineUnsubscribed: EventDeclaration;
/**
 * Acknowledgement frame for client-initiated pipeline actions
 * (trigger, cancel, resolveApproval, resumeFromStep, resolveBreakpoint).
 * Note: frame type is `pipeline:ack`.
 */
export declare const wsPipelineAck: EventDeclaration;
/**
 * Pipeline run state snapshot sent in response to a `getRun` request.
 * Note: frame type is `pipeline:snapshot`.
 */
export declare const wsPipelineSnapshot: EventDeclaration;
/**
 * BusEvent history for a run, sent in response to a `getHistory` request.
 * Note: frame type is `pipeline:history`.
 */
export declare const wsPipelineHistory: EventDeclaration;
/**
 * Pipeline BusEvent broadcast to channel subscribers by PipelineBridge.
 * Note: frame type is `pipeline:event`.
 */
export declare const wsPipelineEvent: EventDeclaration;
//# sourceMappingURL=pipeline.d.ts.map