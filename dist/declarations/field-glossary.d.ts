import type { EventDeclaration } from '../types/index';
/** Field name (or dotted path) → the canonical description for that field. */
export type FieldGlossary = Readonly<Record<string, string>>;
/**
 * Cross-namespace field vocabulary. Every entry here is a name whose meaning
 * is stable platform-wide; anything whose meaning shifts per namespace lives
 * in that module's local glossary instead.
 */
export declare const COMMON_FIELDS: FieldGlossary;
/**
 * Recursively stamp glossary descriptions onto a JSON Schema, in place.
 *
 * Only fills a `description` that is absent — never overwrites. Descends
 * `properties`, `items`, and object-valued `additionalProperties`; array
 * hops do not add a path segment, so `payload.notifications[].title`
 * resolves as `payload.notifications.title`.
 */
export declare function annotateSchema(schema: unknown, glossary: FieldGlossary, path?: string): void;
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
export declare function annotateDeclarations<T extends readonly EventDeclaration[]>(decls: T, glossary?: FieldGlossary): T;
//# sourceMappingURL=field-glossary.d.ts.map