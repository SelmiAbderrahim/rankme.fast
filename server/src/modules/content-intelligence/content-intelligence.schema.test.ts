import { describe, expect, it } from 'vitest';
import {
  createAnalysisBodySchema,
  isKeywordList,
  preflightAnalysisBodySchema,
} from './content-intelligence.schema.js';

const base = { ownedUrl: 'https://example.com/page', locale: 'en' } as const;

function issueMessages(keyword: unknown, schema: typeof createAnalysisBodySchema | typeof preflightAnalysisBodySchema) {
  const parsed = schema.safeParse({ ...base, keyword });
  return parsed.success ? null : parsed.error.issues.map((issue) => issue.message);
}

describe('content analysis keyword schema', () => {
  it.each([
    ['seven comma-separated keywords', 'a1, b2, c3, d4, e5, f6, g7'],
    ['one comma between two queries', 'seo audit, site audit'],
    ['a semicolon', 'seo audit; site audit'],
    ['a line feed (judged before control characters are stripped)', 'seo audit\nsite audit'],
    ['a CRLF', 'seo audit\r\nsite audit'],
    ['a tab', 'seo audit\tsite audit'],
    ['a vertical tab', 'seo audit\vsite audit'],
    ['a form feed', 'seo audit\fsite audit'],
    ['a next-line character', 'seo audit\u0085site audit'],
    ['a line separator', 'seo audit site audit'],
    ['a paragraph separator', 'seo audit site audit'],
    ['fullwidth and ideographic commas', '播客转录，免费工具、最佳应用'],
    ['an Arabic comma', 'مدقق، سيو'],
    ['a fullwidth semicolon', '播客转录；免费工具'],
  ])('rejects %s on create and preflight with the localized list message', (_label, keyword) => {
    expect(isKeywordList(keyword)).toBe(true);
    for (const schema of [createAnalysisBodySchema, preflightAnalysisBodySchema]) {
      expect(issueMessages(keyword, schema)).toEqual(['contentIntelligence.errors.keywordList']);
    }
  });

  it('keeps one query, including a trailing separator, and never alters it', () => {
    for (const keyword of ['seo audit', 'seo audit,', ' ; seo audit ;', '  seo audit  ']) {
      expect(isKeywordList(keyword)).toBe(false);
      expect(createAnalysisBodySchema.parse({ ...base, keyword }).keyword).toBe(keyword.trim());
    }
  });

  it('accepts exactly 200 characters untouched and rejects 201 instead of truncating', () => {
    const atLimit = `${'word '.repeat(39)}wordsx`.slice(0, 200);
    expect(atLimit).toHaveLength(200);
    for (const schema of [createAnalysisBodySchema, preflightAnalysisBodySchema]) {
      expect(schema.parse({ ...base, keyword: atLimit }).keyword).toBe(atLimit);
      const over = schema.safeParse({ ...base, keyword: `${atLimit}p` });
      expect(over.success).toBe(false);
      if (!over.success) {
        expect(over.error.issues).toHaveLength(1);
        expect(over.error.issues[0]).toMatchObject({ code: 'too_big', maximum: 200 });
      }
    }
  });

  it('rejects an empty or non-string keyword', () => {
    expect(issueMessages('   ', createAnalysisBodySchema)).not.toBeNull();
    expect(issueMessages(7, createAnalysisBodySchema)).not.toBeNull();
  });
});
