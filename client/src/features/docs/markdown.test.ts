import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { headingId, markdownDocsSlug, nodeText, tableOfContents } from './markdown';

describe('documentation Markdown helpers', () => {
  it('creates readable Unicode-safe heading ids', () => {
    expect(headingId('  Plans, Limits & Credits! ')).toBe('plans-limits-credits');
    expect(headingId('الأمان والحساب')).toBe('الامان-والحساب');
  });

  it('extracts level-two and level-three headings only', () => {
    expect(tableOfContents('# Title\n\n## **Start**\ntext\n### `Details`\n#### Ignore\n##   ')).toEqual([
      { id: 'start', label: 'Start', level: 2 },
      { id: 'details', label: 'Details', level: 3 },
    ]);
  });

  it('flattens every React heading-child shape to text', () => {
    expect(nodeText('Text')).toBe('Text');
    expect(nodeText(42)).toBe('42');
    expect(nodeText(['A', 'B'])).toBe('AB');
    expect(nodeText(createElement('em', null, 'Nested'))).toBe('Nested');
    expect(nodeText(null)).toBe('');
  });

  it('recognizes relative localized and legacy-neutral docs links', () => {
    expect(markdownDocsSlug('./ai-summary.en.md')).toBe('ai-summary');
    expect(markdownDocsSlug('pricing.md#plans')).toBe('pricing');
    expect(markdownDocsSlug('https://example.com/page.md')).toBeUndefined();
  });
});
