import { describe, expect, it } from 'vitest';
import { normalizeSearchText, rankSearchFields, rankSearchMatch } from './searchMatch';

describe('searchMatch', () => {
  it('normalizes case, accents and whitespace', () => {
    expect(normalizeSearchText('  Résumé ')).toBe('resume');
  });

  it('ranks prefix, word-start, substring and fuzzy hits in that order', () => {
    expect(rankSearchMatch('Keyword research', 'key')).toBe(0);
    expect(rankSearchMatch('Keyword research', 'res')).toBe(1);
    expect(rankSearchMatch('Keyword research', 'word')).toBe(2);
    expect(rankSearchMatch('Keyword research', 'kwr')).toBe(3);
    expect(rankSearchMatch('Keyword research', 'zzz')).toBeNull();
  });

  it('matches everything for an empty query and ignores short fuzzy needles', () => {
    expect(rankSearchMatch('Anything', '  ')).toBe(0);
    expect(rankSearchMatch('Keyword research', 'kr')).toBeNull();
  });

  it('is accent-insensitive', () => {
    expect(rankSearchMatch('Écran', 'ecran')).toBe(0);
  });

  it('takes the best rank over several fields', () => {
    expect(rankSearchFields(['Acme Shop', 'acme.example'], 'acme.ex')).toBe(0);
    expect(rankSearchFields(['Shop', 'my acme'], 'acme')).toBe(1);
    expect(rankSearchFields(['a', 'b'], 'zzz')).toBeNull();
  });
});
