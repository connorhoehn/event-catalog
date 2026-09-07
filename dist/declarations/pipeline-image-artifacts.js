"use strict";
// src/declarations/pipeline-image-artifacts.ts
//
// `pipeline:step:image:produced` — the per-step image artifact signal.
//
// DECLARED 2026-09-07 by the declared-vs-emitted-vs-read audit. Fifteen
// platform-api step handlers emit it and the run-detail reducer branches on
// it; nothing declared it. It is distinct from the `pipeline:image:vision:*`
// family in ./pipeline-image-vision.ts, which reports the LLM CALL — this
// event reports the IMAGE.
//
// PRODUCERS — every platform-api handler that materialises an image into the
// ImageBlobStore, emitted through `helpers.emit(...)` inside a try/catch so a
// bad subscriber can never kill the step:
//   ImageSourceStepHandler.ts:109      ImageCropStepHandler.ts:228
//   ImageResizeStepHandler.ts:178      ImageAdjustLayerStepHandler.ts:179
//   ImageAdjustBwStepHandler.ts:172    ImageSharpenStepHandler.ts:161
//   ImageWatermarkStepHandler.ts:248   ImageUpscaleStepHandler.ts:151
//   ImageGenerateStepHandler.ts:207    ImageVariationStepHandler.ts:207
//   ImageEditPromptStepHandler.ts:256  ImageFormatConvertStepHandler.ts:206
//   ImageGeometricTransformStepHandler.ts:178
//   ImageSaveStepHandler.ts:117        visionHandlerFactory.ts:336
// All fifteen build the same literal: `{ runId, stepId, imageId, width,
// height, mimeType, at }`, with `width`/`height`/`mimeType` read straight off
// `ImageBlobStore.getMetadata()`'s `ImageMeta` (platform-api:src/pipeline/
// image/types.ts:164), where all three are non-optional. Only the crop handler
// adds `bbox`, and it does so in SOURCE-image coordinates.
//
// The declaration mirrors distributed-core's own PipelineEventMap entry at
// distributed-core:src/applications/pipeline/types.ts:1065 — DC types the
// event even though it never emits it, because the handlers run under its
// executor.
//
// CONSUMER — realtime-examples:frontend/src/components/pipelines/context/
// PipelineRunsContext.tsx:697 appends one ImagePreview per event to the
// producing step's `images[]`, so a node body can render a thumbnail BEFORE
// the terminal `pipeline:step:completed` arrives. It dedups on `imageId`
// against the step's existing previews, which is what makes re-delivery on a
// gateway reconnect harmless — and which makes `imageId` the one field that
// is load-bearing rather than decorative.
//
// TRANSPORT — `signal`. The event exists to beat the step's own completion
// event to the UI; by the time a durable consumer could read it, the step
// output already carries the same imageId. The bytes are in the blob store
// either way, so there is nothing here that survives being dropped.
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineImageArtifactDeclarations = exports.pipelineStepImageProduced = void 0;
const field_glossary_1 = require("./field-glossary");
const PRODUCER = 'platform-api';
const TAGS_BASE = ['pipeline', 'image', 'producer:platform-api'];
/** Image-artifact field meanings; the rest come from the common glossary. */
const FIELDS = {
    imageId: 'Identifier of the image in the ImageBlobStore. The dedup key the run-detail reducer uses.',
};
exports.pipelineStepImageProduced = {
    namespace: 'pipeline',
    name: 'pipeline:step:image:produced',
    transport: 'signal',
    producer: PRODUCER,
    description: 'A pipeline step materialised an image artifact into the blob store. Emitted by every '
        + 'platform-api image handler (source, crop, resize, adjust, sharpen, watermark, upscale, '
        + 'generate, variation, edit-prompt, format-convert, geometric-transform, save) and by the '
        + 'vision handler factory, BEFORE the step\'s terminal pipeline:step:completed, so the run '
        + 'view can render the thumbnail inline while the step is still running.',
    tags: [...TAGS_BASE, 'step-lifecycle', 'artifact'],
    schema: {
        type: 'object',
        properties: {
            runId: { type: 'string' },
            stepId: { type: 'string' },
            imageId: { type: 'string' },
            width: { type: 'integer', description: 'Width of the produced image in pixels, from the blob store metadata.' },
            height: { type: 'integer', description: 'Height of the produced image in pixels, from the blob store metadata.' },
            mimeType: { type: 'string' },
            bbox: {
                type: 'object',
                description: 'Crop rectangle in SOURCE-image coordinates. Emitted by the crop handler alone; absent on every other producer.',
                properties: {
                    x: { type: 'number', description: 'Left edge of the crop rectangle, in source-image pixels.' },
                    y: { type: 'number', description: 'Top edge of the crop rectangle, in source-image pixels.' },
                    width: { type: 'number', description: 'Width of the crop rectangle, in source-image pixels.' },
                    height: { type: 'number', description: 'Height of the crop rectangle, in source-image pixels.' },
                },
                required: ['x', 'y', 'width', 'height'],
                additionalProperties: true,
            },
            at: { type: 'string', description: 'ISO-8601 timestamp at which the handler announced the artifact.' },
        },
        required: ['runId', 'stepId', 'imageId', 'width', 'height', 'mimeType', 'at'],
        additionalProperties: true,
    },
};
// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------
/** Per-step image artifact declarations for bulk-registration by consumers. */
exports.pipelineImageArtifactDeclarations = [
    exports.pipelineStepImageProduced,
];
// Stamp the shared field vocabulary onto every schema above (additive —
// fills absent property descriptions only). See ./field-glossary.ts.
(0, field_glossary_1.annotateDeclarations)(exports.pipelineImageArtifactDeclarations, FIELDS);
//# sourceMappingURL=pipeline-image-artifacts.js.map