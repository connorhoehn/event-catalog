"use strict";
// src/declarations/bundles/index.ts
//
// Aggregate re-export for all declared FeatureBundles.
// Importing this module at boot time registers the bundles in the
// module-level singleton via registerFeatureBundle().
Object.defineProperty(exports, "__esModule", { value: true });
exports.allBundles = exports.gatewaySessionBundle = exports.sfuChatBundle = exports.sfuControlPlaneBundle = exports.sfuWebhooksBundle = exports.callCaptionsBundle = exports.agUiStreamBundle = exports.orgiqNewsroomBundle = exports.notificationsBundle = exports.fileUploadBundle = exports.documentCallsBundle = exports.videoHangoutBundle = exports.crdtDocumentDurabilityBundle = exports.crdtDocumentBundle = exports.agenticPipelineDurableBundle = exports.agenticPipelineSignalBundle = exports.agenticPipelineBundle = exports.activityBundle = exports.reactionsBundle = exports.cursorBundle = exports.presenceBundle = exports.chatBundle = void 0;
var chat_js_1 = require("./chat.js");
Object.defineProperty(exports, "chatBundle", { enumerable: true, get: function () { return chat_js_1.chatBundle; } });
var presence_js_1 = require("./presence.js");
Object.defineProperty(exports, "presenceBundle", { enumerable: true, get: function () { return presence_js_1.presenceBundle; } });
var cursor_js_1 = require("./cursor.js");
Object.defineProperty(exports, "cursorBundle", { enumerable: true, get: function () { return cursor_js_1.cursorBundle; } });
var reactions_js_1 = require("./reactions.js");
Object.defineProperty(exports, "reactionsBundle", { enumerable: true, get: function () { return reactions_js_1.reactionsBundle; } });
var activity_js_1 = require("./activity.js");
Object.defineProperty(exports, "activityBundle", { enumerable: true, get: function () { return activity_js_1.activityBundle; } });
// Deprecated: use agenticPipelineSignalBundle + agenticPipelineDurableBundle instead.
var agentic_pipeline_js_1 = require("./agentic-pipeline.js");
Object.defineProperty(exports, "agenticPipelineBundle", { enumerable: true, get: function () { return agentic_pipeline_js_1.agenticPipelineBundle; } });
var agentic_pipeline_signal_js_1 = require("./agentic-pipeline-signal.js");
Object.defineProperty(exports, "agenticPipelineSignalBundle", { enumerable: true, get: function () { return agentic_pipeline_signal_js_1.agenticPipelineSignalBundle; } });
var agentic_pipeline_durable_js_1 = require("./agentic-pipeline-durable.js");
Object.defineProperty(exports, "agenticPipelineDurableBundle", { enumerable: true, get: function () { return agentic_pipeline_durable_js_1.agenticPipelineDurableBundle; } });
var crdt_document_js_1 = require("./crdt-document.js");
Object.defineProperty(exports, "crdtDocumentBundle", { enumerable: true, get: function () { return crdt_document_js_1.crdtDocumentBundle; } });
Object.defineProperty(exports, "crdtDocumentDurabilityBundle", { enumerable: true, get: function () { return crdt_document_js_1.crdtDocumentDurabilityBundle; } });
var video_hangout_js_1 = require("./video-hangout.js");
Object.defineProperty(exports, "videoHangoutBundle", { enumerable: true, get: function () { return video_hangout_js_1.videoHangoutBundle; } });
var document_calls_js_1 = require("./document-calls.js");
Object.defineProperty(exports, "documentCallsBundle", { enumerable: true, get: function () { return document_calls_js_1.documentCallsBundle; } });
var file_upload_js_1 = require("./file-upload.js");
Object.defineProperty(exports, "fileUploadBundle", { enumerable: true, get: function () { return file_upload_js_1.fileUploadBundle; } });
var notifications_js_1 = require("./notifications.js");
Object.defineProperty(exports, "notificationsBundle", { enumerable: true, get: function () { return notifications_js_1.notificationsBundle; } });
var orgiq_newsroom_js_1 = require("./orgiq-newsroom.js");
Object.defineProperty(exports, "orgiqNewsroomBundle", { enumerable: true, get: function () { return orgiq_newsroom_js_1.orgiqNewsroomBundle; } });
var ag_ui_stream_js_1 = require("./ag-ui-stream.js");
Object.defineProperty(exports, "agUiStreamBundle", { enumerable: true, get: function () { return ag_ui_stream_js_1.agUiStreamBundle; } });
var call_captions_js_1 = require("./call-captions.js");
Object.defineProperty(exports, "callCaptionsBundle", { enumerable: true, get: function () { return call_captions_js_1.callCaptionsBundle; } });
var sfu_webhooks_js_1 = require("./sfu-webhooks.js");
Object.defineProperty(exports, "sfuWebhooksBundle", { enumerable: true, get: function () { return sfu_webhooks_js_1.sfuWebhooksBundle; } });
var sfu_control_plane_js_1 = require("./sfu-control-plane.js");
Object.defineProperty(exports, "sfuControlPlaneBundle", { enumerable: true, get: function () { return sfu_control_plane_js_1.sfuControlPlaneBundle; } });
var sfu_chat_js_1 = require("./sfu-chat.js");
Object.defineProperty(exports, "sfuChatBundle", { enumerable: true, get: function () { return sfu_chat_js_1.sfuChatBundle; } });
var gateway_session_js_1 = require("./gateway-session.js");
Object.defineProperty(exports, "gatewaySessionBundle", { enumerable: true, get: function () { return gateway_session_js_1.gatewaySessionBundle; } });
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const chat_js_2 = require("./chat.js");
const presence_js_2 = require("./presence.js");
const cursor_js_2 = require("./cursor.js");
const reactions_js_2 = require("./reactions.js");
const activity_js_2 = require("./activity.js");
const agentic_pipeline_js_2 = require("./agentic-pipeline.js");
const agentic_pipeline_signal_js_2 = require("./agentic-pipeline-signal.js");
const agentic_pipeline_durable_js_2 = require("./agentic-pipeline-durable.js");
const crdt_document_js_2 = require("./crdt-document.js");
const video_hangout_js_2 = require("./video-hangout.js");
const document_calls_js_2 = require("./document-calls.js");
const file_upload_js_2 = require("./file-upload.js");
const notifications_js_2 = require("./notifications.js");
const gateway_session_js_2 = require("./gateway-session.js");
const orgiq_newsroom_js_2 = require("./orgiq-newsroom.js");
const ag_ui_stream_js_2 = require("./ag-ui-stream.js");
const call_captions_js_2 = require("./call-captions.js");
const sfu_webhooks_js_2 = require("./sfu-webhooks.js");
const sfu_control_plane_js_2 = require("./sfu-control-plane.js");
const sfu_chat_js_2 = require("./sfu-chat.js");
/** All v1 bundle definitions, in declaration order. */
exports.allBundles = [
    chat_js_2.chatBundle,
    presence_js_2.presenceBundle,
    cursor_js_2.cursorBundle,
    reactions_js_2.reactionsBundle,
    activity_js_2.activityBundle,
    agentic_pipeline_js_2.agenticPipelineBundle, // deprecated — kept for fingerprint backward compat
    agentic_pipeline_signal_js_2.agenticPipelineSignalBundle,
    agentic_pipeline_durable_js_2.agenticPipelineDurableBundle,
    crdt_document_js_2.crdtDocumentBundle,
    crdt_document_js_2.crdtDocumentDurabilityBundle,
    video_hangout_js_2.videoHangoutBundle,
    file_upload_js_2.fileUploadBundle,
    notifications_js_2.notificationsBundle,
    gateway_session_js_2.gatewaySessionBundle,
    orgiq_newsroom_js_2.orgiqNewsroomBundle,
    ag_ui_stream_js_2.agUiStreamBundle,
    call_captions_js_2.callCaptionsBundle,
    sfu_webhooks_js_2.sfuWebhooksBundle,
    sfu_control_plane_js_2.sfuControlPlaneBundle,
    sfu_chat_js_2.sfuChatBundle,
    document_calls_js_2.documentCallsBundle,
];
// Register each bundle in the module-level singleton at import time.
// Idempotent: re-importing this module after the first load is a no-op
// because registerFeatureBundle() silently ignores identical re-registrations.
for (const bundle of exports.allBundles) {
    (0, FeatureBundle_js_1.registerFeatureBundle)(bundle);
}
//# sourceMappingURL=index.js.map