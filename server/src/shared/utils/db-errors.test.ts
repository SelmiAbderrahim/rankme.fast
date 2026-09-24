import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './db-errors.js';

describe('isUniqueViolation', () => {
  it('is false for null / non-object / undefined', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('nope')).toBe(false);
    expect(isUniqueViolation(42)).toBe(false);
  });

  it('is true when postgres code is 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('is true when the message mentions a unique-constraint violation', () => {
    expect(
      isUniqueViolation({ message: 'duplicate key value violates unique constraint' }),
    ).toBe(true);
    expect(isUniqueViolation({ message: 'UNIQUE constraint failed' })).toBe(true);
  });

  it('recurses through a shallow .cause chain', () => {
    const err = new Error('drizzle wrapped');
    (err as unknown as { cause: unknown }).cause = { code: '23505' };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('recurses through a nested .cause chain', () => {
    const inner = { code: '23505' };
    const middle = { message: 'wrapped', cause: inner };
    const outer = new Error('outer');
    (outer as unknown as { cause: unknown }).cause = middle;
    expect(isUniqueViolation(outer)).toBe(true);
  });

  it('is false when neither code nor message match and no cause chain', () => {
    expect(isUniqueViolation({ code: '42P01', message: 'undefined_table' })).toBe(false);
  });

  it('is false when the cause chain ends in an unrelated error', () => {
    const err = new Error('outer');
    (err as unknown as { cause: unknown }).cause = { code: '42P01' };
    expect(isUniqueViolation(err)).toBe(false);
  });

  it('is false for a bare Error with no fields', () => {
    expect(isUniqueViolation(new Error('nothing'))).toBe(false);
  });
});
