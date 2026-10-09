import { describe, expect, it } from 'vitest';
import { toastPositionFor } from './toastPosition';

describe('toastPositionFor', () => {
  it('uses the bottom inline-end corner so toasts never cover the topbar controls', () => {
    expect(toastPositionFor('ltr')).toBe('bottom-right');
    expect(toastPositionFor('rtl')).toBe('bottom-left');
  });
});
