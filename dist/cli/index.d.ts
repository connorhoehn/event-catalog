#!/usr/bin/env node
/**
 * Dispatch one argv to a subcommand and resolve with its exit code.
 *
 * NOTE: importing this module runs the CLI (see the `runCli` call at the
 * bottom), so tests exercise the dispatcher by spawning the bin rather
 * than importing `main`.
 */
export declare function main(argv: string[]): Promise<number>;
//# sourceMappingURL=index.d.ts.map