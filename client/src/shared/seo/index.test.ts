import { describe, expect, it } from 'vitest';
import * as seo from './index';

describe('seo public API barrel', () => {
  it('re-exports the SEO surface', () => {
    expect(seo.Seo).toBeTruthy();
    expect(typeof seo.canonicalFor).toBe('function');
    expect(seo.schema).toBeTruthy();
  });
});
