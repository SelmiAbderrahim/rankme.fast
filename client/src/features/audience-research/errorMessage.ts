import { apiErrorMessage } from '@shared/api/errorMessage';

/**
 * Server error responses already carry a localized message (server dictionary
 * keys like `audienceResearch.errors.processingFailure` and `sites.errors.notFound`
 * resolve server-side via the shared i18n `translate`
 * helper — see `.claude/rules/i18n-seven-locales.md`). The client's job is to
 * surface that message and fall back to a localized client-side string only
 * for network-level failures (no HTTP response at all). This mirrors every
 * shipped feature's `errorMessage.ts` (content-intelligence, ai-visibility,
 * local-seo, keyword-research, backlinks) — a thin wrapper around the shared
 * `apiErrorMessage`, not a duplicated code→key table.
 */
export function errorMessage(err: unknown): string {
  return apiErrorMessage(err, 'audienceResearch:errors.generic');
}

export {
  apiErrorMessage as audienceResearchErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from '@shared/api/errorMessage';
