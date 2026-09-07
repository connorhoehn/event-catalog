// Phase E6.6 — short-form schema-fingerprint chip.
//
// Renders the first 12 hex chars of a 64-char sha256 (e.g. `a7f2c1e9b3d4`)
// with click-to-expand showing the full hash + a copy button. Reads
// naturally next to a version chip in the EventDetail header.

import { useState } from 'react';

interface FingerprintChipProps {
  fingerprint: string | undefined;
  label?: string;
}

export function FingerprintChip({ fingerprint, label = 'fingerprint' }: FingerprintChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  return (
    <span
      className="fingerprint-chip"
      onClick={() => setExpanded((v) => !v)}
      title={`Click to ${expanded ? 'collapse' : 'expand'} full fingerprint`}
    >
      <span className="fingerprint-label">
        {label}
      </span>
      <span>{expanded ? fingerprint : short + (fingerprint.length > 12 ? '…' : '')}</span>
      {expanded ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className={`fingerprint-copy${copied ? ' copied' : ''}`}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      ) : null}
    </span>
  );
}
