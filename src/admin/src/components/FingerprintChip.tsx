// Phase E6.6 — short-form schema-fingerprint chip.
//
// Renders the first 12 hex chars of a 64-char sha256 (e.g. `a7f2c1e9b3d4`)
// with click-to-expand showing the full hash + a copy button. Reads
// naturally next to a version chip in the EventDetail header.

import { useId, useState } from 'react';

interface FingerprintChipProps {
  fingerprint: string | undefined;
  label?: string;
}

export function FingerprintChip({ fingerprint, label = 'fingerprint' }: FingerprintChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const valueId = useId();

  if (!fingerprint) {
    return null;
  }
  const short = fingerprint.slice(0, 12);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be blocked (insecure context). Silent fallback.
    }
  };

  // The toggle used to be `onClick` on a <span>: no tab stop, no Enter/Space,
  // and nothing in the accessibility tree said it did anything. It is a
  // <button> now — and the copy button had to move OUT of it, because a
  // button nested inside a button is invalid and browsers disagree about
  // which one a click belongs to.
  return (
    <span className="fingerprint-chip">
      <button
        type="button"
        className="fingerprint-toggle"
        aria-expanded={expanded}
        aria-controls={valueId}
        onClick={() => setExpanded(v => !v)}
      >
        {label ? <span className="fingerprint-label">{label}</span> : null}
        <span id={valueId} className="fingerprint-value">
          {expanded ? fingerprint : short + (fingerprint.length > 12 ? '…' : '')}
        </span>
      </button>
      {expanded ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy full ${label || 'fingerprint'} to clipboard`}
          className={`fingerprint-copy${copied ? ' copied' : ''}`}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      ) : null}
    </span>
  );
}
