import type { EventDeclaration } from '../types/index';
/** Field name (or dotted path) → the canonical description for that field. */
export type FieldGlossary = Readonly<Record<string, string>>;
/**
 * Cross-namespace field vocabulary. Every entry here is a name whose meaning
 * is stable platform-wide; anything whose meaning shifts per namespace lives
 * in that module's local glossary instead.
 */
export declare const COMMON_FIELDS: FieldGlossary;
/** Field name (or dotted path) → the JSON Schema `format` its string values take. */
export type FormatGlossary = Readonly<Record<string, string>>;
/**
 * Cross-namespace lexical formats. Same lookup rules as {@link COMMON_FIELDS}:
 * dotted path beats bare name, a module-local glossary beats this one.
 */
export declare const COMMON_FORMATS: FormatGlossary;
/**
 * Recursively stamp glossary descriptions (and lexical formats) onto a JSON
 * Schema, in place.
 *
 * Only fills a `description` or a `format` that is absent — never overwrites.
 * A `format` is additionally guarded on the sub-schema admitting a string, so
 * a name that is ISO-8601 in one event and epoch-millis in another is only
 * stamped where it is actually a string. Descends `properties`, `items`, and
 * object-valued `additionalProperties`; array hops do not add a path segment,
 * so `payload.notifications[].title` resolves as `payload.notifications.title`.
 */
export declare function annotateSchema(schema: unknown, glossary: FieldGlossary, path?: string, formats?: FormatGlossary): void;
/**
 * Annotate every declaration in `decls` and return the same array.
 *
 * Mutates the declarations' schema objects in place — declarations are
 * module-level singletons exported both individually and inside aggregate
 * arrays, so in-place is the only way both views stay identical. Idempotent:
 * a second call is a no-op because every description is already set.
 *
 * Call it once, at the bottom of the module that defines the declarations,
 * so consumers importing either the array or an individual constant see the
 * annotated schema.
 */
export declare function annotateDeclarations<T extends readonly EventDeclaration[]>(decls: T, glossary?: FieldGlossary, formats?: FormatGlossary): T;
//# sourceMappingURL=field-glossary.d.ts.map