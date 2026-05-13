export interface CompatResult {
    compatible: boolean;
    violations: string[];
}
type JsonSchema = Record<string, unknown>;
export declare function checkBackwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult;
export declare function checkForwardCompat(oldSchema: JsonSchema, newSchema: JsonSchema): CompatResult;
export {};
//# sourceMappingURL=schema-compat.d.ts.map