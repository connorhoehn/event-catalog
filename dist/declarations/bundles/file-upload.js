"use strict";
// src/declarations/bundles/file-upload.ts
//
// "file-upload" FeatureBundle — file upload lifecycle.
//
// Transport is 'signal': presigned URL issuance acknowledgement and all
// upload progress / scan results are delivered via WebSocket push frames.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileUploadBundle = void 0;
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const _def = {
    name: 'file-upload',
    version: '1.0.0',
    transport: 'signal',
    description: 'File upload lifecycle — presigned URL flow (REST) with upload progress and scan-result delivery via WebSocket.',
    events: [
        { name: 'ws.upload.requested', required: true },
        { name: 'ws.upload.url-issued', required: true },
        { name: 'ws.upload.completed', required: true },
        { name: 'ws.upload.failed', required: true },
        { name: 'ws.upload.scanned', required: true },
        // Security enforcement outcomes
        { name: 'ws.upload.scan-quarantined', required: true },
        { name: 'ws.upload.url-revoked', required: true },
        { name: 'ws.error', required: false },
    ],
};
exports.fileUploadBundle = {
    ..._def,
    fingerprint: (0, FeatureBundle_js_1.computeFingerprint)(_def),
};
//# sourceMappingURL=file-upload.js.map