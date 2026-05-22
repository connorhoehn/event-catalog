"use strict";
// src/declarations/bundles/index.ts
//
// Aggregate re-export for all declared FeatureBundles.
// Importing this module at boot time registers the bundles in the
// module-level singleton via registerFeatureBundle().
Object.defineProperty(exports, "__esModule", { value: true });
exports.allBundles = exports.fileUploadBundle = exports.videoHangoutBundle = exports.crdtDocumentBundle = exports.agenticPipelineBundle = exports.activityBundle = exports.reactionsBundle = exports.cursorBundle = exports.presenceBundle = exports.chatBundle = void 0;
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
var agentic_pipeline_js_1 = require("./agentic-pipeline.js");
Object.defineProperty(exports, "agenticPipelineBundle", { enumerable: true, get: function () { return agentic_pipeline_js_1.agenticPipelineBundle; } });
var crdt_document_js_1 = require("./crdt-document.js");
Object.defineProperty(exports, "crdtDocumentBundle", { enumerable: true, get: function () { return crdt_document_js_1.crdtDocumentBundle; } });
var video_hangout_js_1 = require("./video-hangout.js");
Object.defineProperty(exports, "videoHangoutBundle", { enumerable: true, get: function () { return video_hangout_js_1.videoHangoutBundle; } });
var file_upload_js_1 = require("./file-upload.js");
Object.defineProperty(exports, "fileUploadBundle", { enumerable: true, get: function () { return file_upload_js_1.fileUploadBundle; } });
const FeatureBundle_js_1 = require("../../bundles/FeatureBundle.js");
const chat_js_2 = require("./chat.js");
const presence_js_2 = require("./presence.js");
const cursor_js_2 = require("./cursor.js");
const reactions_js_2 = require("./reactions.js");
const activity_js_2 = require("./activity.js");
const agentic_pipeline_js_2 = require("./agentic-pipeline.js");
const crdt_document_js_2 = require("./crdt-document.js");
const video_hangout_js_2 = require("./video-hangout.js");
const file_upload_js_2 = require("./file-upload.js");
/** All v1 bundle definitions, in declaration order. */
exports.allBundles = [
    chat_js_2.chatBundle,
    presence_js_2.presenceBundle,
    cursor_js_2.cursorBundle,
    reactions_js_2.reactionsBundle,
    activity_js_2.activityBundle,
    agentic_pipeline_js_2.agenticPipelineBundle,
    crdt_document_js_2.crdtDocumentBundle,
    video_hangout_js_2.videoHangoutBundle,
    file_upload_js_2.fileUploadBundle,
];
// Register each bundle in the module-level singleton at import time.
// Idempotent: re-importing this module after the first load is a no-op
// because registerFeatureBundle() silently ignores identical re-registrations.
for (const bundle of exports.allBundles) {
    (0, FeatureBundle_js_1.registerFeatureBundle)(bundle);
}
//# sourceMappingURL=index.js.map