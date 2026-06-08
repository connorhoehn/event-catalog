import type { EventDeclaration } from '../types/index';
export declare const pipelineImageVisionStarted: EventDeclaration;
/**
 * Per-token stream event during the vision call's response phase. Fires
 * once per `content_block_delta` text chunk from the Claude Code CLI's
 * stream-json output. Subscribers use this to render live typing in the
 * frontend (same pattern as `pipeline.llm.token`).
 *
 * Hot path — high volume. Subscribers MUST be cheap (in-memory state
 * mutation only; no IO, no network, no DDB). The handler dispatches
 * fire-and-forget so a slow subscriber can't backpressure the model loop.
 */
export declare const pipelineImageVisionToken: EventDeclaration;
export declare const pipelineImageVisionAnalyzed: EventDeclaration;
export declare const pipelineImageVisionFailed: EventDeclaration;
/**
 * All `pipeline:image:vision:*` declarations for bulk-registration by
 * consumers.
 */
export declare const pipelineImageVisionDeclarations: EventDeclaration[];
//# sourceMappingURL=pipeline-image-vision.d.ts.map