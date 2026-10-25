/**
 * — offline evals of the summary validator with canned
 * model outputs. Every accepted output uses only numbers present in its
 * input; overclaims, unknown addresses and unknown findings are rejected.
 */
import { describe, expect, it } from 'vitest';
import type { SummarizeInput, SummaryStructuredOutput } from '../../shared/providers/index.js';
import {
  allowedNumbers,
  normalizeDigits,
  numbersIn,
  validateAuditSummary,
} from './summary-validator.js';
import { summaryActArea } from './summary-act-area.js';

const input: SummarizeInput = {
  siteDomain: 'episodebrief.com',
  locale: 'en',
  findings: [
    {
      ruleId: 'not-indexed',
      title: 'Pages are not indexed',
      why: 'Search engines cannot show them.',
      fix: 'Inspect the URL in Search Console and check robots.txt, noindex, canonical tags and sitemaps.',
      affectedCount: 3,
      priority: 'fix-now',
      comparisonStatus: 'new',
    },
    {
      ruleId: 'faq-content-missing',
      title: 'FAQ content is missing',
      why: 'Answers help readers.',
      fix: 'Add a short FAQ.',
      affectedCount: 28,
      priority: 'watch',
    },
    {
      ruleId: 'thin-content',
      title: 'Pages have thin content',
      why: 'Thin pages rarely help readers.',
      fix: 'Expand pages under 300 words.',
      affectedCount: 1200,
      priority: 'watch',
    },
  ],
  dismissed: [{ ruleId: 'broken-internal-links', title: 'Broken internal links', affectedCount: 65 }],
};

const structured = (status: string, items: Array<Partial<{ ruleId: string; what: string; why: string; firstStep: string }>> = []) => ({
  text: status,
  structured: {
    status,
    items: items.map((item) => ({
      ruleId: 'not-indexed',
      what: 'Three pages are not indexed.',
      why: 'They cannot appear in search.',
      firstStep: 'Inspect each URL in Search Console.',
      ...item,
    })),
  },
});

describe('canned outputs the validator accepts', () => {
  it.each([
    ['counts from the input', structured('1 to fix now, 2 to watch: 3 pages are not indexed and 28 need FAQ content.', [{}])],
    ['a thousands separator', structured('1,200 pages are thin; Broken internal links (65 pages) were dismissed.')],
    ['the site domain', structured('episodebrief.com has 3 open findings.')],
    ['robots.txt from the fix copy', structured('Check robots.txt first.', [{ firstStep: 'Check robots.txt for the 3 pages.' }])],
    ['Arabic-Indic digits', structured('٣ صفحات غير مفهرسة.')],
    ['a text-only summary', { text: 'Fix the 3 pages that are not indexed first.' }],
  ])('%s', (_name, output: { text: string; structured?: SummaryStructuredOutput }) => {
    const result = validateAuditSummary(output, input);
    expect(result).toEqual({ ok: true, issues: [] });
    // Every number in an accepted summary exists in its input.
    const allowed = allowedNumbers(input);
    const text = [output.text, ...(output.structured?.items.flatMap((i) => [i.what, i.why, i.firstStep]) ?? [])].join(' ');
    for (const n of numbersIn(text)) expect(allowed.has(n)).toBe(true);
  });
});

describe('canned outputs the validator rejects', () => {
  it.each([
    ['an invented number', structured('7 pages are not indexed.'), 'unknown_number'],
    ['an invented percentage', structured('Fix this to gain 40% more traffic.'), 'unknown_number'],
    ['"frequently quote"', structured('AI overviews frequently quote FAQ content.'), 'unsupported_claim'],
    ['a guarantee', structured('This guarantees better visibility.'), 'unsupported_claim'],
    ['"will rank"', structured('Your pages will rank higher.'), 'unsupported_claim'],
    ['a German guarantee', structured('Das ist garantiert besser.'), 'unsupported_claim'],
    ['a Russian guarantee', structured('Мы гарантируем рост.'), 'unsupported_claim'],
    ['a Chinese guarantee', structured('保证排名提升。'), 'unsupported_claim'],
    ['an Arabic guarantee', structured('نضمن لك نتائج أفضل.'), 'unsupported_claim'],
    ['an unknown URL', structured('See https://competitor.example/guide for help.'), 'unknown_url'],
    ['an unknown bare domain', structured('Copy what rival-site.com does.'), 'unknown_url'],
    ['an unknown finding', structured('Three things to fix.', [{ ruleId: 'made-up-rule' }]), 'unknown_finding'],
  ])('%s', (_name, output, issue) => {
    const result = validateAuditSummary(output, input);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain(issue);
  });

  it('accepts the site on www and over https', () => {
    expect(validateAuditSummary(structured('Open https://www.episodebrief.com/en/terms.'), input).ok).toBe(true);
    expect(validateAuditSummary(structured('Open www.episodebrief.com today.'), input).ok).toBe(true);
  });

  it('treats an unparseable URL as its own host', () => {
    expect(validateAuditSummary(structured('Open http://[bad'), input).issues).toContain('unknown_url');
  });
});

describe('number helpers', () => {
  it('normalizes Arabic-Indic, extended and fullwidth digits', () => {
    expect(normalizeDigits('٣ ۴ ５ x')).toBe('3 4 5 x');
  });

  it('reads thousands separators and decimals', () => {
    expect(numbersIn('1,200 and 2.5 and 1 000 and 7')).toEqual([1200, 2.5, 1000, 7]);
  });

  it('allows the bucket totals, item positions and every input number', () => {
    const allowed = allowedNumbers({ ...input, dismissed: undefined });
    for (const n of [1, 2, 3, 28, 1200, 300, 0]) expect(allowed.has(n)).toBe(true);
    expect(allowed.has(65)).toBe(false);
  });
});

describe('summaryActArea', () => {
  it.each([
    ['not-indexed', 'google'],
    ['broken-internal-links', 'pages'],
    ['structured-data-missing', 'schema'],
    ['ai-visibility-low', 'ai-visibility'],
    ['nap-inconsistency', 'local-seo'],
    ['core-web-vitals-poor', 'report'],
  ])('%s → %s', (ruleId, area) => {
    expect(summaryActArea(ruleId)).toBe(area);
  });
});
