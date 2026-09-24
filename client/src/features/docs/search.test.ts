import { describe, expect, it } from 'vitest';
import { filterDocs } from './search';
import type { DocsSearchEntry } from './types';

const docs: DocsSearchEntry[] = [
  {
    slug: 'ai-summary',
    locale: 'en',
    title: 'AI Summary',
    description: 'A short executive brief',
    section: 'audits',
    order: 1,
    searchText: 'Regenerate a summary after the audit.',
  },
  {
    slug: 'pricing',
    locale: 'en',
    title: 'Pricing',
    description: 'Plans and allowances',
    section: 'account',
    order: 1,
    searchText: 'Monthly credits',
  },
];

describe('filterDocs', () => {
  it('returns all entries when no filter is active', () => {
    expect(filterDocs(docs, '')).toEqual(docs);
  });

  it('normalizes case and Unicode before searching all content fields', () => {
    expect(filterDocs(docs, '  ai SUMMARY ')).toEqual([docs[0]]);
    expect(filterDocs(docs, 'monthly')).toEqual([docs[1]]);
  });

  it('combines section and text filters', () => {
    expect(filterDocs(docs, '', 'account')).toEqual([docs[1]]);
    expect(filterDocs(docs, 'summary', 'account')).toEqual([]);
  });
});
