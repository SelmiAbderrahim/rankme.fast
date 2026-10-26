import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { keywords } from '../../db/schema/keywords.js';
import { escapeLikePattern, ilikeContains } from './like-pattern.js';

describe('literal text search', () => {
  it('escapes wildcard and escape characters', () => {
    expect(escapeLikePattern('50%_off\\now')).toBe('50\\%\\_off\\\\now');
    expect(escapeLikePattern('plain phrase')).toBe('plain phrase');
  });
  it('keeps user text parameterized in a case-insensitive contains query', () => {
    const query = new PgDialect().sqlToQuery(ilikeContains(keywords.phrase, "10%'_"));
    expect(query.sql).toBe(`"keywords"."phrase" ilike $1 escape '\\'`);
    expect(query.params).toEqual(["%10\\%'\\_%"]);
  });
});
