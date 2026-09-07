// Fingerprint truncation.
//
// The chip shows 12 of a fingerprint's 64 hex characters. That is fine for
// recognising one, and wrong for the job an operator actually uses it for —
// deciding whether the schema two services are pinned to is the same schema.
// So: the short form must be visibly marked as short, and the full 64 must be
// reachable and copyable without leaving the page.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FingerprintChip } from './FingerprintChip';

const FULL = 'a7f2c1e9b3d4'.repeat(5) + 'abcd'; // 64 hex chars
const SHORT = FULL.slice(0, 12);

describe('FingerprintChip', () => {
  it('renders nothing when there is no fingerprint', () => {
    const { container } = render(<FingerprintChip fingerprint={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the first 12 characters, marked as truncated', () => {
    render(<FingerprintChip fingerprint={FULL} />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveTextContent(`${SHORT}…`);
    // The full hash must NOT be sitting in the DOM claiming to be the short
    // one — an operator comparing two chips by eye has to be told there is
    // more to the value.
    expect(toggle.textContent).not.toContain(FULL);
  });

  it('exposes the complete 64-character hash on expand', async () => {
    const user = userEvent.setup();
    render(<FingerprintChip fingerprint={FULL} />);
    const toggle = screen.getByRole('button', { name: /^fingerprint/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const value = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(value).toHaveTextContent(FULL);
    expect(value.textContent).toHaveLength(64);
    expect(value.textContent).not.toContain('…');
  });

  it('copies the full hash, never the truncated one', async () => {
    // userEvent.setup() installs its own clipboard stub, so ours has to go in
    // afterwards or it is silently replaced.
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FingerprintChip fingerprint={FULL} />);

    await user.click(screen.getByRole('button', { name: /^fingerprint/ }));
    await user.click(screen.getByRole('button', { name: /Copy full fingerprint/ }));
    expect(writeText).toHaveBeenCalledWith(FULL);
    expect(writeText).not.toHaveBeenCalledWith(SHORT);
    expect(await screen.findByText('copied')).toBeInTheDocument();
  });

  it('offers no copy button while collapsed — there is nothing safe to copy yet', () => {
    render(<FingerprintChip fingerprint={FULL} />);
    expect(screen.queryByRole('button', { name: /Copy/ })).not.toBeInTheDocument();
  });

  it('does not mark an already-short value as truncated', () => {
    // Legacy entries can carry a shorter fingerprint. Appending an ellipsis
    // to a complete value tells the operator to go looking for digits that
    // do not exist.
    render(<FingerprintChip fingerprint="abc123" />);
    expect(screen.getByRole('button')).toHaveTextContent('abc123');
    expect(screen.getByRole('button').textContent).not.toContain('…');
  });

  it('collapses back to the short form on a second click', async () => {
    const user = userEvent.setup();
    render(<FingerprintChip fingerprint={FULL} />);
    const toggle = screen.getByRole('button', { name: /^fingerprint/ });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveTextContent(`${SHORT}…`);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('is operable from the keyboard', async () => {
    // It used to be an onClick on a <span>: no tab stop, no Enter, and
    // nothing in the accessibility tree saying it did anything.
    const user = userEvent.setup();
    render(<FingerprintChip fingerprint={FULL} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /^fingerprint/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /^fingerprint/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('still names the copy button when the visible label is suppressed', async () => {
    // The schema-history rows pass label="" to save space; the accessible
    // name has to survive that.
    const user = userEvent.setup();
    render(<FingerprintChip fingerprint={FULL} label="" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Copy full fingerprint to clipboard' })).toBeInTheDocument();
  });

  it('survives a blocked clipboard without losing the expanded hash', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('blocked'); }) },
      configurable: true,
    });
    render(<FingerprintChip fingerprint={FULL} />);
    await user.click(screen.getByRole('button', { name: /^fingerprint/ }));
    await user.click(screen.getByRole('button', { name: /Copy full/ }));
    // No "copied" lie, and the value is still on screen to select by hand.
    expect(screen.queryByText('copied')).not.toBeInTheDocument();
    expect(screen.getByText(FULL)).toBeInTheDocument();
  });
});
