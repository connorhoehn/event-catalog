// tests/deprecated-aliases.test.ts
//
// wave20-f — DEPRECATED_DUAL_EMIT_ALIASES is the single source of truth
// for the dot-form pipeline names PipelineExecutor dual-emits. It must
// stay in lockstep with the aliases declared on the colon-form canonical
// declarations.

import { describe, it, expect } from 'vitest';
import { DEPRECATED_DUAL_EMIT_ALIASES } from '../src/declarations/deprecated-pipeline-aliases.js';
import { pipelineP1Declarations } from '../src/declarations/pipeline-p1.js';
import { pipelineP2Declarations } from '../src/declarations/pipeline-p2.js';

describe('DEPRECATED_DUAL_EMIT_ALIASES (wave20-f)', () => {
  it('is non-empty (at least the P1 + P2 dot-form aliases are in there)', () => {
    expect(DEPRECATED_DUAL_EMIT_ALIASES.size).toBeGreaterThan(0);
  });

  it('includes every dot-form name that maps to a canonical colon-form', () => {
    const expectedDotForms = [
      'pipeline.run.started', 'pipeline.run.completed', 'pipeline.run.failed',
      'pipeline.run.cancelled', 'pipeline.run.orphaned', 'pipeline.run.reassigned',
      'pipeline.step.started', 'pipeline.step.completed', 'pipeline.step.failed',
      'pipeline.llm.prompt', 'pipeline.llm.response',
      'pipeline.run.paused', 'pipeline.run.resumed',
      'pipeline.run.resumed-from-step', 'pipeline.run.retry',
      'pipeline.join.waiting', 'pipeline.join.fired',
    ];
    for (const dot of expectedDotForms) {
      expect(DEPRECATED_DUAL_EMIT_ALIASES.has(dot)).toBe(true);
    }
  });

  it('matches the aliases declared on the canonical declarations exactly', () => {
    const fromDecls = new Set<string>();
    for (const d of [...pipelineP1Declarations, ...pipelineP2Declarations]) {
      for (const a of d.aliases ?? []) fromDecls.add(a.name);
    }
    expect([...DEPRECATED_DUAL_EMIT_ALIASES].sort()).toEqual([...fromDecls].sort());
  });

  it('is a ReadonlySet — runtime mutation throws (or is a no-op at the type level)', () => {
    // TypeScript marks it ReadonlySet; at runtime it's still a Set. The
    // type-level guarantee is what matters; this test just asserts the
    // export shape so a future refactor (e.g. switch to frozen array)
    // is caught by a CI failure.
    expect(DEPRECATED_DUAL_EMIT_ALIASES).toBeInstanceOf(Set);
  });
});
