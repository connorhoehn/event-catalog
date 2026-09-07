/**
 * Cheap edit-distance-ish scorer in [0, 1]. Only ever runs on an error
 * path over the local declaration set, so the O(n·m) cost is irrelevant.
 * Bounded so a pathological name can't blow up.
 */
export declare function similarity(a: string, b: string): number;
/** Up to `limit` candidates close enough to `name` to be worth printing. */
export declare function suggestNames(name: string, candidates: readonly string[], limit?: number): string[];
/**
 * ` Did you mean "a" or "b"?` — or '' when nothing is close. Returned with
 * a leading space so it appends cleanly to a sentence.
 */
export declare function didYouMean(name: string, candidates: readonly string[], limit?: number): string;
//# sourceMappingURL=suggest.d.ts.map