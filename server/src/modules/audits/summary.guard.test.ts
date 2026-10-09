import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import type { SummaryFindingInput } from '../../shared/providers/index.js';
import { buildDeterministicSummary, leaksPromptWording } from './summary.guard.js';

const finding = (title: string, priority?: 'fix-now' | 'watch'): SummaryFindingInput => ({
  ruleId: 'r',
  ...(priority ? { priority } : {}),
  title,
  why: 'why',
  fix: 'fix',
  affectedCount: 0,
});

describe('leaksPromptWording', () => {
  it.each([
    ['en', 'No fix-now findings were supplied, so nothing is urgent.'],
    ['en', 'The HTTPS finding is an open problem even though it lists no pages.'],
    ['en', 'The findings list was empty.'],
    ['en', 'No affected pages were listed.'],
    ['fr', 'Les résultats n’ont pas été fournis.'],
    ['fr', 'Ce point ne liste aucune page.'],
    ['de', 'Es wurden keine Ergebnisse bereitgestellt.'],
    ['es', 'No se han proporcionado hallazgos.'],
    ['ru', 'Результаты не были предоставлены.'],
    ['zh', '未提供任何发现。'],
    ['ar', 'لم يتم تقديم أي نتائج.'],
  ] as const)('flags %s leak: %s', (locale, text) => {
    expect(leaksPromptWording(text, locale)).toBe(true);
  });

  it('passes ordinary advice, including the word "provided" used normally', () => {
    expect(leaksPromptWording('Nothing is urgent right now. Fix your page titles, provided your CMS allows it.', 'en')).toBe(false);
    for (const locale of SUPPORTED_LOCALES) {
      expect(leaksPromptWording('', locale)).toBe(false);
    }
  });
});

describe('buildDeterministicSummary', () => {
  it('says nothing is urgent and names at most three Watch items when there is no Fix now', () => {
    const text = buildDeterministicSummary('en', [
      finding('A', 'watch'),
      finding('B', 'watch'),
      finding('C', 'watch'),
      finding('D', 'watch'),
    ]);
    expect(text).toBe('Nothing is urgent right now. Worth doing next: A, B, and C.');
  });

  it('puts Fix now first, then Watch', () => {
    expect(buildDeterministicSummary('en', [finding('A', 'fix-now'), finding('B'), finding('C', 'watch')])).toBe(
      'Fix these first: A and B. Worth doing next: C.',
    );
  });

  it('handles an empty or Fix-now-only input', () => {
    expect(buildDeterministicSummary('en', [])).toBe('Nothing needs fixing right now.');
    expect(buildDeterministicSummary('en', [finding('A', 'fix-now')])).toBe('Fix these first: A.');
  });

  it('is localized and never leaks in any locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const text = buildDeterministicSummary(locale, [finding('A', 'watch')]);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('{{');
      expect(leaksPromptWording(text, locale)).toBe(false);
    }
  });
});
