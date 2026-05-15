"use strict";
// src/declarations/deprecated-pipeline-aliases.ts
//
// wave20-f — single source of truth for the dot-form pipeline event
// names that distributed-core's PipelineExecutor used to emit
// (`CANONICAL_TO_DEPRECATED`). The gateway's `pipeline-bridge` consumes
// this set to suppress the deprecated half of dual-emitted events.
//
// Pulled out as its own module + named export so the gateway can
// import it directly (`import { DEPRECATED_DUAL_EMIT_ALIASES } from
// '@connorhoehn/event-catalog'`) and delete its hardcoded copy. The
// names here are also declared as `aliases` on the canonical colon-
// form pipeline declarations so the catalog's alias resolution + UI
// flag them as deprecated.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPRECATED_DUAL_EMIT_ALIASES = void 0;
const pipeline_p1_1 = require("./pipeline-p1");
const pipeline_p2_1 = require("./pipeline-p2");
/**
 * Set of dot-form pipeline event names that PipelineExecutor emits
 * alongside their canonical colon-form counterparts. The gateway's
 * pipeline-bridge filters these so consumers only see one
 * representation per event.
 *
 * Derived from the `aliases` arrays on the colon-form canonical
 * declarations rather than re-listed — that means adding a new dual-
 * emit alias is a one-line change on the canonical declaration, not
 * an edit to two files.
 */
function buildAliasSet() {
    const out = new Set();
    for (const decl of [...pipeline_p1_1.pipelineP1Declarations, ...pipeline_p2_1.pipelineP2Declarations]) {
        for (const alias of decl.aliases ?? []) {
            out.add(alias.name);
        }
    }
    return out;
}
exports.DEPRECATED_DUAL_EMIT_ALIASES = buildAliasSet();
//# sourceMappingURL=deprecated-pipeline-aliases.js.map