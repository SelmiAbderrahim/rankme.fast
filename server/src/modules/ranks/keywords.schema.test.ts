import { describe, expect, it } from 'vitest';
import { listKeywordsQuerySchema } from './keywords.schema.js';

describe('list keywords query', () => {
  it('treats a whitespace-only search as absent', () => {
    expect(listKeywordsQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
    expect(listKeywordsQuerySchema.parse({ search: '  phrase  ' }).search).toBe('phrase');
  });

  it('rejects using offset and cursor pagination together', () => {
    const parsed = listKeywordsQuerySchema.safeParse({ page: 2,
      cursor: '00000000-0000-4000-8000-000000000000' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['page'], message: 'ranks.errors.unknownCursor' }),
      ]));
    }
  });
});
