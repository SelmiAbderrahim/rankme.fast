import { z } from 'zod';

/**
 * Client mirror of `server/src/shared/validation/site-url.ts` — keep the two
 * in lockstep. Input validation only (data quality + API-credit spend); the
 * server re-validates every submission.
 */

export const SITE_URL_MAX_LENGTH = 2048;

export type SiteUrlRejectReason =
  | 'required'
  | 'tooLong'
  | 'invalid'
  | 'scheme'
  | 'userinfo'
  | 'ipLiteral'
  | 'noTld';

export type SiteUrlResult =
  | { ok: true; url: string; domain: string }
  | { ok: false; reason: SiteUrlRejectReason };

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export function validateSiteUrl(input: string): SiteUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'required' };
  if (trimmed.length > SITE_URL_MAX_LENGTH) return { ok: false, reason: 'tooLong' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'userinfo' };
  }

  const hostname = parsed.hostname;
  /* v8 ignore next -- unreachable defence: WHATWG URL rejects empty hosts for http/https ('http://' throws above). */
  if (hostname.length === 0) return { ok: false, reason: 'invalid' };
  if (hostname.startsWith('[') || IPV4_PATTERN.test(hostname)) {
    return { ok: false, reason: 'ipLiteral' };
  }
  // No localhost escape hatch on the client — production input only.
  if (!hostname.includes('.')) return { ok: false, reason: 'noTld' };

  return { ok: true, url: parsed.origin, domain: hostname };
}

/** i18n key (sites namespace) for each reject reason. */
export const REASON_TO_MESSAGE_KEY: Record<SiteUrlRejectReason, string> = {
  required: 'errors.urlRequired',
  tooLong: 'errors.urlTooLong',
  invalid: 'errors.urlInvalid',
  scheme: 'errors.urlScheme',
  userinfo: 'errors.urlUserinfo',
  ipLiteral: 'errors.urlIpLiteral',
  noTld: 'errors.urlNoTld',
};

/** zod schema for the add-site form; `t` resolves the sites namespace. */
export const buildAddSiteSchema = (t: (key: string) => string) =>
  z.object({
    url: z.string().superRefine((value, ctx) => {
      const result = validateSiteUrl(value);
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(REASON_TO_MESSAGE_KEY[result.reason]),
        });
      }
    }),
  });

export type AddSiteFormValues = z.infer<ReturnType<typeof buildAddSiteSchema>>;
