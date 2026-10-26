import { describe, expect, it } from 'vitest';
import { GAP_COMPETITORS_MAX, gapFormSchema } from './validation';

const base = { ownDomain: 'own.example', locationCode: 2840, languageCode: 'en' };

describe('gapFormSchema competitor rules (mirror of the server bounds)', () => {
  it('accepts one to the maximum number of distinct competitors', () => {
    expect(gapFormSchema.safeParse({ ...base, competitors: ['a.example'] }).success).toBe(true);
    expect(GAP_COMPETITORS_MAX).toBe(3);
  });

  it('refuses a repeated competitor with the localized duplicate message', () => {
    const result = gapFormSchema.safeParse({ ...base, competitors: ['a.example', 'a.example'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('keywordResearch:errors.competitorsDuplicate');
  });

  it('refuses the own domain as a competitor', () => {
    const result = gapFormSchema.safeParse({ ...base, competitors: ['own.example'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('keywordResearch:errors.gapDomainConflict');
  });

  it('refuses no competitors and more than the maximum', () => {
    expect(gapFormSchema.safeParse({ ...base, competitors: [] }).success).toBe(false);
    expect(
      gapFormSchema.safeParse({ ...base, competitors: ['a.example', 'b.example', 'c.example', 'd.example'] }).success,
    ).toBe(false);
  });
});
