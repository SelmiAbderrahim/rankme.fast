import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index analytics bootstrap', () => {
  it('does not ship an unconditional loader and rejects missing or invalid build IDs', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src="https:\/\/www\.googletagmanager\.com/);
    expect(html).toContain('String(__RANKME_GA_ID__).trim()');
    expect(html).not.toContain('%VITE_GA_ID%');
    expect(html).toContain('if (!/^G-[A-Z0-9]+$/.test(id)) return;');
    expect('G-ABC123').toMatch(/^G-[A-Z0-9]+$/);
    expect(html).toContain('encodeURIComponent(id)');
    expect(html).toContain("'$1/[redacted]'");
    expect(html).toContain("/(\\/team\\/(?:accept|reject))\\/[^/]+\\/?$/");
    expect(html).toContain("new URLSearchParams(window.location.search).get('returnTo')");
    expect(html).toContain("window.gtag('set', {");
    expect(html).toContain('page_location: safeLocation');
    expect(html).not.toContain('page_location: window.location.href');
  });
});
