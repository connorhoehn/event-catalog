"use strict";
// src/registry/schema-shape.ts
//
// wave22-a — meta-validation for declared JSON Schemas. Catches
// obvious typos and malformations at declare-time so a busted schema
// doesn't sit in the registry until the first publish trips Ajv.
//
// Coverage targets the common bug classes:
//   - `type` set to something other than a valid JSON Schema primitive
//     (typo: `'objct'` instead of `'object'`)
//   - `required` not an array of strings
//   - `properties` / `items` / `oneOf` / `anyOf` / `allOf` of wrong shape
//   - `enum` not an array
//
// Hand-rolled instead of dragging in Ajv's full meta-schema — the
// draft-07 meta-schema is ~70 properties, most of which we never use.
// This catches the 95% of operator mistakes for ~50 LOC.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSchemaShape = validateSchemaShape;
const VALID_TYPES = new Set([
    'string', 'number', 'integer', 'boolean', 'object', 'array', 'null',
]);
/**
 * Run lightweight meta-validation over a JSON Schema. Returns
 * `{ok: true, errors: []}` for well-formed schemas; `{ok: false, errors}`
 * otherwise. Empty schema (`{}`) is considered valid (matches anything).
 *
 * Recursively descends into `properties`, `items`, `oneOf`, `anyOf`,
 * `allOf`, `not`, and `additionalProperties` (when object-typed).
 */
function validateSchemaShape(schema, path = '') {
    const errors = [];
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
        return {
            ok: false,
            errors: [`${path || '<root>'}: schema must be an object`],
        };
    }
    const s = schema;
    // type
    if ('type' in s) {
        const t = s.type;
        if (typeof t === 'string') {
            if (!VALID_TYPES.has(t)) {
                errors.push(`${path}.type: invalid value "${t}" (must be one of ${[...VALID_TYPES].join(', ')})`);
            }
        }
        else if (Array.isArray(t)) {
            for (const tt of t) {
                if (typeof tt !== 'string' || !VALID_TYPES.has(tt)) {
                    errors.push(`${path}.type[]: invalid entry ${JSON.stringify(tt)} (must be one of ${[...VALID_TYPES].join(', ')})`);
                }
            }
        }
        else {
            errors.push(`${path}.type: must be a string or array of strings`);
        }
    }
    // required
    if ('required' in s) {
        if (!Array.isArray(s.required)) {
            errors.push(`${path}.required: must be an array of strings`);
        }
        else {
            for (const [i, r] of s.required.entries()) {
                if (typeof r !== 'string') {
                    errors.push(`${path}.required[${i}]: must be a string`);
                }
            }
        }
    }
    // enum
    if ('enum' in s && !Array.isArray(s.enum)) {
        errors.push(`${path}.enum: must be an array`);
    }
    // properties — recurse
    if ('properties' in s) {
        if (typeof s.properties !== 'object' || s.properties === null || Array.isArray(s.properties)) {
            errors.push(`${path}.properties: must be an object map`);
        }
        else {
            for (const [name, sub] of Object.entries(s.properties)) {
                const r = validateSchemaShape(sub, `${path}.properties.${name}`);
                errors.push(...r.errors);
            }
        }
    }
    // items — can be a schema or array of schemas
    if ('items' in s) {
        if (Array.isArray(s.items)) {
            for (const [i, sub] of s.items.entries()) {
                const r = validateSchemaShape(sub, `${path}.items[${i}]`);
                errors.push(...r.errors);
            }
        }
        else if (typeof s.items === 'object' && s.items !== null) {
            const r = validateSchemaShape(s.items, `${path}.items`);
            errors.push(...r.errors);
        }
        else {
            errors.push(`${path}.items: must be a schema object or array of schemas`);
        }
    }
    // additionalProperties — can be a schema or boolean
    if ('additionalProperties' in s) {
        const ap = s.additionalProperties;
        if (typeof ap === 'object' && ap !== null && !Array.isArray(ap)) {
            const r = validateSchemaShape(ap, `${path}.additionalProperties`);
            errors.push(...r.errors);
        }
        else if (typeof ap !== 'boolean') {
            errors.push(`${path}.additionalProperties: must be a schema or boolean`);
        }
    }
    // oneOf / anyOf / allOf — recurse into each
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (key in s) {
            if (!Array.isArray(s[key])) {
                errors.push(`${path}.${key}: must be an array of schemas`);
            }
            else {
                for (const [i, sub] of s[key].entries()) {
                    const r = validateSchemaShape(sub, `${path}.${key}[${i}]`);
                    errors.push(...r.errors);
                }
            }
        }
    }
    // not — recurse
    if ('not' in s) {
        const r = validateSchemaShape(s.not, `${path}.not`);
        errors.push(...r.errors);
    }
    return { ok: errors.length === 0, errors };
}
//# sourceMappingURL=schema-shape.js.map