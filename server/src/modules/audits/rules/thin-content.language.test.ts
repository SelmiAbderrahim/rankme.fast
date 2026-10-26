/**
 * The thin-content check measures every language fairly.
 * Fixture: `__fixtures__/seven-locale-site.json` (same depth in seven
 * locales; the vendor counts words by spaces, so /zh/ pages report a tiny
 * `wordCount`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeAuditPage, makeAuditResult } from './fixtures.js';
import { pageLanguage, urlPathLanguage } from './page-language.js';
import {
  THIN_CONTENT_HANGUL_CHARS,
  THIN_CONTENT_IDEOGRAPHIC_CHARS,
  THIN_CONTENT_THAI_CHARS,
  THIN_CONTENT_WORDS,
  measurePage,
  thinContentRule,
} from './thin-content.js';

interface FixturePage {
  url: string;
  title: string;
  wordCount: number;
  textSize: number;
  expectThin?: boolean;
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '__fixtures__', 'seven-locale-site.json'), 'utf8'),
) as { pages: FixturePage[]; expectedThin: string[]; extraZh: FixturePage[] };

const toPage = (page: FixturePage) =>
  makeAuditPage({ url: page.url, title: page.title, wordCount: page.wordCount, textSize: page.textSize });

describe('thin-content — seven-locale parity', () => {
  const finding = thinContentRule.evaluate(makeAuditResult({ pages: fixture.pages.map(toPage) }));

  it('flags the same page in every locale and nothing else', () => {
    expect([...finding.affectedUrls].sort()).toEqual([...fixture.expectedThin].sort());
  });

  it('gives each locale the same verdict for the same page', () => {
    const slugs = new Map<string, Set<boolean>>();
    for (const page of fixture.pages) {
      const slug = new URL(page.url).pathname.split('/').slice(2).join('/');
      const verdicts = slugs.get(slug) ?? new Set<boolean>();
      verdicts.add(finding.affectedUrls.includes(page.url));
      slugs.set(slug, verdicts);
    }
    for (const verdicts of slugs.values()) expect(verdicts.size).toBe(1);
  });

  it('carries the measured length and unit of every flagged URL', () => {
    const measurements = finding.meta?.measurements as Array<{ url: string; value: number; unit: string }>;
    expect(measurements.map((m) => m.url)).toEqual(finding.affectedUrls);
    expect(measurements.find((m) => m.url.includes('/zh/'))).toEqual({
      url: 'https://episodebrief.example/zh/shows',
      value: 140,
      unit: 'characters',
    });
    expect(measurements.find((m) => m.url.includes('/en/'))).toEqual({
      url: 'https://episodebrief.example/en/shows',
      value: 80,
      unit: 'words',
    });
  });

  it('still flags a truly thin Chinese page and passes a rich one', () => {
    const result = thinContentRule.evaluate(makeAuditResult({ pages: fixture.extraZh.map(toPage) }));
    for (const page of fixture.extraZh) {
      expect(result.affectedUrls.includes(page.url)).toBe(page.expectThin);
    }
  });

  it('passes with no meta when nothing is thin', () => {
    const result = thinContentRule.evaluate(makeAuditResult({ pages: [{ wordCount: 900 }] }));
    expect(result).toEqual({ ruleId: 'thin-content', bucket: 'passed', severity: 'warning', affectedUrls: [] });
  });
});

describe('measurePage', () => {
  it('uses language-class limits', () => {
    expect(measurePage(makeAuditPage({ url: 'https://x.test/en/a', wordCount: 10 }))).toEqual({
      measure: { value: 10, unit: 'words' },
      limit: THIN_CONTENT_WORDS,
    });
    expect(measurePage(makeAuditPage({ url: 'https://x.test/ja/a', textSize: 30 }))?.limit).toBe(
      THIN_CONTENT_IDEOGRAPHIC_CHARS,
    );
    expect(measurePage(makeAuditPage({ url: 'https://x.test/a', htmlLang: 'ko-KR', textSize: 30 }))).toEqual({
      measure: { value: 10, unit: 'characters' },
      limit: THIN_CONTENT_HANGUL_CHARS,
    });
    expect(measurePage(makeAuditPage({ url: 'https://x.test/th/', textSize: 3 }))?.limit).toBe(THIN_CONTENT_THAI_CHARS);
  });

  it('returns null when the unit for the page language was not reported', () => {
    expect(measurePage(makeAuditPage({ url: 'https://x.test/zh/a', wordCount: 3 }))).toBeNull();
    expect(measurePage(makeAuditPage({ url: 'https://x.test/en/a', wordCount: undefined, textSize: 900 }))).toBeNull();
  });

  it('falls back to insufficient data when no page in the crawl has a usable measure', () => {
    const result = thinContentRule.evaluate(
      makeAuditResult({ pages: [{ url: 'https://x.test/zh/a', wordCount: 4, title: '关于我们' }] }),
    );
    expect(result.meta).toEqual({ insufficientData: true, reason: 'no-crawl-signal' });
  });
});

describe('pageLanguage', () => {
  it('prefers <html lang>, then the URL locale, then the text script', () => {
    const base = { title: '关于我们', h1: [] as string[], metaDescription: null };
    expect(pageLanguage({ ...base, url: 'https://x.test/en/a', htmlLang: 'de-DE' })).toBe('de');
    expect(pageLanguage({ ...base, url: 'https://x.test/fr/a' })).toBe('fr');
    expect(pageLanguage({ ...base, url: 'https://x.test/about' })).toBe('zh');
    expect(pageLanguage({ ...base, title: null, metaDescription: 'About us', url: 'https://x.test/about' })).toBeNull();
  });

  it('reads locale path segments and rejects unparsable URLs', () => {
    expect(urlPathLanguage('https://x.test/zh-cn/about')).toBe('zh');
    expect(urlPathLanguage('https://x.test/pt_BR')).toBe('pt');
    expect(urlPathLanguage('https://x.test/products/a')).toBeNull();
    expect(urlPathLanguage('not a url')).toBeNull();
  });
});

describe('title-missing-or-weak — display width', () => {
  it('measures Chinese titles by width, not by code units', async () => {
    const { titleMissingOrWeakRule } = await import('./title-missing-or-weak.js');
    const result = titleMissingOrWeakRule.evaluate(
      makeAuditResult({
        pages: [
          // 8 characters, 16 widths: a normal Chinese title, not "too short".
          { url: 'https://x.test/zh/a', title: '每集五分钟摘要服务' },
          // 34 characters, 68 widths: truncated in results.
          { url: 'https://x.test/zh/b', title: '每一集播客都在五分钟内总结完毕让你快速了解嘉宾观点和重要内容以及更多' },
        ],
      }),
    );
    expect(result.meta).toMatchObject({ offenders: [{ url: 'https://x.test/zh/b', reason: 'too-long' }] });
  });
});
