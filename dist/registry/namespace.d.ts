/**
 * Derive a namespace from an event name when no explicit namespace was
 * declared. Always returns a non-empty string.
 */
export declare function deriveNamespace(name: string): string;
/**
 * Resolve the effective namespace for an EventDeclaration: its explicit
 * `namespace` field if set, else the derived one. Trim and lowercase
 * normalization stays out of scope — namespaces are case-sensitive
 * tokens, just like event names.
 */
export declare function resolveNamespace(name: string, declared: string | undefined): string;
//# sourceMappingURL=namespace.d.ts.map