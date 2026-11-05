// Phase 21-f — line-by-line JSON schema diff for the EventDetail
// schema-history view. Hand-rolled (no `diff` dep) since the typical
// schema is < 100 lines and we don't need word-level diffing.
//
// Algorithm: pretty-print both schemas with stable key sort, then a
// classic LCS line diff. Output: rows tagged 'add' / 'remove' /
// 'context' for the renderer to color.

import { useId, useMemo, useState } from 'react';
import { Button } from '@connorhoehnslalom/ui-components/shared';

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

/** Gutter marker per op. Colours live in styles.css (`.diff-line.<op>`). */
const GUTTER: Record<DiffOp, string> = {
  add: '+',
  remove: '-',
  context: ' ',
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
    <div className="schema-diff">
      {/* "+4 / −2 lines" is colour plus a sign; the sign is the cue that
          survives greyscale, and the sr-only words are the one that survives
          a screen reader reading "+" as nothing at all. */}
      <div className="schema-diff-summary">
        <span className="diff-adds">+{adds}<span className="sr-only"> added</span></span>
        {' / '}
        <span className="diff-removes">−{removes}<span className="sr-only"> removed</span></span>
        {' lines'}
      </div>
      <div className="schema-diff-body">
        {lines.map((l, idx) => (
          <div key={idx} className={`diff-line ${l.op}`}>
            <span className="diff-gutter">{GUTTER[l.op]}</span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SchemaDiffToggle({ before, after }: SchemaDiffProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`btn-diff-toggle${open ? ' open' : ''}`}
      >
        {open ? 'hide diff' : 'diff'}
      </Button>
      {open ? (
        <div id={panelId}>
          <SchemaDiff before={before} after={after} />
        </div>
      ) : null}
    </>
  );
}
