import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decisionRequestSchema } from '../../modules/keyword-research/keyword-research.schema.js';
import { localizeZodError } from './errors.js';
import { SUPPORTED_LOCALES, translate } from './index.js';

describe('validation error contracts', () => {
  it('classifies wrong types by their expected schema without confusing nonfinite values', () => {
    const parsed = z.object({ text: z.string(), textDate: z.string(), number: z.number(), finite: z.number().finite(), finiteNegative: z.number().finite(), dateText: z.date(), date: z.date() })
      .safeParse({ text: JSON.parse('1e999'), textDate: new Date('invalid'), number: NaN, finite: Infinity, finiteNegative: -Infinity, dateText: 'invalid', date: new Date('invalid') });
    if (parsed.success) throw new Error('expected validation failure');
    expect(localizeZodError('en', parsed.error).issues.map(({ code, messageKey }) => ({ code, messageKey }))).toEqual([
      { code: 'invalid_type', messageKey: 'validation.issue.invalidType' },
      { code: 'invalid_type', messageKey: 'validation.issue.invalidType' },
      { code: 'invalid_type', messageKey: 'validation.issue.invalidType' },
      { code: 'not_finite', messageKey: 'validation.issue.notFinite' },
      { code: 'not_finite', messageKey: 'validation.issue.notFinite' },
      { code: 'invalid_type', messageKey: 'validation.issue.invalidType' },
      { code: 'invalid_date', messageKey: 'validation.issue.invalidDate' },
    ]);
  });

  it('preserves decision-kind type errors separately from unsupported enum strings', () => {
    for (const input of [undefined, null, 42, 'unsupported']) {
      const parsed = decisionRequestSchema.safeParse({ kind: input, idempotencyKey: 'request-key' });
      if (parsed.success) throw new Error('expected validation failure');
      const details = localizeZodError('en', parsed.error);
      expect(details.issues.find(({ path }) => path[0] === 'kind')).toMatchObject(input === 'unsupported'
        ? { code: 'invalid_enum_value', messageKey: 'validation.issue.invalidEnumValue' }
        : { code: 'invalid_type', messageKey: 'keywordResearch.errors.decisionKindInvalid' });
    }
  });

  it('keeps wrongly typed enum values distinct from unsupported strings', () => {
    for (const input of [null, 42, {}, false]) {
      const parsed = z.enum(['first', 'second']).safeParse(input);
      if (parsed.success) throw new Error('expected validation failure');
      expect(localizeZodError('en', parsed.error).issues[0]).toMatchObject({ code: 'invalid_type', messageKey: 'validation.issue.invalidType' });
    }
  });

  it('distinguishes a singleton enum from a literal and keeps a missing literal error', () => {
    const parsed = z.object({ singleton: z.enum(['only']), literal: z.literal('fixed') }).safeParse({ singleton: 'other' });
    if (parsed.success) throw new Error('expected validation failure');
    expect(localizeZodError('en', parsed.error).issues.map(({ code, messageKey }) => ({ code, messageKey }))).toEqual([
      { code: 'invalid_enum_value', messageKey: 'validation.issue.invalidEnumValue' },
      { code: 'invalid_literal', messageKey: 'validation.issue.invalidLiteral' },
    ]);
  });

  it('localizes rejected nonfinite numbers, invalid dates and absent enums', () => {
    const parsed = z.object({ number: z.number(), date: z.date(), choice: z.enum(['first', 'second']) })
      .safeParse({ number: Infinity, date: new Date('invalid') });
    if (parsed.success) throw new Error('expected validation failure');
    expect(localizeZodError('en', parsed.error).issues.map(({ code, messageKey }) => ({ code, messageKey }))).toEqual([
      { code: 'not_finite', messageKey: 'validation.issue.notFinite' },
      { code: 'invalid_date', messageKey: 'validation.issue.invalidDate' },
      { code: 'invalid_type', messageKey: 'validation.issue.required' },
    ]);
    const invalid = z.string().guid().safeParse('invalid');
    if (invalid.success) throw new Error('expected validation failure');
    expect(localizeZodError('en', invalid.error).issues[0]).toMatchObject({ code: 'invalid_string', messageKey: 'validation.issue.invalidUuid' });
  });

  it('distinguishes absent fields from wrong types without retaining input', () => {
    const result = z.object({ absent: z.string(), wrong: z.string() }).safeParse({ wrong: 42 });
    if (result.success) throw new Error('expected validation failure');
    for (const locale of SUPPORTED_LOCALES) {
      const details = localizeZodError(locale, result.error);
      expect(details.fieldErrors).toEqual({
        absent: [translate(locale, 'validation.issue.required')],
        wrong: [translate(locale, 'validation.issue.invalidType')],
      });
      expect(details.issues.map(({ code }) => code)).toEqual(['invalid_type', 'invalid_type']);
    }
    expect(result.error.issues.every((issue) => !('input' in issue))).toBe(true);
  });

  it('keeps string, enum, literal and bound issue wire codes and localized copy', () => {
    const result = z.object({
      email: z.string().email(),
      choice: z.enum(['first', 'second']),
      literal: z.literal('fixed'),
      tags: z.array(z.string()).min(2),
      count: z.number().multipleOf(5),
    }).safeParse({ email: 'invalid', choice: 'other', literal: 'other', tags: [], count: 3 });
    if (result.success) throw new Error('expected validation failure');
    expect(localizeZodError('de', result.error).issues).toEqual([
      { code: 'invalid_string', path: ['email'], messageKey: 'validation.issue.invalidEmail', message: translate('de', 'validation.issue.invalidEmail') },
      { code: 'invalid_enum_value', path: ['choice'], messageKey: 'validation.issue.invalidEnumValue', message: translate('de', 'validation.issue.invalidEnumValue') },
      { code: 'invalid_literal', path: ['literal'], messageKey: 'validation.issue.invalidLiteral', message: translate('de', 'validation.issue.invalidLiteral') },
      { code: 'too_small', path: ['tags'], messageKey: 'validation.issue.tooSmallArray', message: translate('de', 'validation.issue.tooSmallArray', { minimum: 2 }) },
      { code: 'not_multiple_of', path: ['count'], messageKey: 'validation.issue.notMultipleOf', message: translate('de', 'validation.issue.notMultipleOf', { multipleOf: 5 }) },
    ]);
  });
});
