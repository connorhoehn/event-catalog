// Invariants that live in the stylesheet and the bundler config rather than
// in any component — and that no amount of asserting on markup can catch,
// because jsdom applies neither.
//
// Both of these have shipped as bugs. A rendered-DOM test passed happily
// through both: the graph was in the document, it was just 0px tall, or the
// component threw before paint for a reason that only exists once two copies
// of a library are on the page.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'styles.css'), 'utf8');
const viteConfig = readFileSync(resolve(here, '..', 'vite.config.ts'), 'utf8');

/** The declarations inside the first rule whose selector list contains `sel`. */
function ruleBody(sel: string): string {
  const idx = css.indexOf(`${sel} {`);
  expect(idx, `no rule for ${sel} in styles.css`).toBeGreaterThan(-1);
  const start = css.indexOf('{', idx);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

/** Value of `prop` in a rule body, ignoring commented-out text. */
function decl(body: string, prop: string): string | null {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm').exec(withoutComments);
  return m ? m[1]!.trim() : null;
}

describe('.view-canvas — the graph container', () => {
  const body = ruleBody('.view-canvas');

  it('declares a definite height, not only a min-height', () => {
    // The bug: `.view-canvas` had `min-height` alone. ReactFlow's own
    // stylesheet sizes `.react-flow` at `height: 100%`, and a percentage
    // against a parent whose used height is `auto` resolves to 0 — so
    // /topology and /flow both rendered a complete, correct graph into a
    // zero-pixel box. Every DOM assertion still passed.
    const height = decl(body, 'height');
    expect(height, '.view-canvas must set an explicit height').not.toBeNull();
    expect(height).not.toMatch(/^(auto|0)/);
    expect(height).not.toMatch(/%$/); // a percentage reintroduces the bug
  });

  it('keeps a min-height too, so a short flex parent cannot collapse it', () => {
    expect(decl(body, 'min-height')).toMatch(/\d/);
  });
});

describe('bundler config — one copy of the graph library', () => {
  it('dedupes @xyflow/react, react and react-dom', () => {
    // `@ui` resolves to ui-components' SOURCE, so ui-components' own import
    // of @xyflow/react resolves from ITS node_modules: a second module
    // instance, a second React context, and ReactFlowProvider populating the
    // one `useStore` does not read. The symptom is not a bad layout — it is
    // "you have not used ReactFlowProvider as an ancestor" and a white
    // screen on /topology and /flow.
    const m = /dedupe:\s*\[([^\]]+)\]/.exec(viteConfig);
    expect(m, 'vite.config.ts must declare a dedupe list').not.toBeNull();
    const deduped = m![1]!.split(',').map((s) => s.trim().replace(/['"]/g, ''));
    expect(deduped).toContain('@xyflow/react');
    expect(deduped).toContain('react');
    expect(deduped).toContain('react-dom');
  });

  it('keeps the graph vendor code in its own chunk, off the entry path', () => {
    // /topology and /flow are the only routes that need @xyflow + dagre, and
    // they are both lazy. If this chunking goes away the graph library lands
    // in the entry bundle for an operator who only opens the event list.
    expect(viteConfig).toMatch(/vendor-graph/);
    expect(viteConfig).toMatch(/@xyflow\|dagre/);
  });
});
