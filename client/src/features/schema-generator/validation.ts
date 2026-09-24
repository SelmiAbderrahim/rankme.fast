import { z } from 'zod';

/**
 * Client mirror of the server's `safeUrlString` guard
 * (`server/src/shared/security/input-guards.ts`): absolute `https:` only, no
 * embedded credentials, bounded length. This is a UX pre-check that keeps a
 * doomed request off the wire — the server repeats it, and `fetchPublicUrlSafe`
 * remains the only authority on what is actually reachable.
 */
export const MAX_PAGE_URL_CHARS = 2_048;

export const pastedPageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PAGE_URL_CHARS)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'unsafe URL shape' });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid URL' });
    }
  });

export function isValidPastedPageUrl(value: string): boolean {
  return pastedPageUrlSchema.safeParse(value).success;
}
