import { apiClient } from '@shared/api/client';
import type { SupportedLocale } from '@shared/i18n';
import type {
  AiTrackedPrompt,
  AiVisibilityOverview,
  AiVisibilityStoredSuggestions,
  AiVisibilityTrendPoint,
} from './types';

export const fetchAiVisibility = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<AiVisibilityOverview> =>
  apiClient<AiVisibilityOverview>(`/sites/${siteId}/ai-visibility`, init);

export const addAiVisibilityPrompt = (
  siteId: string,
  prompt: string,
): Promise<{ prompt: AiTrackedPrompt }> =>
  apiClient<{ prompt: AiTrackedPrompt }>(`/sites/${siteId}/ai-visibility/prompts`, {
    method: 'POST',
    // `apiClient` JSON.stringifies the body itself. Pass the raw object —
    // pre-stringifying here double-encodes it into a top-level JSON string,
    // which `express.json({ strict: true })` rejects as `entity.parse.failed`.
    body: { prompt },
  });

export const removeAiVisibilityPrompt = (
  siteId: string,
  promptId: string,
): Promise<void> =>
  apiClient<void>(`/sites/${siteId}/ai-visibility/prompts/${promptId}`, {
    method: 'DELETE',
  });

export const checkAiVisibility = (siteId: string): Promise<AiVisibilityOverview> =>
  apiClient<AiVisibilityOverview>(`/sites/${siteId}/ai-visibility/check`, {
    method: 'POST',
  });

/** Free read of the stored set — never meters, so a reload costs nothing. */
export const fetchAiVisibilitySuggestions = (
  siteId: string,
  outputLocale: SupportedLocale,
  init?: { signal?: AbortSignal },
): Promise<AiVisibilityStoredSuggestions> =>
  apiClient<AiVisibilityStoredSuggestions>(
    `/sites/${siteId}/ai-visibility/suggestions`,
    { ...init, locale: outputLocale, localeMode: 'artifact' },
  );

/**
 * Metered generation — one call spends one `ai_visibility_suggestion_runs`.
 *
 * This is the one route in the feature that waits on a live model call. The
 * `ai_visibility_prompt_suggestions` profile allows 45s (`deadlineMs`, two
 * attempts across the configured provider order), and the primary provider
 * alone takes ~15s for the ten-prompt structured output — past the client's
 * 15s default. `timeoutMs` gives the server room to finish, or to fall back to
 * templates on its own terms, instead of the browser aborting a run that was
 * already paid for.
 */
export const generateAiVisibilitySuggestions = (
  siteId: string,
  outputLocale: SupportedLocale,
): Promise<AiVisibilityStoredSuggestions> =>
  apiClient<AiVisibilityStoredSuggestions>(`/sites/${siteId}/ai-visibility/suggestions`, {
    method: 'POST',
    locale: outputLocale,
    localeMode: 'artifact',
    timeoutMs: 60_000,
  });

export const fetchAiVisibilityTrend = (
  siteId: string,
  init?: { signal?: AbortSignal },
): Promise<{ points: AiVisibilityTrendPoint[] }> =>
  apiClient<{ points: AiVisibilityTrendPoint[] }>(
    `/sites/${siteId}/ai-visibility/trend`,
    init,
  );
