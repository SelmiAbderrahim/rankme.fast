import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index.html analytics', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

  it('ships no Google Analytics loader or bootstrap; consent gates it at runtime', () => {
    expect(html).not.toMatch(/googletagmanager\.com/);
    expect(html).not.toContain('__RANKME_GA_ID__');
    expect(html).not.toContain('gtag');
    expect(html).not.toContain('dataLayer');
  });

  it('keeps the SSR placeholders and the theme bootstrap', () => {
    expect(html).toContain('<!--ssr-head-->');
    expect(html).toContain('<!--ssr-outlet-->');
    expect(html).toContain("localStorage.getItem('theme')");
  });
});
