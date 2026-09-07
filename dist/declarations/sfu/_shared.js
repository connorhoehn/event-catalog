"use strict";
// src/declarations/sfu/_shared.ts
//
// Producer identity and the retention time unit shared by every module in
// this directory. Split out of the former single-file `sfu.ts`; the
// declarations themselves are unchanged.
//
// The field glossary and the FORMATS lexical-format map that annotate these
// schemas deliberately do NOT live here — they stay next to the single
// `annotateDeclarations()` call in the `../sfu.ts` barrel, so there is exactly
// one place that decides which description and which `format` land on which
// event. Never call `annotateDeclarations` from a part file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY = exports.BASE_TAGS = exports.PRODUCER = void 0;
exports.PRODUCER = 'sfu-cluster';
exports.BASE_TAGS = ['sfu', `producer:${exports.PRODUCER}`];
/** Seconds in a day — the unit every `retention` / `dlqRetention` below is expressed in. */
exports.DAY = 86400;
//# sourceMappingURL=_shared.js.map