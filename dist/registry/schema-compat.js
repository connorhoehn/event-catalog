"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBackwardCompat = checkBackwardCompat;
exports.checkForwardCompat = checkForwardCompat;
function getProperties(schema) {
    return schema.properties ?? {};
}
function getRequired(schema) {
    return schema.required ?? [];
}
function getType(schema) {
    return schema.type ?? 'any';
}
function normalizeType(t) {
    if (Array.isArray(t))
        return [...t].sort();
    return [t];
}
function isSubsetOf(narrower, wider) {
    return narrower.every(t => wider.includes(t));
}
function checkBackwardCompat(oldSchema, newSchema) {
    const violations = [];
    const oldProps = getProperties(oldSchema);
    const newProps = getProperties(newSchema);
    const oldRequired = getRequired(oldSchema);
    const newRequired = getRequired(newSchema);
    // Fields removed in new schema — backward-incompatible (consumers expect them)
    for (const field of Object.keys(oldProps)) {
        if (!(field in newProps)) {
            violations.push(`Field "${field}" was removed — consumers may depend on it`);
        }
    }
    // New required fields — backward-incompatible (old messages won't have them)
    for (const field of newRequired) {
        if (!oldRequired.includes(field)) {
            const isNewField = !(field in oldProps);
            if (isNewField) {
                violations.push(`Required field "${field}" was added — old messages won't include it`);
            }
            else {
                violations.push(`Field "${field}" became required — old messages may not include it`);
            }
        }
    }
    // Type narrowed — backward-incompatible
    for (const field of Object.keys(newProps)) {
        if (field in oldProps) {
            const oldType = normalizeType(getType(oldProps[field]));
            const newType = normalizeType(getType(newProps[field]));
            if (oldType.join(',') !== newType.join(',') && !isSubsetOf(oldType, newType)) {
                violations.push(`Field "${field}" type narrowed from [${oldType}] to [${newType}]`);
            }
        }
    }
    return { compatible: violations.length === 0, violations };
}
function checkForwardCompat(oldSchema, newSchema) {
    const violations = [];
    const oldProps = getProperties(oldSchema);
    const newProps = getProperties(newSchema);
    const oldRequired = getRequired(oldSchema);
    const newRequired = getRequired(newSchema);
    // Adding required fields — forward-incompatible (old consumers can't handle new required fields)
    for (const field of newRequired) {
        if (!oldRequired.includes(field) && !(field in oldProps)) {
            violations.push(`Required field "${field}" was added — old consumers won't understand it`);
        }
    }
    // Type widened in new schema — forward-incompatible (old consumers expect narrower type)
    for (const field of Object.keys(newProps)) {
        if (field in oldProps) {
            const oldType = normalizeType(getType(oldProps[field]));
            const newType = normalizeType(getType(newProps[field]));
            if (oldType.join(',') !== newType.join(',') && !isSubsetOf(newType, oldType)) {
                violations.push(`Field "${field}" type widened from [${oldType}] to [${newType}] — old consumers may not handle new types`);
            }
        }
    }
    // Required fields removed from old schema that existed — means new messages might omit them
    for (const field of oldRequired) {
        if (!newRequired.includes(field) && field in oldProps && field in newProps) {
            violations.push(`Field "${field}" is no longer required — old consumers expect it to always be present`);
        }
    }
    return { compatible: violations.length === 0, violations };
}
//# sourceMappingURL=schema-compat.js.map