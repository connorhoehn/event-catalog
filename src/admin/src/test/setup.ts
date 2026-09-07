import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom implements neither of these, and both are load-bearing here: ReactFlow
// measures nodes on mount, and FingerprintChip's copy button writes to the
// clipboard.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (!('DOMMatrixReadOnly' in globalThis)) {
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(_t?: string) {}
  };
}

// jsdom has no layout, so it implements no scrolling either. LiveInspector
// pins its message pane to the bottom with it on every new message.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!globalThis.navigator.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
    writable: true,
  });
}
