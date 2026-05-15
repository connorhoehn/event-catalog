export interface SchemaShapeResult {
    ok: boolean;
    errors: string[];
}
/**
 * Run lightweight meta-validation over a JSON Schema. Returns
 * `{ok: true, errors: []}` for well-formed schemas; `{ok: false, errors}`
 * otherwise. Empty schema (`{}`) is considered valid (matches anything).
 *
 * Recursively descends into `properties`, `items`, `oneOf`, `anyOf`,
 * `allOf`, `not`, and `additionalProperties` (when object-typed).
 */
export declare function validateSchemaShape(schema: unknown, path?: string): SchemaShapeResult;
//# sourceMappingURL=schema-shape.d.ts.map