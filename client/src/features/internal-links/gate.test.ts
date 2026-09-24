import { describe, expect, it } from 'vitest';
import { ApiError } from '@shared/api/client';
import { internalLinkGate } from './gate';

describe('internalLinkGate', () => {
  it.each([
    [404, 'notFound'],
    [429, 'rateLimited'],
    [503, 'disabled'],
    [409, 'failed'],
  ] as const)('maps HTTP %s to %s', (status, expected) => {
    expect(internalLinkGate(new ApiError('x', status, null))).toBe(expected);
  });

  it('uses the honest failed state for non-HTTP errors', () => {
    expect(internalLinkGate(new Error('offline'))).toBe('failed');
  });
});

