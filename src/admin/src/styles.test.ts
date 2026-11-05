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
    // ui-components imports @xyflow/react itself; if that ever resolves to
    // a different copy than the app's (a `file:` link, a nested install), it is a second module
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

describe('coordinator card — degraded must not be a milder unhealthy', () => {
  // jsdom applies no stylesheet, so the component tests can prove the glyph
  // and the words differ but not that the CARD does. This is the only place
  // that can, and it is the cue an operator sees first at a glance.
  const degraded = ruleBody('.coordinator-card.degraded');
  const unhealthy = ruleBody('.coordinator-card.unhealthy');

  it('gives each state a left rule that differs in style, not only in hue', () => {
    // A colour-blind operator reading a greyscale screenshot gets nothing from
    // amber-vs-red. Dashed-vs-solid survives it.
    expect(decl(degraded, 'border-left-style')).toBe('dashed');
    expect(decl(unhealthy, 'border-left-style')).toBe('solid');
  });

  it('does not let the two states share a background treatment either', () => {
    const a = decl(degraded, 'background');
    const b = decl(unhealthy, 'background');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // The degraded field is hatched — a texture, which is the second cue that
    // does not depend on colour at all.
    expect(a).toMatch(/repeating-linear-gradient/);
  });

  it('keeps the glyph legible rather than a bare 12px disc', () => {
    // The dot carries ▲ / ■ / ● as text; .status-dot's own 12px box would clip
    // it to nothing.
    const dot = ruleBody('.coordinator-dot');
    expect(decl(dot, 'text-align')).toBe('center');
    expect(decl(dot, 'width')).toBe('20px');
  });

  it('marks the "not reported" card as neither healthy nor failed', () => {
    // A deployment that did not report replication must not borrow either
    // state's styling — "we did not ask" is its own answer.
    const unknown = ruleBody('.coordinator-card.unknown');
    expect(decl(unknown, 'border-left-style')).toBe('dotted');
  });
});
