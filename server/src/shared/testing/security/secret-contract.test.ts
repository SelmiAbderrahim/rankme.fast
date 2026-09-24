import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { assertConditionalSecretContract } from './assertions.js';

const liveSecretSchema = z
  .object({ provider: z.enum(['fake', 'live']), VENDOR_API_KEY: z.string().min(1).optional() })
  .superRefine((value, context) => {
    if (value.provider === 'live' && !value.VENDOR_API_KEY) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['VENDOR_API_KEY'], message: 'required' });
    }
  });

describe('SEC-SECRET conditional credential contract', () => {
  it('provides the fake-keyless/live-missing-key assertion reused by later providers', () => {
    expect(() =>
      assertConditionalSecretContract({
        schema: liveSecretSchema,
        base: {},
        selector: 'provider',
        fakeValue: 'fake',
        liveValue: 'live',
        secret: 'VENDOR_API_KEY',
      }),
    ).not.toThrow();
  });

  it('fails if a schema requires a fake key or permits a keyless live provider', () => {
    const alwaysRequired = z.object({ provider: z.string(), VENDOR_API_KEY: z.string().min(1) });
    expect(() =>
      assertConditionalSecretContract({
        schema: alwaysRequired,
        base: {},
        selector: 'provider',
        fakeValue: 'fake',
        liveValue: 'live',
        secret: 'VENDOR_API_KEY',
      }),
    ).toThrow('must boot');

    const neverRequired = z.object({ provider: z.string(), VENDOR_API_KEY: z.string().optional() });
    expect(() =>
      assertConditionalSecretContract({
        schema: neverRequired,
        base: {},
        selector: 'provider',
        fakeValue: 'fake',
        liveValue: 'live',
        secret: 'VENDOR_API_KEY',
      }),
    ).toThrow('must require');
  });
});
