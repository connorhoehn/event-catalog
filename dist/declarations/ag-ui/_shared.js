"use strict";
// src/declarations/ag-ui/_shared.ts
//
// Producer identity, namespace and tag set shared by every module in this
// directory. Split out of the former single-file `ag-ui.ts`; the declarations
// themselves are unchanged.
//
// The AG-UI field glossary deliberately does NOT live here — it stays next to
// the single `annotateDeclarations()` call in the `../ag-ui.ts` barrel. That
// glossary intentionally OVERRIDES the platform-wide wording for `type`,
// `delta`, `name`, `value` and friends, so keeping it in one place is what
// guarantees the split cannot change which override lands on which event.
// Never call `annotateDeclarations` from a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAGS = exports.NAMESPACE = exports.PRODUCER = void 0;
exports.PRODUCER = 'ag-ui-agent';
exports.NAMESPACE = 'ag-ui';
exports.TAGS = ['ag-ui', 'agent', 'streaming'];
//# sourceMappingURL=_shared.js.map