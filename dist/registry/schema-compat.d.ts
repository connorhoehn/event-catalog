export interface CompatResult {
    compatible: boolean;
    violations: string[];
}
type JsonSchema = Record<string, unknown>;
/**
 * Backward compatibility: can a message produced under `oldSchema` still be
 * validated by `newSchema`? Any tightening anywhere in the tree is a
 * violation.
 */
export declare function checkBackwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult;
/**
 * Forward compatibility: can a message produced under `newSchema` still be
 * validated by `oldSchema` — i.e. will a consumer still running the old
 * contract cope? Found by walking the same tightening detector in reverse.
 */
export declare function checkForwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult;
export {};
//# sourceMappingURL=schema-compat.d.ts.map