// Phase 21-f — line-by-line JSON schema diff for the EventDetail
// schema-history view. Hand-rolled (no `diff` dep) since the typical
// schema is < 100 lines and we don't need word-level diffing.
//
// Algorithm: pretty-print both schemas with stable key sort, then a
// classic LCS line diff. Output: rows tagged 'add' / 'remove' /
// 'context' for the renderer to color.

import { useMemo, useState } from 'react';

interface SchemaDiffProps {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

type DiffOp = 'add' | 'remove' | 'context';
interface DiffLine {
  op: DiffOp;
  text: string;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object).sort().reduce((acc, key) => {
        acc[key] = (v as Record<string, unknown>)[key];
        return acc;
      }, {} as Record<string, unknown>);
    }
    return v;
  }, 2);
}

function diffLines(beforeLines: string[], afterLines: string[]): DiffLine[] {
  // Classic LCS table — fine for schemas under ~500 lines.
  const m = beforeLines.length;
  const n = afterLines.length;
  const lcs: number[][] = [];
  for (let i = 0; i <= m; i++) lcs.push(new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        lcs[i]![j] = lcs[i - 1]![j - 1]! + 1;
      } else {
        lcs[i]![j] = Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
      }
    }
  }
  const rows: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (beforeLines[i - 1] === afterLines[j - 1]) {
      rows.unshift({ op: 'context', text: beforeLines[i - 1]! });
      i--; j--;
    } else if (lcs[i - 1]![j]! >= lcs[i]![j - 1]!) {
      rows.unshift({ op: 'remove', text: beforeLines[i - 1]! });
      i--;
    } else {
      rows.unshift({ op: 'add', text: afterLines[j - 1]! });
      j--;
    }
  }
  while (i > 0) { rows.unshift({ op: 'remove', text: beforeLines[--i]! }); }
  while (j > 0) { rows.unshift({ op: 'add', text: afterLines[--j]! }); }
  return rows;
}

const colorFor: Record<DiffOp, { bg: string; fg: string; gutter: string }> = {
  add:     { bg: '#dcfce7', fg: '#14532d', gutter: '+' },
  remove:  { bg: '#fee2e2', fg: '#7f1d1d', gutter: '-' },
  context: { bg: 'transparent', fg: '#475569', gutter: ' ' },
};

export function SchemaDiff({ before, after }: SchemaDiffProps) {
  const lines = useMemo(() => {
    const a = stableStringify(before).split('\n');
    const b = stableStringify(after).split('\n');
    return diffLines(a, b);
  }, [before, after]);

  const adds = lines.filter((l) => l.op === 'add').length;
  const removes = lines.filter((l) => l.op === 'remove').length;

  return (
    <div style={{ marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
      <div style={{ marginBottom: 4, color: '#64748b' }}>
        <span style={{ color: '#15803d' }}>+{adds}</span>
        {' / '}
        <span style={{ color: '#b91c1c' }}>−{removes}</span>
        {' lines'}
      </div>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: 8, maxHeight: 400, overflowY: 'auto' }}>
        {lines.map((l, idx) => {
          const c = colorFor[l.op];
          return (
            <div key={idx} style={{ background: c.bg, color: c.fg, whiteSpace: 'pre', padding: '0 6px' }}>
              <span style={{ color: '#94a3b8', userSelect: 'none', marginRight: 6 }}>{c.gutter}</span>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SchemaDiffToggle({ before, after }: SchemaDiffProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11,
          padding: '2px 8px',
          background: open ? '#cbd5e1' : '#e2e8f0',
          color: '#334155',
          border: 'none',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        {open ? 'hide diff' : 'diff'}
      </button>
      {open ? <SchemaDiff before={before} after={after} /> : null}
    </>
  );
}
