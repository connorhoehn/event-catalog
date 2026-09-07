"use strict";
// src/bundles/suggest.ts
//
// "Did you mean…?" for event names.
//
// A bundle member that names an event nobody declared is almost always a
// typo, and by far the most common typo in this repo is separator
// confusion: `pipeline.run.started` for `pipeline:run:started`. The
// registry already knows the right answer, so an error that omits it is
// wasting the one thing it could have said.
//
// This mirrors the scorer inside `src/client/index.ts`, which is module-
// private there. If that one is ever exported, delete this and import it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.similarity = similarity;
exports.suggestNames = suggestNames;
exports.didYouMean = didYouMean;
/**
 * Cheap edit-distance-ish scorer in [0, 1]. Only ever runs on an error
 * path over the local declaration set, so the O(n·m) cost is irrelevant.
 * Bounded so a pathological name can't blow up.
 */
function similarity(a, b) {
    if (a === b)
        return 1;
    const s = a.toLowerCase();
    const t = b.toLowerCase();
    if (s.length > 200 || t.length > 200)
        return 0;
    // Normalizing separators makes `pipeline.run.started` a near-match for
    // `pipeline:run:started` — the single most common mistake in this repo.
    const ns = s.replace(/[.:_-]/g, '');
    const nt = t.replace(/[.:_-]/g, '');
    if (ns === nt)
        return 0.99;
    const rows = ns.length + 1;
    const cols = nt.length + 1;
    let prev = new Array(cols);
    let curr = new Array(cols);
    for (let j = 0; j < cols; j++)
        prev[j] = j;
    for (let i = 1; i < rows; i++) {
        curr[0] = i;
        for (let j = 1; j < cols; j++) {
            const cost = ns[i - 1] === nt[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    const distance = prev[cols - 1];
    return 1 - distance / Math.max(ns.length, nt.length, 1);
}
/** Up to `limit` candidates close enough to `name` to be worth printing. */
function suggestNames(name, candidates, limit = 2) {
    return candidates
        .map((candidate) => ({ candidate, score: similarity(name, candidate) }))
        .filter((s) => s.score >= 0.75)
        .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
        .slice(0, limit)
        .map((s) => s.candidate);
}
/**
 * ` Did you mean "a" or "b"?` — or '' when nothing is close. Returned with
 * a leading space so it appends cleanly to a sentence.
 */
function didYouMean(name, candidates, limit = 2) {
    const suggestions = suggestNames(name, candidates, limit);
    if (suggestions.length === 0)
        return '';
    return ` Did you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`;
}
//# sourceMappingURL=suggest.js.map