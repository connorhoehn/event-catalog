import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchemaDiff, SchemaDiffToggle } from './SchemaDiff';

/** The rendered diff as `['+ text', '- text', '  text', …]`. */
function rows(): string[] {
  return Array.from(document.querySelectorAll('.diff-line')).map((el) => {
    const gutter = el.querySelector('.diff-gutter')!.textContent!;
    return `${gutter === ' ' ? ' ' : gutter}${el.textContent!.slice(1)}`;
  });
}

const added = () => rows().filter((r) => r.startsWith('+')).map((r) => r.slice(1).trim());
const removed = () => rows().filter((r) => r.startsWith('-')).map((r) => r.slice(1).trim());

const OBJ = { type: 'object', properties: { id: { type: 'string' } } };

describe('SchemaDiff — the added / removed computation', () => {
  it('reports nothing changed for two identical schemas', () => {
    render(<SchemaDiff before={OBJ} after={OBJ} />);
    expect(added()).toEqual([]);
    expect(removed()).toEqual([]);
    expect(screen.getByText('+0')).toBeInTheDocument();
    expect(screen.getByText('−0')).toBeInTheDocument();
  });

  it('treats a key-order-only difference as no change', () => {
    // Schemas come back from different code paths with different key order.
    // Without stable stringification every reordered schema reads as a full
    // rewrite, which makes the diff useless for spotting a real change.
    render(
      <SchemaDiff
        before={{ b: 1, a: 2 }}
        after={{ a: 2, b: 1 }}
      />,
    );
    expect(added()).toEqual([]);
    expect(removed()).toEqual([]);
  });

  it('reports an added property as added only', () => {
    render(
      <SchemaDiff
        before={{ properties: { id: { type: 'string' } } }}
        after={{ properties: { id: { type: 'string' }, name: { type: 'string' } } }}
      />,
    );
    expect(added().join('\n')).toContain('"name"');
    expect(removed().filter((r) => r.includes('"id"'))).toEqual([]);
  });

  it('reports a removed property as removed only', () => {
    render(
      <SchemaDiff
        before={{ properties: { id: { type: 'string' }, legacy: { type: 'number' } } }}
        after={{ properties: { id: { type: 'string' } } }}
      />,
    );
    expect(removed().join('\n')).toContain('"legacy"');
    expect(added().join('\n')).not.toContain('"legacy"');
  });

  it('reports a changed value as one removal and one addition', () => {
    render(
      <SchemaDiff
        before={{ properties: { id: { type: 'string' } } }}
        after={{ properties: { id: { type: 'number' } } }}
      />,
    );
    expect(removed().join('\n')).toContain('"string"');
    expect(added().join('\n')).toContain('"number"');
  });

  it('finds a change nested three levels deep', () => {
    render(
      <SchemaDiff
        before={{ properties: { meta: { properties: { call: { properties: { id: { type: 'string' } } } } } } }}
        after={{ properties: { meta: { properties: { call: { properties: { id: { type: 'integer' } } } } } } }}
      />,
    );
    expect(removed().join('\n')).toContain('"string"');
    expect(added().join('\n')).toContain('"integer"');
    // …and does not claim the untouched outer levels changed.
    expect(removed().join('\n')).not.toContain('"meta"');
  });

  it('handles a required-array change', () => {
    render(
      <SchemaDiff before={{ required: ['id'] }} after={{ required: ['id', 'callId'] }} />,
    );
    expect(added().join('\n')).toContain('"callId"');
  });

  it('handles an empty schema on either side', () => {
    const { unmount } = render(<SchemaDiff before={{}} after={OBJ} />);
    expect(added().length).toBeGreaterThan(0);
    expect(removed()).toEqual(['{}']);
    unmount();

    render(<SchemaDiff before={OBJ} after={{}} />);
    expect(removed().length).toBeGreaterThan(0);
  });

  it('counts the summary consistently with the rendered lines', () => {
    render(
      <SchemaDiff
        before={{ properties: { a: { type: 'string' } } }}
        after={{ properties: { a: { type: 'string' }, b: { type: 'string' } } }}
      />,
    );
    expect(screen.getByText(`+${added().length}`)).toBeInTheDocument();
    expect(screen.getByText(`−${removed().length}`)).toBeInTheDocument();
  });

  it('spells out the +/− signs for a screen reader', () => {
    // "+4 / −2" is a sign and a colour; a reader announces neither.
    render(<SchemaDiff before={{}} after={{ a: 1 }} />);
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(screen.getByText('removed')).toBeInTheDocument();
  });
});

describe('SchemaDiffToggle', () => {
  it('hides the diff until asked and reports its state', async () => {
    const user = userEvent.setup();
    render(<SchemaDiffToggle before={{ a: 1 }} after={{ a: 2 }} />);
    const toggle = screen.getByRole('button', { name: 'diff' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.diff-line')).toBeNull();

    await user.click(toggle);
    const open = screen.getByRole('button', { name: 'hide diff' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.diff-line')).not.toBeNull();

    await user.click(open);
    expect(document.querySelector('.diff-line')).toBeNull();
  });

  it('points aria-controls at the panel it actually opens', async () => {
    const user = userEvent.setup();
    render(<SchemaDiffToggle before={{ a: 1 }} after={{ a: 2 }} />);
    const toggle = screen.getByRole('button', { name: 'diff' });
    await user.click(toggle);
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText(/lines/)).toBeInTheDocument();
  });
});
