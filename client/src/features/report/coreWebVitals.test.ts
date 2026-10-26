import { describe, expect, it } from 'vitest';
import { worstCoreWebVitalsCategory } from './coreWebVitals';

const cwv = (category: 'good' | 'needs-improvement' | 'poor') => ({
  coreWebVitals: { lcpMs: 2000, inp: 150, cls: 0.05, category },
});

describe('worstCoreWebVitalsCategory', () => {
  it('returns null when no sample has real-visitor data', () => {
    expect(worstCoreWebVitalsCategory([])).toBeNull();
    expect(worstCoreWebVitalsCategory([{}, {}])).toBeNull();
  });

  it('ignores samples without field data and keeps the worst category', () => {
    expect(worstCoreWebVitalsCategory([{}, cwv('good')])).toBe('good');
    expect(worstCoreWebVitalsCategory([cwv('good'), {}, cwv('needs-improvement')])).toBe(
      'needs-improvement',
    );
    expect(
      worstCoreWebVitalsCategory([cwv('poor'), cwv('needs-improvement'), cwv('good')]),
    ).toBe('poor');
  });
});
